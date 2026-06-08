const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const serviceSchema = new mongoose.Schema(
  {
    service_id: { type: String, trim: true },
    name: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: [
        "LAUNDRY",
        "RESTAURANT",
        "PICKUP_DELIVERY",
        "GROCERY",
        "PHARMACY",
        "RETAIL",
        "OTHER",
      ],
      required: true,
    },
    description: { type: String, trim: true },
    is_active: { type: Boolean, default: true },
    base_price: { type: Number, min: 0 },
  },
  { _id: false },
);

const businessLocationSchema = new mongoose.Schema(
  {
    location_id: { type: String, trim: true },
    label: { type: String, trim: true },
    street_address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    country: { type: String, default: "Nigeria", trim: true },
    coordinates: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator(value) {
            return (
              Array.isArray(value) &&
              value.length === 2 &&
              value[0] >= -180 &&
              value[0] <= 180 &&
              value[1] >= -90 &&
              value[1] <= 90
            );
          },
          message:
            "coordinates must be [longitude, latitude] with valid coordinate values",
        },
      },
    },
    plus_code: { type: String, trim: true },
    is_primary: { type: Boolean, default: false },
  },
  { _id: false },
);

const workingDaySchema = new mongoose.Schema(
  {
    day: {
      type: String,
      enum: [
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ],
      required: true,
    },
    is_open: { type: Boolean, default: true },
    opens_at: {
      type: String,
      required() {
        return this.is_open;
      },
      trim: true,
      validate: {
        validator(value) {
          return !value || timePattern.test(value);
        },
        message: "opens_at must use HH:mm 24-hour format",
      },
    },
    closes_at: {
      type: String,
      required() {
        return this.is_open;
      },
      trim: true,
      validate: {
        validator(value) {
          return !value || timePattern.test(value);
        },
        message: "closes_at must use HH:mm 24-hour format",
      },
    },
  },
  { _id: false },
);

const openStatusSchema = new mongoose.Schema(
  {
    is_open_now: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["OPEN", "CLOSED", "TEMPORARILY_CLOSED"],
      default: "CLOSED",
    },
    reason: { type: String, trim: true },
    last_updated_at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const businessHoursSchema = new mongoose.Schema(
  {
    timezone: { type: String, default: "Africa/Lagos", trim: true },
    working_days: { type: [workingDaySchema], default: [] },
  },
  { _id: false },
);

const businessAuthSchema = new mongoose.Schema(
  {
    password: { type: String, select: false },
    email_verified: { type: Boolean, default: false },
    email_verified_at: { type: Date },
    password_changed_at: { type: Date },
    last_login_at: { type: Date },
  },
  { _id: false },
);

const businessSchema = new mongoose.Schema(
  {
    business_id: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    phone_number: { type: String, required: true, trim: true },
    contact_email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    auth: { type: businessAuthSchema, default: undefined },
    services_rendered: { type: [serviceSchema], default: [] },
    locations: { type: [businessLocationSchema], default: [] },
    open_status: { type: openStatusSchema, default: {} },
    business_hours: { type: businessHoursSchema, default: {} },
    status: {
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

businessSchema.index({ "services_rendered.category": 1 });
businessSchema.index({ "services_rendered.is_active": 1 });
businessSchema.index({ "locations.coordinates": "2dsphere" });
businessSchema.index({ "locations.city": 1, "locations.state": 1 });
businessSchema.index({ "open_status.status": 1 });

businessSchema.path("services_rendered").validate(function (services) {
  const serviceIds = services
    .map((service) => service.service_id)
    .filter(Boolean);

  return serviceIds.length === new Set(serviceIds).size;
}, "services_rendered cannot contain duplicate service_id values");

businessSchema.path("locations").validate(function (locations) {
  const locationIds = locations
    .map((location) => location.location_id)
    .filter(Boolean);

  const hasDuplicateIds = locationIds.length !== new Set(locationIds).size;
  const primaryLocationCount = locations.filter(
    (location) => location.is_primary,
  ).length;

  return !hasDuplicateIds && primaryLocationCount <= 1;
}, "locations cannot contain duplicate location_id values or more than one primary location");

businessSchema.path("business_hours.working_days").validate(function (days) {
  const dayNames = days.map((day) => day.day);
  return dayNames.length === new Set(dayNames).size;
}, "business_hours.working_days cannot contain duplicate days");

businessSchema.pre("save", async function () {
  if (!this.auth?.password || !this.isModified("auth.password")) return;

  try {
    const salt = await bcrypt.genSalt(10);
    this.auth.password = await bcrypt.hash(this.auth.password, salt);
    this.auth.password_changed_at = new Date();
  } catch (err) {
    throw err;
  }
});

businessSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.auth?.password) return false;

  return bcrypt.compare(candidatePassword, this.auth.password);
};

// One business has one wallet.
businessSchema.virtual("wallet", {
  ref: "Wallet",
  localField: "_id",
  foreignField: "business",
  justOne: true,
});

const Business = mongoose.model("Business", businessSchema);

module.exports = Business;
