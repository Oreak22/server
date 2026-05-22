const crypto = require("crypto");
const mongoose = require("mongoose");

const emailVerificationCodeSchema = new mongoose.Schema(
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
    email: { type: String, required: true, lowercase: true, trim: true },
    code_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
    used_at: { type: Date },
    ip_address: { type: String, trim: true },
    user_agent: { type: String, trim: true },
  },
  { timestamps: true },
);

emailVerificationCodeSchema.index({
  subject_type: 1,
  subject_public_id: 1,
  createdAt: -1,
});
emailVerificationCodeSchema.index({ email: 1, createdAt: -1 });
emailVerificationCodeSchema.index({ expires_at: 1 });

emailVerificationCodeSchema.statics.hashCode = function (code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
};

const EmailVerificationCode = mongoose.model(
  "EmailVerificationCode",
  emailVerificationCodeSchema,
);

module.exports = EmailVerificationCode;
