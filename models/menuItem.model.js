const mongoose = require("mongoose");

const menuItemChoiceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const menuItemOptionGroupSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    min_selection: { type: Number, default: 0, min: 0 },
    max_selection: { type: Number, default: 1, min: 1 },
    required: { type: Boolean, default: false },
    choices: { type: [menuItemChoiceSchema], default: [] },
  },
  { _id: true },
);

const menuItemSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: {
      type: String,
      required: true,
      trim: true,
      default: "General",
    },
    price: { type: Number, required: true, min: 0 },
    image_url: { type: String, trim: true },
    is_available: { type: Boolean, default: true },
    preparation_time_minutes: { type: Number, min: 0, default: 20 },
    dietary_flags: { type: [String], default: [] },
    options: { type: [menuItemOptionGroupSchema], default: [] },
    status: {
      type: String,
      enum: ["ACTIVE", "OUT_OF_STOCK", "ARCHIVED"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

menuItemSchema.index({ business: 1, category: 1 });
menuItemSchema.index({ business: 1, status: 1 });
menuItemSchema.index({ business: 1, is_available: 1 });
menuItemSchema.index({ name: "text", description: "text" });

const MenuItem = mongoose.model("MenuItem", menuItemSchema);

module.exports = MenuItem;
