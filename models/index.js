const User = require("./user.model");
const Business = require("./business.model");
const Wallet = require("./wallet.model");
const WalletTransaction = require("./walletTransaction.model");
const Rider = require("./rider.model");
const Admin = require("./admin.model");
const RefreshToken = require("./refreshToken.model");
const MonnifyWebhookEvent = require("./monnifyWebhookEvent.model");
const PasswordResetToken = require("./passwordResetToken.model");
const EmailVerificationCode = require("./emailVerificationCode.model");

module.exports = {
  User,
  Business,
  Wallet,
  WalletTransaction,
  Rider,
  Admin,
  RefreshToken,
  MonnifyWebhookEvent,
  PasswordResetToken,
  EmailVerificationCode,
};
