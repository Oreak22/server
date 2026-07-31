const mongoose = require("mongoose");
const crypto = require("crypto");

const selectedOptionSchema = new mongoose.Schema(
  {
    group_title: { type: String, required: true, trim: true },
    choice_name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const orderItemSchema = new mongoose.Schema(
  {
    menu_item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MenuItem",
      required: true,
    },
    name: { type: String, required: true, trim: true },
    unit_price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, default: 1 },
    selected_options: { type: [selectedOptionSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

const orderPricingSchema = new mongoose.Schema(
  {
    items_total: { type: Number, required: true, min: 0 },
    delivery_fee: { type: Number, default: 0, min: 0 },
    service_fee: { type: Number, default: 0, min: 0 },
    driver_tip: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total_amount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);


const orderDeliveryAddressSchema = new mongoose.Schema(
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

const orderSchema = new mongoose.Schema(
  {
    order_id: {
      type: String,
      unique: true,
      trim: true,
      index: true,
      default: () => `ord_${crypto.randomBytes(6).toString("hex")}`,
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
    items: {
      type: [orderItemSchema],
      required: true,
      validate: [
        (items) => Array.isArray(items) && items.length > 0,
        "Order must contain at least one item",
      ],
    },
    pricing: { type: orderPricingSchema, required: true },
    delivery_address: { type: orderDeliveryAddressSchema, required: true },
    order_status: {
      type: String,
      enum: [
        "PENDING",
        "ACCEPTED",
        "PREPARING",
        "READY_FOR_PICKUP",
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
    accepted_at: { type: Date },
    ready_at: { type: Date },
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

orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ business: 1, order_status: 1 });
orderSchema.index({ rider: 1, order_status: 1 });

const Order = mongoose.model("Order", orderSchema);

module.exports = Order;

