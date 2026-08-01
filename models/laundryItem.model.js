const mongoose = require("mongoose");
const crypto = require("crypto");

const laundryItemSchema = new mongoose.Schema(
  {
    item_id: {
      type: String,
      unique: true,
      trim: true,
      default: () => `lit_${crypto.randomBytes(6).toString("hex")}`,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        "TOPS",
        "BOTTOMS",
        "SUITS_AND_FORMAL",
        "OUTERWEAR",
        "BEDDING_AND_LINEN",
        "BAG_WEIGHT_TIER",
        "OTHER",
      ],
      default: "OTHER",
    },
    supported_services: {
      type: [
        {
          type: String,
          enum: [
            "WASH_AND_FOLD",
            "WASH_AND_IRON",
            "DRY_CLEANING",
            "IRON_ONLY",
            "STAIN_REMOVAL",
          ],
        },
      ],
      required: true,
      validate: [
        (val) => Array.isArray(val) && val.length > 0,
        "At least one supported service option must be specified",
      ],
    },
    pricing_type: {
      type: String,
      enum: ["PER_ITEM", "PER_KG", "BAG_FLAT_RATE"],
      default: "PER_ITEM",
    },
    unit_price: {
      type: Number,
      required: true,
      min: 0,
    },
    description: {
      type: String,
      trim: true,
    },
    image_url: {
      type: String,
      trim: true,
    },
    is_available: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

laundryItemSchema.index({ business: 1, is_available: 1 });
laundryItemSchema.index({ category: 1 });

const LaundryItem = mongoose.model("LaundryItem", laundryItemSchema);

module.exports = LaundryItem;
