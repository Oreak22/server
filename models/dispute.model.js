const mongoose = require("mongoose");
const crypto = require("crypto");

const ownerModelByType = {
  USER: "User",
  BUSINESS: "Business",
  RIDER: "Rider",
  ADMIN: "Admin",
};

const disputeSchema = new mongoose.Schema(
  {
    dispute_id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      default() {
        return `dsp_${crypto.randomBytes(6).toString("hex")}`;
      },
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    opened_by_type: {
      type: String,
      enum: ["USER", "BUSINESS", "RIDER", "ADMIN"],
      required: true,
    },
    opened_by_model: {
      type: String,
      enum: ["User", "Business", "Rider", "Admin"],
      required: true,
    },
    opened_by: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "opened_by_model",
      required: true,
    },
    reason: {
      type: String,
      enum: [
        "ITEM_MISSING",
        "WRONG_ITEM",
        "LATE_DELIVERY",
        "REFUND_REQUEST",
        "DAMAGED_GOODS",
        "OTHER",
      ],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "OPEN",
        "UNDER_INVESTIGATION",
        "RESOLVED_REFUNDED",
        "RESOLVED_REJECTED",
        "CLOSED",
      ],
      default: "OPEN",
    },
    resolution_notes: {
      type: String,
      trim: true,
    },
    refund_amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    assigned_admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    resolved_at: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

disputeSchema.pre("validate", function () {
  if (this.opened_by_type) {
    this.opened_by_model = ownerModelByType[this.opened_by_type];
  }
});

disputeSchema.index({ status: 1 });
disputeSchema.index({ order: 1 });
disputeSchema.index({ opened_by: 1 });

const Dispute = mongoose.model("Dispute", disputeSchema);

module.exports = Dispute;
