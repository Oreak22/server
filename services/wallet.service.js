const crypto = require("crypto");
const mongoose = require("mongoose");
const Wallet = require("../models/wallet.model");
const WalletTransaction = require("../models/walletTransaction.model");

function makeWalletId() {
  return `wal_${crypto.randomBytes(6).toString("hex")}`;
}

function makeTransactionId(prefix = "trx") {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function pickPrimaryMonnifyAccount(monnifyAccount) {
  const [account] = monnifyAccount.accounts || [];

  if (!account) {
    throw new Error("Monnify did not return a reserved bank account");
  }

  return account;
}

function last4(value) {
  const text = String(value || "").trim();
  return text ? text.slice(-4) : undefined;
}

async function createWalletFromMonnifyAccount({
  ownerType,
  owner,
  monnifyAccount,
  kyc,
}) {
  const account = pickPrimaryMonnifyAccount(monnifyAccount);
  const publicIdField = `id`;
  const hasKyc = Boolean(kyc?.bvn || kyc?.nin);

  return Wallet.create({
    wallet_id: makeWalletId(),
    owner_type: ownerType,
    owner_model: owner.constructor.modelName,
    owner: owner._id,
    owner_id: owner[publicIdField],
    virtual_account_number: account.accountNumber,
    bank_name: account.bankName,
    currency: monnifyAccount.currencyCode || "NGN",
    current_balance: 0,
    monnify: {
      account_reference: monnifyAccount.accountReference,
      reservation_reference: monnifyAccount.reservationReference,
      account_name: account.accountName || monnifyAccount.accountName,
      bank_code: account.bankCode,
      contract_code: monnifyAccount.contractCode,
      customer_email: monnifyAccount.customerEmail,
      customer_name: monnifyAccount.customerName,
      reserved_account_type: monnifyAccount.reservedAccountType,
      collection_channel: monnifyAccount.collectionChannel,
      raw_response: monnifyAccount,
    },
    kyc_info: hasKyc
      ? {
          status: "VERIFIED",
          bvn_last4: last4(kyc.bvn),
          nin_last4: last4(kyc.nin),
          submitted_at: new Date(),
          verified_at: new Date(),
        }
      : undefined,
  });
}

async function creditWallet({
  wallet,
  amount,
  referenceCode,
  description,
  metadata,
}) {
  const existingTransaction = await WalletTransaction.findOne({
    reference_code: referenceCode,
  });

  if (existingTransaction) return existingTransaction;

  let transaction;
  try {
    transaction = await WalletTransaction.create({
      transaction_id: makeTransactionId(),
      wallet: wallet._id,
      wallet_id: wallet.wallet_id,
      transaction_type: "CREDIT",
      amount,
      balance_before: wallet.current_balance,
      balance_after: wallet.current_balance,
      reference_code: referenceCode,
      description,
      metadata,
    });
  } catch (err) {
    if (err.code === 11000) {
      return WalletTransaction.findOne({ reference_code: referenceCode });
    }

    throw err;
  }

  const updatedWallet = await Wallet.findOneAndUpdate(
    { _id: wallet._id, status: "ACTIVE" },
    {
      $inc: { current_balance: amount },
      $set: { last_updated_at: new Date() },
    },
    { new: true },
  );

  if (!updatedWallet) {
    await WalletTransaction.deleteOne({ _id: transaction._id });
    throw new Error("Wallet is not active or could not be credited");
  }

  const balanceAfter = updatedWallet.current_balance;

  transaction.balance_before = balanceAfter - amount;
  transaction.balance_after = balanceAfter;

  return transaction.save();
}

async function debitDeliveryFee({
  wallet_id,
  owner_type,
  owner_id,
  order_id,
  amount,
}) {
  const query = {
    status: "ACTIVE",
    current_balance: { $gte: amount },
  };

  if (wallet_id) query.wallet_id = wallet_id;
  if (owner_type) query.owner_type = owner_type;
  if (owner_id) query.owner_id = owner_id;

  const referenceCode = `DEL_${order_id || crypto.randomUUID()}`;
  const existingTransaction = await WalletTransaction.findOne({
    reference_code: referenceCode,
  });

  if (existingTransaction) return existingTransaction;

  const wallet = await Wallet.findOne(query);

  if (!wallet) {
    throw new Error("Insufficient wallet balance or wallet not found");
  }

  // Write the unique transaction record before debiting so retries cannot double-charge.
  let transaction;
  try {
    transaction = await WalletTransaction.create({
      transaction_id: makeTransactionId("del"),
      wallet: wallet._id,
      wallet_id: wallet.wallet_id,
      transaction_type: "DEBIT",
      amount,
      balance_before: wallet.current_balance,
      balance_after: wallet.current_balance,
      reference_code: referenceCode,
      description: order_id
        ? `Delivery Fee for Order #${order_id}`
        : "Delivery Fee for Completed Trip",
      order_id: order_id || null,
    });
  } catch (err) {
    if (err.code === 11000) {
      return WalletTransaction.findOne({ reference_code: referenceCode });
    }

    throw err;
  }

  const updatedWallet = await Wallet.findOneAndUpdate(
    { _id: wallet._id, status: "ACTIVE", current_balance: { $gte: amount } },
    {
      $inc: { current_balance: -amount },
      $set: { last_updated_at: new Date() },
    },
    { new: true },
  );

  if (!updatedWallet) {
    await WalletTransaction.deleteOne({ _id: transaction._id });
    throw new Error("Insufficient wallet balance or wallet not found");
  }

  const balanceAfter = updatedWallet.current_balance;

  transaction.balance_before = balanceAfter + amount;
  transaction.balance_after = balanceAfter;

  return transaction.save();
}

async function findWalletForMonnifyEvent(eventData) {
  const accountReference = eventData.product?.reference;
  const accountNumber = eventData.destinationAccountInformation?.accountNumber;

  return Wallet.findOne({
    $or: [
      { "monnify.account_reference": accountReference },
      { virtual_account_number: accountNumber },
    ].filter((condition) => Object.values(condition)[0]),
  });
}

function toMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

module.exports = {
  createWalletFromMonnifyAccount,
  creditWallet,
  debitDeliveryFee,
  findWalletForMonnifyEvent,
  makeWalletId,
  toMoney,
};
