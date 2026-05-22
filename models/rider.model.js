const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const riderPersonalInfoSchema = new mongoose.Schema(
  {
    full_name: { type: String, required: true, trim: true },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    phone_number: { type: String, required: true, unique: true, trim: true },
    emergency_contact: { type: String, required: true, trim: true },
    blood_group: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
      trim: true,
    },
  },
  { _id: false },
);

const employmentDetailsSchema = new mongoose.Schema(
  {
    employment_status: {
      type: String,
      enum: ["FULL_TIME", "PART_TIME", "CONTRACT"],
      required: true,
    },
    base_daily_salary: { type: Number, required: true, min: 0 },
    date_joined: { type: Date, required: true },
  },
  { _id: false },
);

const assignedAssetSchema = new mongoose.Schema(
  {
    vehicle_id: { type: String, required: true, unique: true, trim: true },
    vehicle_type: {
      type: String,
      enum: ["MOTORCYCLE", "BICYCLE", "CAR", "VAN", "TRICYCLE"],
      required: true,
    },
    license_plate: { type: String, required: true, unique: true, trim: true },
    tracker_device_id: { type: String, required: true, unique: true, trim: true },
  },
  { _id: false },
);

const telemetryCoordinatesSchema = new mongoose.Schema(
  {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    altitude_meters: { type: Number },
    heading_degrees: { type: Number, min: 0, max: 360 },
    speed_kmh: { type: Number, min: 0 },
  },
  { _id: false },
);

const liveTelemetrySchema = new mongoose.Schema(
  {
    current_status: {
      type: String,
      enum: ["AVAILABLE", "DELIVERING", "OFFLINE", "ON_BREAK"],
      default: "OFFLINE",
    },
    last_coordinates: { type: telemetryCoordinatesSchema },
    current_active_order_id: { type: String, default: null, trim: true },
    last_ping_time: { type: Date },
  },
  { _id: false },
);

const dailyPerformanceCountersSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    trips_completed_today: { type: Number, default: 0, min: 0 },
    kilometers_traveled_today: { type: Number, default: 0, min: 0 },
    fuel_allowance_allocated_ngn: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const riderAuthSchema = new mongoose.Schema(
  {
    password: { type: String, select: false },
    email_verified: { type: Boolean, default: false },
    email_verified_at: { type: Date },
    password_changed_at: { type: Date },
    last_login_at: { type: Date },
  },
  { _id: false },
);

const riderSchema = new mongoose.Schema(
  {
    rider_id: { type: String, required: true, unique: true, trim: true },
    personal_info: { type: riderPersonalInfoSchema, required: true },
    auth: { type: riderAuthSchema, default: undefined },
    employment_details: { type: employmentDetailsSchema, required: true },
    assigned_asset: { type: assignedAssetSchema, required: true },
    live_telemetry: { type: liveTelemetrySchema, default: {} },
    daily_performance_counters: {
      type: dailyPerformanceCountersSchema,
      required: true,
    },
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

riderSchema.index({ account_status: 1 });
riderSchema.index({ "live_telemetry.current_status": 1 });
riderSchema.index({ "live_telemetry.current_active_order_id": 1 }, { sparse: true });
riderSchema.index({ "daily_performance_counters.date": 1 });

riderSchema.virtual("delivery_wallet", {
  ref: "Wallet",
  localField: "_id",
  foreignField: "owner",
  justOne: true,
});

riderSchema.pre("save", async function (next) {
  if (!this.auth?.password || !this.isModified("auth.password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.auth.password = await bcrypt.hash(this.auth.password, salt);
    this.auth.password_changed_at = new Date();
    next();
  } catch (err) {
    next(err);
  }
});

riderSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.auth?.password) return false;

  return bcrypt.compare(candidatePassword, this.auth.password);
};

const Rider = mongoose.model("Rider", riderSchema);

module.exports = Rider;
