const mongoose = require("mongoose");
const Order = require("../models/order.model");
const MenuItem = require("../models/menuItem.model");
const Business = require("../models/business.model");
const User = require("../models/user.model");
const Rider = require("../models/rider.model");
const Wallet = require("../models/wallet.model");
const WalletTransaction = require("../models/walletTransaction.model");
const socketService = require("../services/socket.service");
const crypto = require("crypto");

/**
 * @desc Place a new customer food order
 * @route POST /api/v1/orders
 * @access Private (USER)
 */
async function createOrder(req, res, next) {
  try {
    if (req.auth.subject_type !== "USER") {
      return res.status(403).json({ message: "Only registered customers can place orders" });
    }

    const customerId = req.auth.sub;
    const { business: businessId, items, delivery_address, notes, payment_method } = req.body;

    if (!businessId || !mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ message: "A valid business ID is required" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Order must contain at least one item" });
    }

    if (!delivery_address || !delivery_address.street_address || !delivery_address.city || !delivery_address.state) {
      return res.status(400).json({ message: "Complete street address, city, and state are required" });
    }

    const business = await Business.findById(businessId);
    if (!business || business.status !== "ACTIVE") {
      return res.status(404).json({ message: "Restaurant business not found or inactive" });
    }

    // Process and validate each ordered item server-side
    let itemsTotal = 0;
    const processedItems = [];

    for (const itemInput of items) {
      if (!itemInput.menu_item || !mongoose.Types.ObjectId.isValid(itemInput.menu_item)) {
        return res.status(400).json({ message: "Invalid menu item ID provided" });
      }

      const menuItem = await MenuItem.findById(itemInput.menu_item);
      if (!menuItem || String(menuItem.business) !== String(businessId)) {
        return res.status(400).json({ message: `Menu item "${itemInput.name || itemInput.menu_item}" was not found for this restaurant` });
      }

      if (!menuItem.is_available || menuItem.status !== "ACTIVE") {
        return res.status(400).json({ message: `Item "${menuItem.name}" is currently out of stock or unavailable` });
      }

      const quantity = Math.max(1, parseInt(itemInput.quantity, 10) || 1);
      const unitPrice = menuItem.price;

      // Calculate options extra price
      let optionsExtraPrice = 0;
      const selectedOptions = [];

      if (Array.isArray(itemInput.selected_options)) {
        for (const opt of itemInput.selected_options) {
          const optPrice = Math.max(0, Number(opt.price) || 0);
          optionsExtraPrice += optPrice;
          selectedOptions.push({
            group_title: opt.group_title || "Option",
            choice_name: opt.choice_name,
            price: optPrice,
          });
        }
      }

      const itemSubtotal = (unitPrice + optionsExtraPrice) * quantity;
      itemsTotal += itemSubtotal;

      processedItems.push({
        menu_item: menuItem._id,
        name: menuItem.name,
        unit_price: unitPrice,
        quantity,
        selected_options: selectedOptions,
        subtotal: itemSubtotal,
      });
    }

    const deliveryFee = Number(req.body.delivery_fee) || 500; // standard delivery fee NGN
    const serviceFee = Number(req.body.service_fee) || 100; // platform service fee NGN
    const driverTip = Math.max(0, Number(req.body.driver_tip) || 0);
    const discount = Math.max(0, Number(req.body.discount) || 0);
    const totalAmount = itemsTotal + deliveryFee + serviceFee + driverTip - discount;

    const order = await Order.create({
      customer: customerId,
      business: businessId,
      items: processedItems,
      pricing: {
        items_total: itemsTotal,
        delivery_fee: deliveryFee,
        service_fee: serviceFee,
        driver_tip: driverTip,
        discount,
        total_amount: totalAmount,
      },

      delivery_address: {
        street_address: delivery_address.street_address,
        city: delivery_address.city,
        state: delivery_address.state,
        coordinates: delivery_address.coordinates,
        instructions: delivery_address.instructions,
      },
      order_status: "PENDING",
      payment_status: "PENDING",
      payment_method: payment_method || "WALLET",
      notes: notes || "",
    });

    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "profile")
      .populate("business", "name phone_number locations open_status");

    // Real-time WebSocket notification
    socketService.notifyOrderCreated(populatedOrder);

    return res.status(201).json({
      message: "Order placed successfully",
      success: true,
      data: { order: populatedOrder },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get order list for authenticated user/business
 * @route GET /api/v1/orders
 * @access Private
 */
async function getMyOrders(req, res, next) {
  try {
    const { subject_type, sub } = req.auth;
    const { order_status, payment_status, page = 1, limit = 10 } = req.query;

    const filter = {};

    if (subject_type === "USER") {
      filter.customer = sub;
    } else if (subject_type === "BUSINESS") {
      filter.business = sub;
    } else if (subject_type === "RIDER") {
      filter.rider = sub;
    }

    if (order_status) {
      filter.order_status = order_status;
    }

    if (payment_status) {
      filter.payment_status = payment_status;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("customer", "profile")
        .populate("business", "name phone_number locations")
        .populate("items.menu_item", "name image_url price")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Order.countDocuments(filter),
    ]);

    return res.json({
      message: "Orders fetched successfully",
      success: true,
      data: {
        orders,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum) || 1,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get single order details
 * @route GET /api/v1/orders/:orderId
 * @access Private
 */
async function getOrderById(req, res, next) {
  try {
    const { orderId } = req.params;
    const { subject_type, sub } = req.auth;

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await Order.findOne(lookup)
      .populate("customer", "profile")
      .populate("business", "name phone_number locations contact_email")
      .populate("rider", "personal_info assigned_asset live_telemetry")
      .populate("items.menu_item");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Authorization check
    const isCustomer = subject_type === "USER" && String(order.customer._id || order.customer) === String(sub);
    const isBusiness = subject_type === "BUSINESS" && String(order.business._id || order.business) === String(sub);
    const isRider = subject_type === "RIDER" && String(order.rider?._id || order.rider) === String(sub);
    const isAdmin = subject_type === "ADMIN";

    if (!isCustomer && !isBusiness && !isRider && !isAdmin) {
      return res.status(403).json({ message: "Unauthorized to access this order" });
    }

    return res.json({
      message: "Order details fetched successfully",
      success: true,
      data: { order },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Edit pending unpaid order details
 * @route PUT /api/v1/orders/:orderId
 * @access Private (USER / ADMIN)
 */
async function updateOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const { subject_type, sub } = req.auth;

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await Order.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (subject_type === "USER" && String(order.customer) !== String(sub)) {
      return res.status(403).json({ message: "Unauthorized to edit this order" });
    }

    if (order.order_status !== "PENDING" || order.payment_status === "PAID") {
      return res.status(400).json({ message: "Order cannot be edited once accepted or paid" });
    }

    if (req.body.delivery_address) {
      const addr = req.body.delivery_address;
      if (addr.street_address) order.delivery_address.street_address = addr.street_address;
      if (addr.city) order.delivery_address.city = addr.city;
      if (addr.state) order.delivery_address.state = addr.state;
      if (addr.instructions !== undefined) order.delivery_address.instructions = addr.instructions;
      if (addr.coordinates) order.delivery_address.coordinates = addr.coordinates;
    }

    if (req.body.notes !== undefined) {
      order.notes = req.body.notes;
    }

    await order.save();

    return res.json({
      message: "Order updated successfully",
      success: true,
      data: { order },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Cancel an order and process automatic wallet refund if paid
 * @route POST /api/v1/orders/:orderId/cancel
 * @access Private (USER / BUSINESS / ADMIN)
 */
async function cancelOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const { subject_type, sub } = req.auth;
    const { reason } = req.body;

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await Order.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Permission check
    const isCustomer = subject_type === "USER" && String(order.customer) === String(sub);
    const isBusiness = subject_type === "BUSINESS" && String(order.business) === String(sub);
    const isAdmin = subject_type === "ADMIN";

    if (!isCustomer && !isBusiness && !isAdmin) {
      return res.status(403).json({ message: "Unauthorized to cancel this order" });
    }

    if (["PREPARING", "READY_FOR_PICKUP", "IN_TRANSIT", "DELIVERED"].includes(order.order_status)) {
      return res.status(400).json({ message: `Cannot cancel order in "${order.order_status}" stage. Contact support.` });
    }

    if (order.order_status === "CANCELLED") {
      return res.status(400).json({ message: "Order is already cancelled" });
    }

    let refundProcessed = false;
    let refundedAmount = 0;

    // Automatic Refund if paid via wallet
    if (order.payment_status === "PAID" && order.payment_method === "WALLET") {
      const customerWallet = await Wallet.findOne({ owner: order.customer, owner_type: "USER" });

      if (customerWallet) {
        const refundAmount = order.pricing.total_amount;
        const balanceBefore = customerWallet.current_balance;
        customerWallet.current_balance += refundAmount;
        const balanceAfter = customerWallet.current_balance;
        customerWallet.last_updated_at = new Date();
        await customerWallet.save();

        const refundTxnRef = `REFUND_${order.order_id}_${crypto.randomBytes(4).toString("hex")}`;
        await WalletTransaction.create({
          transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
          wallet: customerWallet._id,
          wallet_id: customerWallet.wallet_id,
          transaction_type: "CREDIT",
          amount: refundAmount,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          reference_code: refundTxnRef,
          description: `Refund for cancelled order ${order.order_id}`,
          order_id: order.order_id,
          metadata: { cancelled_by: subject_type, reason: reason || "User requested cancellation" },
        });

        // Debit business wallet if business was credited
        const businessWallet = await Wallet.findOne({ owner: order.business, owner_type: "BUSINESS" });
        if (businessWallet && businessWallet.current_balance >= refundAmount) {
          const bizBalanceBefore = businessWallet.current_balance;
          businessWallet.current_balance -= refundAmount;
          const bizBalanceAfter = businessWallet.current_balance;
          businessWallet.last_updated_at = new Date();
          await businessWallet.save();

          await WalletTransaction.create({
            transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
            wallet: businessWallet._id,
            wallet_id: businessWallet.wallet_id,
            transaction_type: "DEBIT",
            amount: refundAmount,
            balance_before: bizBalanceBefore,
            balance_after: bizBalanceAfter,
            reference_code: `DEBIT_CANCEL_${order.order_id}_${crypto.randomBytes(4).toString("hex")}`,
            description: `Reversal for cancelled order ${order.order_id}`,
            order_id: order.order_id,
          });
        }

        refundProcessed = true;
        refundedAmount = refundAmount;
        order.payment_status = "REFUNDED";
      }
    }

    order.order_status = "CANCELLED";
    order.cancelled_at = new Date();
    order.cancellation_reason = reason || `Cancelled by ${subject_type.toLowerCase()}`;
    await order.save();

    // Real-time WebSocket notification
    socketService.notifyOrderCancelled(order, {
      refund_processed: refundProcessed,
      refunded_amount: refundedAmount,
    });

    return res.json({
      message: refundProcessed
        ? `Order cancelled successfully. ₦${refundedAmount.toLocaleString()} has been refunded to customer wallet.`
        : "Order cancelled successfully.",
      success: true,
      data: {
        order,
        refund_processed: refundProcessed,
        refunded_amount: refundedAmount,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Pay for an order using customer wallet
 * @route POST /api/v1/orders/:orderId/pay
 * @access Private (USER)
 */
async function payOrderWithWallet(req, res, next) {
  try {
    if (req.auth.subject_type !== "USER") {
      return res.status(403).json({ message: "Only customer users can pay for orders" });
    }

    const { orderId } = req.params;
    const customerId = req.auth.sub;

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await Order.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (String(order.customer) !== String(customerId)) {
      return res.status(403).json({ message: "Unauthorized to pay for this order" });
    }

    if (order.payment_status === "PAID") {
      return res.status(400).json({ message: "Order is already paid" });
    }

    if (order.order_status === "CANCELLED") {
      return res.status(400).json({ message: "Cannot pay for a cancelled order" });
    }

    const customerWallet = await Wallet.findOne({ owner: customerId, owner_type: "USER" });
    if (!customerWallet) {
      return res.status(404).json({ message: "Customer delivery wallet not found. Contact support." });
    }

    const totalAmount = order.pricing.total_amount;

    if (customerWallet.current_balance < totalAmount) {
      return res.status(400).json({
        message: `Insufficient wallet balance. Total amount is ₦${totalAmount.toLocaleString()}, but your current wallet balance is ₦${customerWallet.current_balance.toLocaleString()}. Please top up your wallet.`,
        required_amount: totalAmount,
        current_balance: customerWallet.current_balance,
      });
    }

    // Debit customer wallet
    const balanceBefore = customerWallet.current_balance;
    customerWallet.current_balance -= totalAmount;
    const balanceAfter = customerWallet.current_balance;
    customerWallet.last_updated_at = new Date();
    await customerWallet.save();

    const paymentTxnRef = `PAY_ORD_${order.order_id}_${crypto.randomBytes(4).toString("hex")}`;
    const customerTxn = await WalletTransaction.create({
      transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
      wallet: customerWallet._id,
      wallet_id: customerWallet.wallet_id,
      transaction_type: "DEBIT",
      amount: totalAmount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      reference_code: paymentTxnRef,
      description: `Payment for order ${order.order_id}`,
      order_id: order.order_id,
    });

    // Credit business wallet
    const businessWallet = await Wallet.findOne({ owner: order.business, owner_type: "BUSINESS" });
    if (businessWallet) {
      const bizBalanceBefore = businessWallet.current_balance;
      businessWallet.current_balance += totalAmount;
      const bizBalanceAfter = businessWallet.current_balance;
      businessWallet.last_updated_at = new Date();
      await businessWallet.save();

      await WalletTransaction.create({
        transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
        wallet: businessWallet._id,
        wallet_id: businessWallet.wallet_id,
        transaction_type: "CREDIT",
        amount: totalAmount,
        balance_before: bizBalanceBefore,
        balance_after: bizBalanceAfter,
        reference_code: `EARN_ORD_${order.order_id}_${crypto.randomBytes(4).toString("hex")}`,
        description: `Payment received for order ${order.order_id}`,
        order_id: order.order_id,
      });
    }

    // Update order status
    order.payment_status = "PAID";
    order.order_status = "ACCEPTED";
    order.accepted_at = new Date();
    await order.save();

    // Real-time WebSocket notification
    socketService.notifyOrderPayment(order);
    socketService.notifyOrderStatusUpdated(order);

    return res.json({
      message: `Payment of ₦${totalAmount.toLocaleString()} completed successfully. Order accepted!`,
      success: true,
      data: {
        order,
        transaction: customerTxn,
        remaining_balance: customerWallet.current_balance,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Update order status throughout delivery lifecycle (with Rider payout on DELIVERED)
 * @route PATCH /api/v1/orders/:orderId/status
 * @access Private (BUSINESS / RIDER / ADMIN)
 */
async function updateOrderStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const { subject_type, sub } = req.auth;
    const { order_status, rider_id } = req.body;

    const validStatuses = [
      "ACCEPTED",
      "PREPARING",
      "READY_FOR_PICKUP",
      "IN_TRANSIT",
      "DELIVERED",
      "CANCELLED",
    ];

    if (!order_status || !validStatuses.includes(order_status)) {
      return res.status(400).json({
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await Order.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Permission checks
    const isCustomer = subject_type === "USER" && String(order.customer) === String(sub);
    const isBusiness = subject_type === "BUSINESS" && String(order.business) === String(sub);
    const isRider = subject_type === "RIDER" && (String(order.rider) === String(sub) || !order.rider);
    const isAdmin = subject_type === "ADMIN";

    if (!isBusiness && !isRider && !isAdmin) {
      return res.status(403).json({ message: "Unauthorized to update order status" });
    }

    // Assign rider if provided or if rider accepts order
    if (rider_id && mongoose.Types.ObjectId.isValid(rider_id)) {
      order.rider = rider_id;
    } else if (subject_type === "RIDER") {
      order.rider = sub;
    }

    // Status timestamps & logic
    const now = new Date();
    order.order_status = order_status;

    if (order_status === "ACCEPTED" && !order.accepted_at) {
      order.accepted_at = now;
    } else if (order_status === "READY_FOR_PICKUP" && !order.ready_at) {
      order.ready_at = now;
    } else if (order_status === "IN_TRANSIT" && !order.dispatched_at) {
      order.dispatched_at = now;
    } else if (order_status === "DELIVERED") {
      order.delivered_at = now;

      // Credit Rider wallet with delivery fee & driver tip upon delivery completion
      if (order.rider && order.payment_status === "PAID") {
        const riderWallet = await Wallet.findOne({
          owner: order.rider,
          owner_type: "RIDER",
        });

        if (riderWallet) {
          const earnings = order.pricing.delivery_fee + (order.pricing.driver_tip || 0);
          const balanceBefore = riderWallet.current_balance;
          riderWallet.current_balance += earnings;
          const balanceAfter = riderWallet.current_balance;
          riderWallet.last_updated_at = now;
          await riderWallet.save();

          await WalletTransaction.create({
            transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
            wallet: riderWallet._id,
            wallet_id: riderWallet.wallet_id,
            transaction_type: "CREDIT",
            amount: earnings,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_code: `RIDER_PAY_${order.order_id}_${crypto.randomBytes(4).toString("hex")}`,
            description: `Delivery payout and tip for order ${order.order_id}`,
            order_id: order.order_id,
          });
        }
      }

      // Reset assigned rider status to AVAILABLE upon order delivery completion
      if (order.rider) {
        await Rider.findByIdAndUpdate(order.rider, {
          $set: {
            "live_telemetry.current_status": "AVAILABLE",
            "live_telemetry.current_active_order_id": null,
            "live_telemetry.last_ping_time": now,
          },
          $inc: {
            "daily_performance_counters.trips_completed_today": 1,
          },
        });
      }
    } else if (order_status === "CANCELLED") {
      order.cancelled_at = now;

      if (order.rider) {
        await Rider.findByIdAndUpdate(order.rider, {
          $set: {
            "live_telemetry.current_status": "AVAILABLE",
            "live_telemetry.current_active_order_id": null,
            "live_telemetry.last_ping_time": now,
          },
        });
      }
    }

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "profile")
      .populate("business", "name phone_number locations")
      .populate("rider", "personal_info assigned_asset");

    // Real-time WebSocket notification
    socketService.notifyOrderStatusUpdated(populatedOrder);

    return res.json({
      message: `Order status updated to ${order_status}`,
      success: true,
      data: { order: populatedOrder },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrder,
  cancelOrder,
  payOrderWithWallet,
  updateOrderStatus,
};

