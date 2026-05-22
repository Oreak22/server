const { debitDeliveryFee } = require("../services/wallet.service");

async function deductDeliveryFee(req, res, next) {
  try {
    const { wallet_id, owner_type, owner_id, order_id, amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: "A valid delivery fee is required" });
    }

    // Called after a trip/order succeeds. This is an atomic balance check + debit.
    const transaction = await debitDeliveryFee({
      wallet_id,
      owner_type,
      owner_id,
      order_id,
      amount: Number(amount),
    });

    return res.status(201).json({
      message: "Delivery fee deducted successfully",
      data: { transaction },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  deductDeliveryFee,
};
