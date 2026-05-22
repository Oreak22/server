const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const coordinatesSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    altitude_meters: { type: Number },
  },
  { _id: false },
);

const accessDetailsSchema = new mongoose.Schema(
  {
    floor: { type: String, trim: true },
    unit_number: { type: String, trim: true },
    gate_code: { type: String, default: null, trim: true },
    courier_instructions: { type: String, trim: true },
  },
  { _id: false },
);

const savedLocationSchema = new mongoose.Schema(
  {
    location_id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    street_address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    coordinates: { type: coordinatesSchema, required: true },
    plus_code: { type: String, trim: true },
    access_details: { type: accessDetailsSchema, default: {} },
  },
  { _id: false },
);

const profileSchema = new mongoose.Schema(
  {
    first_name: { type: String, required: true, trim: true },
    last_name: { type: String, required: true, trim: true },
    business_name: { type: String, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone_number: { type: String, required: true, trim: true },
    created_at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const b2bConfigSchema = new mongoose.Schema(
  {
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
    },
    wallet_id: { type: String, trim: true },
    preferred_billing_cycle: {
      type: String,
      enum: ["PREPAID_WALLET", "POSTPAID_INVOICE"],
      default: "PREPAID_WALLET",
    },
  },
  { _id: false },
);

const authSchema = new mongoose.Schema(
  {
    password: { type: String, select: false },
    provider: {
      type: String,
      enum: ["PASSWORD", "GOOGLE"],
      default: "PASSWORD",
    },
    firebase_uid: { type: String, unique: true, sparse: true, trim: true },
    email_verified: { type: Boolean, default: false },
    email_verified_at: { type: Date },
    password_changed_at: { type: Date },
    last_login_at: { type: Date },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    user_id: { type: String, required: true, unique: true, trim: true },
    account_type: {
      type: String,
      enum: ["B2B_MERCHANT", "B2C_CUSTOMER", "ADMIN"],
      required: true,
    },
    profile: { type: profileSchema, required: true },
    auth: { type: authSchema, required: true },
    saved_locations: { type: [savedLocationSchema], default: [] },
    b2b_config: { type: b2bConfigSchema, default: undefined },
    account_status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

userSchema.index({ "b2b_config.wallet_id": 1 }, { sparse: true });
userSchema.index({ "profile.phone_number": 1 });
userSchema.index({ "auth.firebase_uid": 1 }, { unique: true, sparse: true });

userSchema.path("saved_locations").validate(function (locations) {
  const locationIds = locations.map((location) => location.location_id);
  return locationIds.length === new Set(locationIds).size;
}, "saved_locations cannot contain duplicate location_id values");

userSchema.virtual("delivery_wallet", {
  ref: "Wallet",
  localField: "_id",
  foreignField: "owner",
  justOne: true,
});

// If a B2B user supplies an existing business wallet_id, connect it automatically.
userSchema.pre("validate", async function (next) {
  try {
    if (this.account_type !== "B2B_MERCHANT") return next();

    if (!this.profile?.business_name) {
      return next(new Error("profile.business_name is required for B2B users"));
    }

    if (!this.b2b_config?.wallet_id || this.b2b_config.wallet) return next();

    let Wallet;
    try {
      Wallet = mongoose.model("Wallet");
    } catch (err) {
      Wallet = require("./wallet.model");
    }

    const wallet = await Wallet.findOne({
      wallet_id: this.b2b_config.wallet_id,
    }).select("_id");

    if (!wallet) {
      return next(
        new Error(
          `Wallet with wallet_id "${this.b2b_config.wallet_id}" was not found`,
        ),
      );
    }

    this.b2b_config.wallet = wallet._id;
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("auth.password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.auth.password = await bcrypt.hash(this.auth.password, salt);
    this.auth.password_changed_at = new Date();
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.auth?.password) return false;

  return bcrypt.compare(candidatePassword, this.auth.password);
};

const User = mongoose.model("User", userSchema);

module.exports = User;
