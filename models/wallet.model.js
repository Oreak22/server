const mongoose = require("mongoose");

const ownerModelByType = {
  USER: "User",
  BUSINESS: "Business",
  ADMIN: "Admin",
  RIDER: "Rider",
};

const monnifyAccountSchema = new mongoose.Schema(
  {
    account_reference: { type: String, unique: true, sparse: true, trim: true },
    reservation_reference: { type: String, trim: true },
    account_name: { type: String, trim: true },
    bank_code: { type: String, trim: true },
    contract_code: { type: String, trim: true },
    customer_email: { type: String, lowercase: true, trim: true },
    customer_name: { type: String, trim: true },
    reserved_account_type: { type: String, trim: true },
    collection_channel: { type: String, trim: true },
    raw_response: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const kycInfoSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED"],
      default: "NOT_SUBMITTED",
    },
    bvn_last4: { type: String, trim: true },
    nin_last4: { type: String, trim: true },
    submitted_at: { type: Date },
    verified_at: { type: Date },
    rejection_reason: { type: String, trim: true },
    response_code: { type: String, trim: true },
    response_message: { type: String, trim: true },
  },
  { _id: false },
);

const walletSchema = new mongoose.Schema(
  {
    wallet_id: { type: String, required: true, unique: true, trim: true },

    // Polymorphic owner: one wallet can belong to a client, business, admin, or rider.
    owner_type: {
      type: String,
      enum: ["USER", "BUSINESS", "ADMIN", "RIDER"],
      required: true,
    },
    owner_model: {
      type: String,
      enum: ["User", "Business", "Admin", "Rider"],
      required: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "owner_model",
      required: true,
    },
    owner_id: { type: String, required: true, trim: true },

    // Backward-compatible direct business relationship used by Business.wallet virtual.
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      unique: true,
      sparse: true,
    },
    business_id: { type: String, trim: true },

    virtual_account_number: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    bank_name: { type: String, required: true, trim: true },
    currency: { type: String, default: "NGN", uppercase: true, trim: true },
    current_balance: { type: Number, required: true, default: 0, min: 0 },
    monnify: { type: monnifyAccountSchema, default: {} },
    kyc_info: { type: kycInfoSchema, default: {} },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },
    last_updated_at: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

walletSchema.index({ owner_type: 1, owner_id: 1 }, { unique: true });
walletSchema.index({ business_id: 1 }, { unique: true, sparse: true });

// One wallet has many transactions.
walletSchema.virtual("transactions", {
  ref: "WalletTransaction",
  localField: "_id",
  foreignField: "wallet",
});

// Allows creating wallets from public IDs, e.g. owner_type=RIDER + owner_id=rdr_990123.
walletSchema.pre("validate", async function () {
  try {
    if (!this.owner_type && this.business_id) {
      this.owner_type = "BUSINESS";
      this.owner_id = this.business_id;
    }

    this.owner_model = ownerModelByType[this.owner_type];

    if (!this.owner_model) {
      throw new Error("A valid wallet owner_type is required");
    }

    if (!this.owner && this.owner_id) {
      const OwnerModel = mongoose.model(this.owner_model);
      const owner = await OwnerModel.findById(this.owner_id).select("_id");

      if (!owner) {
        throw new Error(
          `${this.owner_type} with id "${this.owner_id}" was not found`,
        );
      }

      this.owner = owner._id;
    }

    if (this.owner_type === "BUSINESS") {
      this.business = this.owner;
      this.business_id = this.owner_id;
    }
  } catch (err) {
    throw err;
  }
});

const Wallet = mongoose.model("Wallet", walletSchema);

module.exports = Wallet;
