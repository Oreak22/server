const mongoose = require("mongoose");

const monnifyWebhookEventSchema = new mongoose.Schema(
  {
    event_reference: { type: String, required: true, unique: true, trim: true },
    event_type: { type: String, required: true, trim: true },
    payment_reference: { type: String, trim: true },
    transaction_reference: { type: String, trim: true },
    wallet: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet" },
    processing_status: {
      type: String,
      enum: ["RECEIVED", "PROCESSED", "IGNORED", "FAILED"],
      default: "RECEIVED",
    },
    raw_payload: { type: mongoose.Schema.Types.Mixed, required: true },
    error_message: { type: String, trim: true },
    processed_at: { type: Date },
  },
  { timestamps: true },
);

monnifyWebhookEventSchema.index({ processing_status: 1, wallet: 1, createdAt: -1 });
monnifyWebhookEventSchema.index({ wallet: 1, createdAt: -1 });

const MonnifyWebhookEvent = mongoose.model(
  "MonnifyWebhookEvent",
  monnifyWebhookEventSchema,
);

module.exports = MonnifyWebhookEvent;
