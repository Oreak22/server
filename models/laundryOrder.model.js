const mongoose = require("mongoose");
const crypto = require("crypto");

const laundryOrderItemSchema = new mongoose.Schema(
  {
    laundry_item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LaundryItem",
    },
    name: { type: String, required: true, trim: true },
    unit_price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    subtotal: { type: Number, required: true, min: 0 },
    special_instructions: { type: String, trim: true },
  },
  { _id: true },
);

const laundryBagWeightSchema = new mongoose.Schema(
  {
    weight_kg: { type: Number, min: 0 },
    price_per_kg: { type: Number, min: 0 },
    bag_tier: {
      type: String,
      enum: [
        "SMALL_BAG_5KG",
        "MEDIUM_BAG_10KG",
        "LARGE_BAG_20KG",
        "CUSTOM_WEIGHT",
      ],
      default: "MEDIUM_BAG_10KG",
    },
    subtotal: { type: Number, min: 0 },
  },
  { _id: false },
);

const laundryCarePreferencesSchema = new mongoose.Schema(
  {
    detergent_preference: {
      type: String,
      enum: ["SCENTED", "UNSCENTED", "HYPOALLERGENIC", "PREMIUM_SOFTENER"],
      default: "SCENTED",
    },
    starch_level: {
      type: String,
      enum: ["NO_STARCH", "LIGHT_STARCH", "MEDIUM_STARCH", "HEAVY_STARCH"],
      default: "NO_STARCH",
    },
    is_express_turnover: { type: Boolean, default: false },
    special_instructions: { type: String, trim: true },
  },
  { _id: false },
);

const laundrySlotSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    time_slot: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const laundryAddressSchema = new mongoose.Schema(
  {
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
    instructions: { type: String, trim: true },
  },
  { _id: false },
);

const laundryPricingSchema = new mongoose.Schema(
  {
    items_subtotal: { type: Number, required: true, min: 0 },
    express_fee: { type: Number, default: 0, min: 0 },
    pickup_delivery_fee: { type: Number, default: 0, min: 0 },
    service_fee: { type: Number, default: 0, min: 0 },
    driver_tip: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total_amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const laundryOrderSchema = new mongoose.Schema(
  {
    order_id: {
      type: String,
      unique: true,
      trim: true,
      default: () => `ldr_${crypto.randomBytes(6).toString("hex")}`,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    rider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      index: true,
    },
    service_type: {
      type: String,
      enum: [
        "WASH_AND_FOLD",
        "WASH_AND_IRON",
        "DRY_CLEANING",
        "IRON_ONLY",
        "STAIN_REMOVAL",
        "SPECIALTY_CLEANING",
      ],
      required: true,
    },
    pricing_mode: {
      type: String,
      enum: ["ITEMIZED_INVENTORY", "BAG_WEIGHT"],
      required: true,
    },
    items: {
      type: [laundryOrderItemSchema],
      default: [],
    },
    bag_weight: {
      type: laundryBagWeightSchema,
    },
    care_preferences: {
      type: laundryCarePreferencesSchema,
      default: {},
    },
    pickup_slot: {
      type: laundrySlotSchema,
      required: true,
    },
    return_slot: {
      type: laundrySlotSchema,
      required: true,
    },
    pickup_address: {
      type: laundryAddressSchema,
      required: true,
    },
    return_address: {
      type: laundryAddressSchema,
      required: true,
    },
    pricing: {
      type: laundryPricingSchema,
      required: true,
    },
    order_status: {
      type: String,
      enum: [
        "PENDING",
        "CONFIRMED",
        "PICKUP_SCHEDULED",
        "PICKED_UP",
        "RECEIVED_AT_FACILITY",
        "WASHING_IN_PROGRESS",
        "IRONING_AND_FOLDING",
        "READY_FOR_DELIVERY",
        "OUT_FOR_DELIVERY",
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
    picked_up_at: { type: Date },
    washing_started_at: { type: Date },
    ready_for_delivery_at: { type: Date },
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

laundryOrderSchema.index({ customer: 1, createdAt: -1 });
laundryOrderSchema.index({ business: 1, order_status: 1 });
laundryOrderSchema.index({ rider: 1, order_status: 1 });

const LaundryOrder = mongoose.model("LaundryOrder", laundryOrderSchema);

module.exports = LaundryOrder;
