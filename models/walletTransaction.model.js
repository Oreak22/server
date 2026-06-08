const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
  {
    transaction_id: { type: String, required: true, unique: true, trim: true },
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },
    wallet_id: { type: String, required: true, trim: true },
    transaction_type: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    balance_before: { type: Number, required: true, min: 0 },
    balance_after: { type: Number, required: true, min: 0 },
    reference_code: { type: String, required: true, unique: true, trim: true },
    description: { type: String, trim: true },
    order_id: { type: String, default: null, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed },
    created_at: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

walletTransactionSchema.index({ wallet: 1, created_at: -1 });
walletTransactionSchema.index({ wallet_id: 1, created_at: -1 });

// Allows creating a transaction with only wallet_id from the API payload.
walletTransactionSchema.pre("validate", async function () {
  try {
    if (this.wallet) return;

    const Wallet = mongoose.model("Wallet");
    const wallet = await Wallet.findOne({ wallet_id: this.wallet_id }).select(
      "_id",
    );

    if (!wallet) {
      throw new Error(
        `Wallet with wallet_id "${this.wallet_id}" was not found`,
      );
    }

    this.wallet = wallet._id;
  } catch (err) {
    throw err;
  }
});

const WalletTransaction = mongoose.model(
  "WalletTransaction",
  walletTransactionSchema,
);

module.exports = WalletTransaction;
