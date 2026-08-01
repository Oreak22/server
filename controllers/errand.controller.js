const mongoose = require("mongoose");
const crypto = require("crypto");
const ErrandOrder = require("../models/errandOrder.model");
const Rider = require("../models/rider.model");
const Wallet = require("../models/wallet.model");
const WalletTransaction = require("../models/walletTransaction.model");
const socketService = require("../services/socket.service");

/**
 * Calculate Haversine distance in kilometers between two GPS coordinates
 */
function calculateHaversineDistance(coords1, coords2) {
  if (!coords1 || !coords2 || !Array.isArray(coords1) || !Array.isArray(coords2)) {
    return 3.5; // default fallback distance in km
  }
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;

  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Math.round(distance * 10) / 10;
}

/**
 * Time & Complexity Fee Calculator helper
 */
function computeErrandPricing({
  errand_location,
  dropoff_location,
  complexity_tier = "SIMPLE_PICKUP_DROP",
  estimated_item_budget = 0,
  driver_tip = 0,
}) {
  const coords1 = errand_location?.coordinates?.coordinates;
  const coords2 = dropoff_location?.coordinates?.coordinates;
  const distanceKm = calculateHaversineDistance(coords1, coords2);
  const estimatedDurationMinutes = Math.round(distanceKm * 4 + 15);

  const baseFee = 1000;
  const distanceFee = distanceKm > 3 ? Math.round((distanceKm - 3) * 150) : 0;

  const complexitySurcharges = {
    SIMPLE_PICKUP_DROP: 0,
    GROCERY_SHOPPING: 1500,
    DOCUMENT_OR_BILL_PAYMENT: 1000,
    HEAVY_SPECIALTY_TASK: 2500,
  };
  const timeComplexityFee = complexitySurcharges[complexity_tier] || 0;
  const itemBudget = Number(estimated_item_budget) || 0;
  const serviceFee = 300;
  const tip = Number(driver_tip) || 0;

  const totalAmount = baseFee + distanceFee + timeComplexityFee + itemBudget + serviceFee + tip;

  return {
    estimated_distance_km: distanceKm,
    estimated_duration_minutes: estimatedDurationMinutes,
    pricing: {
      base_fee: baseFee,
      distance_fee: distanceFee,
      time_complexity_fee: timeComplexityFee,
      estimated_item_budget: itemBudget,
      service_fee: serviceFee,
      driver_tip: tip,
      total_amount: totalAmount,
    },
  };
}

/**
 * @desc Calculate dynamic time & complexity estimate for an errand request
 * @route POST /api/v1/errands/estimate
 * @access Public / Private
 */
async function calculateErrandEstimate(req, res, next) {
  try {
    const { errand_location, dropoff_location, complexity_tier, estimated_item_budget, driver_tip } = req.body;

    if (!errand_location || !dropoff_location) {
      return res.status(400).json({ message: "errand_location and dropoff_location are required" });
    }

    const estimation = computeErrandPricing({
      errand_location,
      dropoff_location,
      complexity_tier,
      estimated_item_budget,
      driver_tip,
    });

    return res.json({
      message: "Errand fee estimate calculated successfully",
      success: true,
      data: estimation,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Create a new Errand Order with Task Description & Locations
 * @route POST /api/v1/errands/orders
 * @access Private (USER)
 */
async function createErrandOrder(req, res, next) {
  try {
    const customerId = req.auth.sub;
    const {
      task_description,
      errand_category = "SHOPPING_AND_BUYING",
      complexity_tier = "SIMPLE_PICKUP_DROP",
      estimated_item_budget = 0,
      errand_location,
      dropoff_location,
      driver_tip = 0,
      notes,
    } = req.body;

    if (!task_description || !errand_location || !dropoff_location) {
      return res.status(400).json({
        message: "task_description, errand_location, and dropoff_location are required",
      });
    }

    const estimation = computeErrandPricing({
      errand_location,
      dropoff_location,
      complexity_tier,
      estimated_item_budget,
      driver_tip,
    });

    const order = await ErrandOrder.create({
      customer: customerId,
      task_description,
      errand_category,
      complexity_tier,
      estimated_item_budget: Number(estimated_item_budget),
      errand_location,
      dropoff_location,
      estimated_distance_km: estimation.estimated_distance_km,
      estimated_duration_minutes: estimation.estimated_duration_minutes,
      pricing: estimation.pricing,
      notes,
    });

    const populatedOrder = await ErrandOrder.findById(order._id).populate("customer", "profile");

    // Broadcast new available errand offer to rider pool
    socketService.getIO()?.emit("errand_order_placed", {
      order_id: order.order_id,
      task_description,
      estimated_distance_km: estimation.estimated_distance_km,
      total_amount: estimation.pricing.total_amount,
    });

    return res.status(201).json({
      message: `Errand request created successfully with Order ID ${order.order_id}`,
      success: true,
      data: { order: populatedOrder },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Pay for an Errand order using customer's delivery wallet
 * @route POST /api/v1/errands/orders/:orderId/pay
 * @access Private (USER)
 */
async function payErrandOrder(req, res, next) {
  try {
    const customerId = req.auth.sub;
    const { orderId } = req.params;

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await ErrandOrder.findOne({ ...lookup, customer: customerId });
    if (!order) {
      return res.status(404).json({ message: "Errand order not found" });
    }

    if (order.payment_status === "PAID") {
      return res.status(400).json({ message: "Errand order is already paid" });
    }

    const wallet = await Wallet.findOne({ owner: customerId, owner_type: "USER" });
    if (!wallet) {
      return res.status(404).json({ message: "Customer wallet not found" });
    }

    const totalAmount = order.pricing.total_amount;
    if (wallet.current_balance < totalAmount) {
      return res.status(400).json({
        message: `Insufficient balance. Wallet balance: ₦${wallet.current_balance}, Required: ₦${totalAmount}`,
      });
    }

    const balanceBefore = wallet.current_balance;
    wallet.current_balance -= totalAmount;
    const balanceAfter = wallet.current_balance;
    wallet.last_updated_at = new Date();
    await wallet.save();

    await WalletTransaction.create({
      transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
      wallet: wallet._id,
      wallet_id: wallet.wallet_id,
      transaction_type: "DEBIT",
      amount: totalAmount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      reference_code: `ERRAND_PAY_${order.order_id}_${Date.now()}`,
      description: `Payment for errand order ${order.order_id}`,
      order_id: order.order_id,
    });

    order.payment_status = "PAID";
    order.order_status = "CONFIRMED";
    await order.save();

    socketService.notifyOrderStatusUpdated(order.order_id, "CONFIRMED", {
      payment_status: "PAID",
    });

    return res.json({
      message: "Errand order paid successfully with wallet balance",
      success: true,
      data: { order },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Update errand order status & credit rider payout on completion
 * @route PATCH /api/v1/errands/orders/:orderId/status
 * @access Private (RIDER / ADMIN)
 */
async function updateErrandOrderStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const { order_status, rider_id } = req.body;

    const validStatuses = [
      "CONFIRMED",
      "ASSIGNED",
      "AT_ERRAND_LOCATION",
      "PURCHASING_IN_PROGRESS",
      "IN_TRANSIT",
      "DELIVERED",
      "CANCELLED",
    ];

    if (!order_status || !validStatuses.includes(order_status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await ErrandOrder.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Errand order not found" });
    }

    const activeRiderId = rider_id || (req.auth.subject_type === "RIDER" ? req.auth.sub : null);
    if (activeRiderId) {
      const rider = await Rider.findById(activeRiderId);
      if (rider) {
        order.rider = rider._id;
        rider.live_telemetry.current_status = "DELIVERING";
        rider.live_telemetry.current_active_order_id = order.order_id;
        await rider.save();
      }
    }

    const now = new Date();
    order.order_status = order_status;

    if (order_status === "ASSIGNED") order.assigned_at = now;
    if (order_status === "AT_ERRAND_LOCATION") order.arrived_at_errand_location_at = now;
    if (order_status === "PURCHASING_IN_PROGRESS") order.purchasing_started_at = now;
    if (order_status === "IN_TRANSIT") order.dispatched_at = now;

    if (order_status === "DELIVERED") {
      order.delivered_at = now;

      if (order.rider) {
        const rider = await Rider.findById(order.rider);
        if (rider) {
          // Rider receives errand execution fee (base + distance + complexity + tip)
          const riderEarnings =
            (order.pricing.base_fee || 0) +
            (order.pricing.distance_fee || 0) +
            (order.pricing.time_complexity_fee || 0) +
            (order.pricing.driver_tip || 0);

          if (riderEarnings > 0) {
            const riderWallet = await Wallet.findOne({ owner: rider._id, owner_type: "RIDER" });
            if (riderWallet) {
              const balanceBefore = riderWallet.current_balance;
              riderWallet.current_balance += riderEarnings;
              const balanceAfter = riderWallet.current_balance;
              riderWallet.last_updated_at = now;
              await riderWallet.save();

              await WalletTransaction.create({
                transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
                wallet: riderWallet._id,
                wallet_id: riderWallet.wallet_id,
                transaction_type: "CREDIT",
                amount: riderEarnings,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
                reference_code: `ERRAND_RIDER_PAY_${order.order_id}`,
                description: `Payout for errand order ${order.order_id}`,
                order_id: order.order_id,
              });
            }
          }

          rider.live_telemetry.current_status = "AVAILABLE";
          rider.live_telemetry.current_active_order_id = null;
          rider.daily_performance_counters.trips_completed_today += 1;
          await rider.save();
        }
      }
    }

    await order.save();

    socketService.notifyOrderStatusUpdated(order.order_id, order_status);

    return res.json({
      message: `Errand order status updated to ${order_status}`,
      success: true,
      data: { order },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Cancel errand order & refund wallet if paid
 * @route POST /api/v1/errands/orders/:orderId/cancel
 * @access Private (USER / ADMIN)
 */
async function cancelErrandOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await ErrandOrder.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Errand order not found" });
    }

    if (["DELIVERED", "CANCELLED"].includes(order.order_status)) {
      return res.status(400).json({ message: `Cannot cancel order with status ${order.order_status}` });
    }

    if (order.payment_status === "PAID") {
      const wallet = await Wallet.findOne({ owner: order.customer, owner_type: "USER" });
      if (wallet) {
        const amountToRefund = order.pricing.total_amount;
        const balanceBefore = wallet.current_balance;
        wallet.current_balance += amountToRefund;
        const balanceAfter = wallet.current_balance;
        wallet.last_updated_at = new Date();
        await wallet.save();

        await WalletTransaction.create({
          transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
          wallet: wallet._id,
          wallet_id: wallet.wallet_id,
          transaction_type: "CREDIT",
          amount: amountToRefund,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          reference_code: `ERRAND_REFUND_${order.order_id}`,
          description: `Refund for cancelled errand order ${order.order_id}`,
          order_id: order.order_id,
        });

        order.payment_status = "REFUNDED";
      }
    }

    order.order_status = "CANCELLED";
    order.cancelled_at = new Date();
    order.cancellation_reason = reason || "Cancelled by user";
    await order.save();

    socketService.notifyOrderStatusUpdated(order.order_id, "CANCELLED");

    return res.json({
      message: "Errand order cancelled successfully",
      success: true,
      data: { order },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get list of errand orders based on user role
 * @route GET /api/v1/errands/orders
 * @access Private
 */
async function getErrandOrders(req, res, next) {
  try {
    const actorType = req.auth.subject_type;
    const actorId = req.auth.sub;

    let filter = {};
    if (actorType === "USER") filter.customer = actorId;
    else if (actorType === "RIDER") filter.rider = actorId;

    const orders = await ErrandOrder.find(filter)
      .populate("customer", "profile")
      .populate("rider", "personal_info assigned_asset")
      .sort({ createdAt: -1 });

    return res.json({
      message: "Errand orders retrieved successfully",
      success: true,
      data: { orders },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  calculateErrandEstimate,
  createErrandOrder,
  payErrandOrder,
  updateErrandOrderStatus,
  cancelErrandOrder,
  getErrandOrders,
};
