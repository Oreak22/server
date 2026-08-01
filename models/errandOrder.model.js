const mongoose = require("mongoose");
const crypto = require("crypto");

const errandLocationSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    street_address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    coordinates: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        validate: {
          validator(val) {
            return (
              !val ||
              (Array.isArray(val) &&
                val.length === 2 &&
                val[0] >= -180 &&
                val[0] <= 180 &&
                val[1] >= -90 &&
                val[1] <= 90)
            );
          },
          message: "Coordinates must be valid [longitude, latitude]",
        },
      },
    },
    contact_person: { type: String, trim: true },
    contact_phone: { type: String, trim: true },
    landmark: { type: String, trim: true },
    instructions: { type: String, trim: true },
  },
  { _id: false },
);

const errandPricingSchema = new mongoose.Schema(
  {
    base_fee: { type: Number, required: true, min: 0 },
    distance_fee: { type: Number, default: 0, min: 0 },
    time_complexity_fee: { type: Number, default: 0, min: 0 },
    estimated_item_budget: { type: Number, default: 0, min: 0 },
    service_fee: { type: Number, default: 0, min: 0 },
    driver_tip: { type: Number, default: 0, min: 0 },
    total_amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const errandOrderSchema = new mongoose.Schema(
  {
    order_id: {
      type: String,
      unique: true,
      trim: true,
      default: () => `erd_${crypto.randomBytes(6).toString("hex")}`,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      index: true,
    },
    task_description: {
      type: String,
      required: true,
      trim: true,
    },
    errand_category: {
      type: String,
      enum: [
        "SHOPPING_AND_BUYING",
        "PICKUP_AND_DROP",
        "DOCUMENT_EXPRESS",
        "BILL_PAYMENT",
        "OTHER",
      ],
      default: "SHOPPING_AND_BUYING",
    },
    complexity_tier: {
      type: String,
      enum: [
        "SIMPLE_PICKUP_DROP",
        "GROCERY_SHOPPING",
        "DOCUMENT_OR_BILL_PAYMENT",
        "HEAVY_SPECIALTY_TASK",
      ],
      default: "SIMPLE_PICKUP_DROP",
    },
    estimated_item_budget: {
      type: Number,
      default: 0,
      min: 0,
    },
    errand_location: {
      type: errandLocationSchema,
      required: true,
    },
    dropoff_location: {
      type: errandLocationSchema,
      required: true,
    },
    estimated_distance_km: {
      type: Number,
      default: 0,
      min: 0,
    },
    estimated_duration_minutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    pricing: {
      type: errandPricingSchema,
      required: true,
    },
    order_status: {
      type: String,
      enum: [
        "PENDING",
        "CONFIRMED",
        "ASSIGNED",
        "AT_ERRAND_LOCATION",
        "PURCHASING_IN_PROGRESS",
        "IN_TRANSIT",
        "DELIVERED",
        "CANCELLED",
      ],
      default: "PENDING",
      index: true,
    },
    payment_status: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "REFUNDED"],
      default: "PENDING",
      index: true,
    },
    payment_method: {
      type: String,
      enum: ["WALLET", "MONNIFY", "CASH_ON_DELIVERY"],
      default: "WALLET",
    },
    notes: { type: String, trim: true },
    placed_at: { type: Date, default: Date.now },
    assigned_at: { type: Date },
    arrived_at_errand_location_at: { type: Date },
    purchasing_started_at: { type: Date },
    dispatched_at: { type: Date },
    delivered_at: { type: Date },
    cancelled_at: { type: Date },
    cancellation_reason: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

errandOrderSchema.index({ customer: 1, createdAt: -1 });
errandOrderSchema.index({ rider: 1, order_status: 1 });

const ErrandOrder = mongoose.model("ErrandOrder", errandOrderSchema);

module.exports = ErrandOrder;
