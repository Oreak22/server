const crypto = require("crypto");
const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
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
    family_id: { type: String, required: true, index: true },
    replaced_by_token_hash: { type: String },
    device_info: { type: String, trim: true },
    ip_address: { type: String, trim: true },
    user_agent: { type: String, trim: true },
    expires_at: { type: Date, required: true },
    revoked_at: { type: Date },
    revoked_reason: { type: String, trim: true },
    last_used_at: { type: Date },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ subject_type: 1, subject_public_id: 1 });
refreshTokenSchema.index({ expires_at: 1 });
refreshTokenSchema.index({ revoked_at: 1 });

refreshTokenSchema.virtual("is_active").get(function () {
  return !this.revoked_at && this.expires_at > new Date();
});

refreshTokenSchema.statics.hashToken = function (token) {
  return crypto.createHash("sha256").update(token).digest("hex");
};

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);

module.exports = RefreshToken;
