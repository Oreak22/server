const MonnifyWebhookEvent = require("../models/monnifyWebhookEvent.model");
const {
  verifyWebhookSignature,
} = require("../services/monnify.service");
const {
  creditWallet,
  findWalletForMonnifyEvent,
  toMoney,
} = require("../services/wallet.service");

function getEventData(payload) {
  return payload.eventData || payload;
}

function getEventReference(payload, eventData) {
  return (
    payload.eventReference ||
    eventData.transactionReference ||
    eventData.paymentReference ||
    eventData.transactionHash
  );
}

async function handleWebhook(req, res, next) {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const signature = req.get("monnify-signature");

    // Monnify signs webhook bodies. Reject if the body was changed in transit.
    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ message: "Invalid Monnify signature" });
    }

    const payload = req.body;
    const eventData = getEventData(payload);
    const eventReference = getEventReference(payload, eventData);

    if (!eventReference) {
      return res.status(400).json({ message: "Webhook event reference is missing" });
    }

    let event;
    try {
      event = await MonnifyWebhookEvent.create({
        event_reference: eventReference,
        event_type: payload.eventType || "UNKNOWN",
        payment_reference: eventData.paymentReference,
        transaction_reference: eventData.transactionReference,
        raw_payload: payload,
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.json({ message: "Webhook already processed" });
      }

      throw err;
    }

    const isSuccessfulTransfer =
      payload.eventType === "SUCCESSFUL_TRANSACTION" ||
      eventData.paymentStatus === "PAID";

    if (!isSuccessfulTransfer) {
      event.processing_status = "IGNORED";
      event.processed_at = new Date();
      await event.save();

      return res.json({ message: "Webhook ignored" });
    }

    const wallet = await findWalletForMonnifyEvent(eventData);

    if (!wallet) {
      event.processing_status = "FAILED";
      event.error_message = "Wallet not found for Monnify payment";
      await event.save();

      return res.status(404).json({ message: event.error_message });
    }

    const amount = toMoney(eventData.amountPaid || eventData.amount);

    await creditWallet({
      wallet,
      amount,
      referenceCode: eventData.transactionReference || eventData.paymentReference,
      description: "Wallet Top-up via Monnify Bank Transfer",
      metadata: { monnify_event_reference: eventReference },
    });

    event.wallet = wallet._id;
    event.processing_status = "PROCESSED";
    event.processed_at = new Date();
    await event.save();

    return res.json({ message: "Wallet credited successfully" });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleWebhook,
};
