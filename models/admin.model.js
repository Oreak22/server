const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const adminRoles = ["DISPATCHER", "ACCOUNTANT", "SUPER_ADMIN", "COORDINATOR"];
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const adminPermissions = [
  "MANAGE_ADMINS",
  "MANAGE_BUSINESSES",
  "MANAGE_RIDERS",
  "ASSIGN_ORDERS",
  "VIEW_ORDERS",
  "UPDATE_ORDER_STATUS",
  "VIEW_WALLETS",
  "MANAGE_WALLETS",
  "VIEW_TRANSACTIONS",
  "MANAGE_PAYOUTS",
  "VIEW_REPORTS",
  "MANAGE_SETTINGS",
];

const defaultPermissionsByRole = {
  DISPATCHER: [
    "ASSIGN_ORDERS",
    "VIEW_ORDERS",
    "UPDATE_ORDER_STATUS",
    "MANAGE_RIDERS",
  ],
  ACCOUNTANT: [
    "VIEW_WALLETS",
    "MANAGE_WALLETS",
    "VIEW_TRANSACTIONS",
    "MANAGE_PAYOUTS",
    "VIEW_REPORTS",
  ],
  COORDINATOR: [
    "MANAGE_BUSINESSES",
    "MANAGE_RIDERS",
    "ASSIGN_ORDERS",
    "VIEW_ORDERS",
    "VIEW_REPORTS",
  ],
  SUPER_ADMIN: adminPermissions,
};

const adminProfileSchema = new mongoose.Schema(
  {
    full_name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone_number: { type: String, required: true, unique: true, trim: true },
    avatar_url: { type: String, trim: true },
  },
  { _id: false },
);

const adminEmploymentSchema = new mongoose.Schema(
  {
    staff_id: { type: String, unique: true, sparse: true, trim: true },
    job_title: { type: String, trim: true },
    date_joined: { type: Date, default: Date.now },
    employment_status: {
      type: String,
      enum: ["FULL_TIME", "PART_TIME", "CONTRACT"],
      default: "FULL_TIME",
    },
  },
  { _id: false },
);

const adminAuthSchema = new mongoose.Schema(
  {
    password: { type: String, required: true, select: false },
    email_verified: { type: Boolean, default: false },
    email_verified_at: { type: Date },
    password_changed_at: { type: Date },
    last_login_at: { type: Date },
    mfa_enabled: { type: Boolean, default: false },
  },
  { _id: false },
);

const adminAccessScopeSchema = new mongoose.Schema(
  {
    business_ids: { type: [String], default: [] },
    service_categories: {
      type: [
        {
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
        },
      ],
      default: [],
    },
    cities: { type: [String], default: [] },
    states: { type: [String], default: [] },
  },
  { _id: false },
);

const adminShiftSchema = new mongoose.Schema(
  {
    timezone: { type: String, default: "Africa/Lagos", trim: true },
    working_days: {
      type: [
        {
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
        },
      ],
      default: [],
    },
    starts_at: {
      type: String,
      trim: true,
      validate: {
        validator(value) {
          return !value || timePattern.test(value);
        },
        message: "starts_at must use HH:mm 24-hour format",
      },
    },
    ends_at: {
      type: String,
      trim: true,
      validate: {
        validator(value) {
          return !value || timePattern.test(value);
        },
        message: "ends_at must use HH:mm 24-hour format",
      },
    },
  },
  { _id: false },
);

const adminSchema = new mongoose.Schema(
  {
    admin_id: { type: String, required: true, unique: true, trim: true },
    role: { type: String, enum: adminRoles, required: true },
    profile: { type: adminProfileSchema, required: true },
    employment_details: { type: adminEmploymentSchema, default: {} },
    auth: { type: adminAuthSchema, required: true },
    permissions: {
      type: [{ type: String, enum: adminPermissions }],
      default() {
        return [...(defaultPermissionsByRole[this.role] || [])];
      },
    },
    access_scope: { type: adminAccessScopeSchema, default: {} },
    work_shift: { type: adminShiftSchema, default: {} },
    availability_status: {
      type: String,
      enum: ["ONLINE", "OFFLINE", "ON_BREAK"],
      default: "OFFLINE",
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

adminSchema.index({ role: 1, account_status: 1 });
adminSchema.index({ availability_status: 1 });
adminSchema.index({ "access_scope.business_ids": 1 });
adminSchema.index({ "access_scope.service_categories": 1 });
adminSchema.index({ "access_scope.cities": 1, "access_scope.states": 1 });

adminSchema.virtual("delivery_wallet", {
  ref: "Wallet",
  localField: "_id",
  foreignField: "owner",
  justOne: true,
});

adminSchema.pre("validate", function (next) {
  if (!this.permissions?.length) {
    this.permissions = [...(defaultPermissionsByRole[this.role] || [])];
  }

  next();
});

adminSchema.path("permissions").validate(function (permissions) {
  return permissions.length === new Set(permissions).size;
}, "permissions cannot contain duplicate values");

adminSchema.path("access_scope.business_ids").validate(function (businessIds) {
  return businessIds.length === new Set(businessIds).size;
}, "access_scope.business_ids cannot contain duplicate values");

adminSchema.path("access_scope.service_categories").validate(function (
  categories,
) {
  return categories.length === new Set(categories).size;
}, "access_scope.service_categories cannot contain duplicate values");

adminSchema.path("access_scope.cities").validate(function (cities) {
  return cities.length === new Set(cities).size;
}, "access_scope.cities cannot contain duplicate values");

adminSchema.path("access_scope.states").validate(function (states) {
  return states.length === new Set(states).size;
}, "access_scope.states cannot contain duplicate values");

adminSchema.path("work_shift.working_days").validate(function (workingDays) {
  return workingDays.length === new Set(workingDays).size;
}, "work_shift.working_days cannot contain duplicate values");

adminSchema.pre("save", async function () {
  if (!this.isModified("auth.password")) return;

  try {
    const salt = await bcrypt.genSalt(10);
    this.auth.password = await bcrypt.hash(this.auth.password, salt);
    this.auth.password_changed_at = new Date();
  } catch (err) {
    throw err;
  }
});

adminSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.auth.password);
};

const Admin = mongoose.model("Admin", adminSchema);

module.exports = Admin;
