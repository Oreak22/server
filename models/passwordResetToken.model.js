const crypto = require("crypto");
const mongoose = require("mongoose");

const passwordResetTokenSchema = new mongoose.Schema(
  {
    subject_type: {
      type: String,
      enum: ["USER", "BUSINESS", "ADMIN", "RIDER"],
      required: true,
    },
    subject_model: {
      type: String,
      enum: ["User", "Business", "Admin", "Rider"],
      required: true,
    },
    subject: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "subject_model",
      required: true,
    },
    subject_public_id: { type: String, required: true, trim: true },
    token_hash: { type: String, required: true, unique: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    expires_at: { type: Date, required: true },
    used_at: { type: Date },
    ip_address: { type: String, trim: true },
    user_agent: { type: String, trim: true },
  },
  { timestamps: true },
);

passwordResetTokenSchema.index({ subject_type: 1, subject_public_id: 1 });
passwordResetTokenSchema.index({ email: 1, createdAt: -1 });
passwordResetTokenSchema.index({ expires_at: 1 });

passwordResetTokenSchema.statics.hashToken = function (token) {
  return crypto.createHash("sha256").update(token).digest("hex");
};

const PasswordResetToken = mongoose.model(
  "PasswordResetToken",
  passwordResetTokenSchema,
);

module.exports = PasswordResetToken;
