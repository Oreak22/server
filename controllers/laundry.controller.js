const mongoose = require("mongoose");
const crypto = require("crypto");
const Business = require("../models/business.model");
const Rider = require("../models/rider.model");
const LaundryItem = require("../models/laundryItem.model");
const LaundryOrder = require("../models/laundryOrder.model");
const Wallet = require("../models/wallet.model");
const WalletTransaction = require("../models/walletTransaction.model");
const socketService = require("../services/socket.service");

/**
 * @desc List active laundry service vendors
 * @route GET /api/v1/laundry/vendors
 * @access Public
 */
async function getLaundryVendors(req, res, next) {
  try {
    const vendors = await Business.find({
      status: "ACTIVE",
      "services_rendered.category": "LAUNDRY",
    }).select("name phone_number contact_email services_rendered locations open_status business_hours");

    return res.json({
      message: "Laundry vendors retrieved successfully",
      success: true,
      data: { vendors },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Create a new laundry catalog item (per-item or per-kg bag weight rate)
 * @route POST /api/v1/laundry/catalog
 * @access Private (BUSINESS)
 */
async function createLaundryItem(req, res, next) {
  try {
    const businessId = req.auth.sub;
    const { name, category, supported_services, pricing_type, unit_price, description, image_url } = req.body;

    if (!name || !supported_services || unit_price === undefined) {
      return res.status(400).json({ message: "name, supported_services, and unit_price are required" });
    }

    const item = await LaundryItem.create({
      business: businessId,
      name,
      category,
      supported_services,
      pricing_type,
      unit_price: Number(unit_price),
      description,
      image_url,
    });

    return res.status(201).json({
      message: "Laundry catalog item created successfully",
      success: true,
      data: { item },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get catalog items for a laundry vendor
 * @route GET /api/v1/laundry/vendors/:businessId/catalog
 * @access Public
 */
async function getLaundryCatalog(req, res, next) {
  try {
    const { businessId } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(businessId);
    const lookup = isObjectId ? { _id: businessId } : { business_id: businessId };

    const business = await Business.findOne(lookup);
    if (!business) {
      return res.status(404).json({ message: "Laundry vendor not found" });
    }

    const items = await LaundryItem.find({
      business: business._id,
      is_available: true,
    }).sort({ category: 1, name: 1 });

    return res.json({
      message: "Laundry catalog retrieved successfully",
      success: true,
      data: { vendor: { id: business._id, name: business.name }, items },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Update a laundry catalog item
 * @route PUT /api/v1/laundry/catalog/:itemId
 * @access Private (BUSINESS)
 */
async function updateLaundryItem(req, res, next) {
  try {
    const { itemId } = req.params;
    const businessId = req.auth.sub;

    const isObjectId = mongoose.Types.ObjectId.isValid(itemId);
    const lookup = isObjectId ? { _id: itemId } : { item_id: itemId };

    const item = await LaundryItem.findOne({ ...lookup, business: businessId });
    if (!item) {
      return res.status(404).json({ message: "Laundry catalog item not found or unauthorized" });
    }

    const fields = ["name", "category", "supported_services", "pricing_type", "unit_price", "description", "image_url", "is_available"];
    fields.forEach((field) => {
      if (req.body[field] !== undefined) {
        item[field] = req.body[field];
      }
    });

    await item.save();

    return res.json({
      message: "Laundry item updated successfully",
      success: true,
      data: { item },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Delete a laundry catalog item
 * @route DELETE /api/v1/laundry/catalog/:itemId
 * @access Private (BUSINESS)
 */
async function deleteLaundryItem(req, res, next) {
  try {
    const { itemId } = req.params;
    const businessId = req.auth.sub;

    const isObjectId = mongoose.Types.ObjectId.isValid(itemId);
    const lookup = isObjectId ? { _id: itemId } : { item_id: itemId };

    const result = await LaundryItem.deleteOne({ ...lookup, business: businessId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Laundry item not found or unauthorized" });
    }

    return res.json({
      message: "Laundry item deleted successfully",
      success: true,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Book a new Laundry Service order with Scheduling Calendar & Bag Size/Itemized Options
 * @route POST /api/v1/laundry/orders
 * @access Private (USER)
 */
async function bookLaundryService(req, res, next) {
  try {
    const customerId = req.auth.sub;
    const {
      business,
      service_type,
      pricing_mode,
      items,
      bag_weight,
      care_preferences = {},
      pickup_slot,
      return_slot,
      pickup_address,
      return_address,
      pickup_delivery_fee = 1000,
      driver_tip = 0,
      notes,
    } = req.body;

    if (!business || !service_type || !pricing_mode || !pickup_slot || !return_slot || !pickup_address || !return_address) {
      return res.status(400).json({
        message: "business, service_type, pricing_mode, pickup_slot, return_slot, pickup_address, and return_address are required",
      });
    }

    // Validate Scheduling Calendar
    const pickupDate = new Date(pickup_slot.date);
    const returnDate = new Date(return_slot.date);

    if (isNaN(pickupDate.getTime()) || isNaN(returnDate.getTime())) {
      return res.status(400).json({ message: "pickup_slot.date and return_slot.date must be valid dates" });
    }

    if (returnDate < pickupDate) {
      return res.status(400).json({ message: "return_slot date must be equal to or after pickup_slot date" });
    }

    const vendor = await Business.findById(business);
    if (!vendor) {
      return res.status(404).json({ message: "Selected laundry vendor not found" });
    }

    let itemsSubtotal = 0;
    let validatedItems = [];
    let validatedBagWeight = null;

    if (pricing_mode === "ITEMIZED_INVENTORY") {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items list must contain at least one item for ITEMIZED_INVENTORY mode" });
      }

      for (const rawItem of items) {
        let catalogItem = null;
        if (rawItem.laundry_item) {
          catalogItem = await LaundryItem.findById(rawItem.laundry_item);
        }

        const unitPrice = catalogItem ? catalogItem.unit_price : Number(rawItem.unit_price || 0);
        const qty = Number(rawItem.quantity || 1);
        const itemSubtotal = unitPrice * qty;

        itemsSubtotal += itemSubtotal;
        validatedItems.push({
          laundry_item: catalogItem ? catalogItem._id : undefined,
          name: catalogItem ? catalogItem.name : rawItem.name,
          unit_price: unitPrice,
          quantity: qty,
          subtotal: itemSubtotal,
          special_instructions: rawItem.special_instructions,
        });
      }
    } else if (pricing_mode === "BAG_WEIGHT") {
      if (!bag_weight) {
        return res.status(400).json({ message: "bag_weight details required for BAG_WEIGHT pricing mode" });
      }

      const weightKg = Number(bag_weight.weight_kg || 10);
      const pricePerKg = Number(bag_weight.price_per_kg || 500);
      itemsSubtotal = weightKg * pricePerKg;

      validatedBagWeight = {
        weight_kg: weightKg,
        price_per_kg: pricePerKg,
        bag_tier: bag_weight.bag_tier || "MEDIUM_BAG_10KG",
        subtotal: itemsSubtotal,
      };
    } else {
      return res.status(400).json({ message: "Invalid pricing_mode. Must be ITEMIZED_INVENTORY or BAG_WEIGHT" });
    }

    // Express Fee calculation (20% surcharge if express turnover requested)
    const expressFee = care_preferences.is_express_turnover ? Math.round(itemsSubtotal * 0.2) : 0;
    const serviceFee = 300;
    const totalAmount = itemsSubtotal + expressFee + Number(pickup_delivery_fee) + serviceFee + Number(driver_tip);

    const order = await LaundryOrder.create({
      customer: customerId,
      business: vendor._id,
      service_type,
      pricing_mode,
      items: validatedItems,
      bag_weight: validatedBagWeight,
      care_preferences,
      pickup_slot: { date: pickupDate, time_slot: pickup_slot.time_slot },
      return_slot: { date: returnDate, time_slot: return_slot.time_slot },
      pickup_address,
      return_address,
      pricing: {
        items_subtotal: itemsSubtotal,
        express_fee: expressFee,
        pickup_delivery_fee: Number(pickup_delivery_fee),
        service_fee: serviceFee,
        driver_tip: Number(driver_tip),
        total_amount: totalAmount,
      },
      notes,
    });

    const populatedOrder = await LaundryOrder.findById(order._id)
      .populate("customer", "profile")
      .populate("business", "name phone_number locations");

    // Socket notification
    socketService.getIO()?.to(`business:${vendor._id}`)?.emit("laundry_order_placed", {
      order_id: order.order_id,
      service_type,
      total_amount: totalAmount,
    });

    return res.status(201).json({
      message: `Laundry service booked successfully with Order ID ${order.order_id}`,
      success: true,
      data: { order: populatedOrder },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Pay for a laundry booking using customer's delivery wallet
 * @route POST /api/v1/laundry/orders/:orderId/pay
 * @access Private (USER)
 */
async function payLaundryOrder(req, res, next) {
  try {
    const customerId = req.auth.sub;
    const { orderId } = req.params;

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await LaundryOrder.findOne({ ...lookup, customer: customerId });
    if (!order) {
      return res.status(404).json({ message: "Laundry order booking not found" });
    }

    if (order.payment_status === "PAID") {
      return res.status(400).json({ message: "Order is already paid" });
    }

    const wallet = await Wallet.findOne({ owner: customerId, owner_type: "USER" });
    if (!wallet) {
      return res.status(404).json({ message: "Customer delivery wallet not found" });
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
      reference_code: `LAUNDRY_PAY_${order.order_id}_${Date.now()}`,
      description: `Payment for laundry booking ${order.order_id}`,
      order_id: order.order_id,
    });

    order.payment_status = "PAID";
    order.order_status = "CONFIRMED";
    await order.save();

    // Broadcast status change
    socketService.notifyOrderStatusUpdated(order.order_id, "CONFIRMED", {
      payment_status: "PAID",
    });

    return res.json({
      message: "Laundry order paid successfully with wallet balance",
      success: true,
      data: { order },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Update laundry order status & handle rider payouts on completion
 * @route PATCH /api/v1/laundry/orders/:orderId/status
 * @access Private (BUSINESS / RIDER / ADMIN)
 */
async function updateLaundryOrderStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const { order_status, rider_id } = req.body;

    const validStatuses = [
      "CONFIRMED",
      "PICKUP_SCHEDULED",
      "PICKED_UP",
      "RECEIVED_AT_FACILITY",
      "WASHING_IN_PROGRESS",
      "IRONING_AND_FOLDING",
      "READY_FOR_DELIVERY",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "CANCELLED",
    ];

    if (!order_status || !validStatuses.includes(order_status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await LaundryOrder.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Laundry order not found" });
    }

    if (rider_id) {
      const rider = await Rider.findById(rider_id);
      if (rider) {
        order.rider = rider._id;
        rider.live_telemetry.current_status = "DELIVERING";
        rider.live_telemetry.current_active_order_id = order.order_id;
        await rider.save();
      }
    }

    const now = new Date();
    order.order_status = order_status;

    if (order_status === "PICKED_UP") order.picked_up_at = now;
    if (order_status === "WASHING_IN_PROGRESS") order.washing_started_at = now;
    if (order_status === "READY_FOR_DELIVERY") order.ready_for_delivery_at = now;

    if (order_status === "DELIVERED") {
      order.delivered_at = now;

      if (order.rider) {
        const rider = await Rider.findById(order.rider);
        if (rider) {
          const payoutAmount = (order.pricing.pickup_delivery_fee || 0) + (order.pricing.driver_tip || 0);

          if (payoutAmount > 0) {
            const riderWallet = await Wallet.findOne({ owner: rider._id, owner_type: "RIDER" });
            if (riderWallet) {
              const balanceBefore = riderWallet.current_balance;
              riderWallet.current_balance += payoutAmount;
              const balanceAfter = riderWallet.current_balance;
              riderWallet.last_updated_at = now;
              await riderWallet.save();

              await WalletTransaction.create({
                transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
                wallet: riderWallet._id,
                wallet_id: riderWallet.wallet_id,
                transaction_type: "CREDIT",
                amount: payoutAmount,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
                reference_code: `LAUNDRY_RIDER_PAY_${order.order_id}`,
                description: `Payout for laundry order ${order.order_id}`,
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
      message: `Laundry order status updated to ${order_status}`,
      success: true,
      data: { order },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Cancel laundry order & issue refund if paid
 * @route POST /api/v1/laundry/orders/:orderId/cancel
 * @access Private (USER / BUSINESS / ADMIN)
 */
async function cancelLaundryOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await LaundryOrder.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Laundry order not found" });
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
          reference_code: `LAUNDRY_REFUND_${order.order_id}`,
          description: `Refund for cancelled laundry order ${order.order_id}`,
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
      message: "Laundry order cancelled successfully",
      success: true,
      data: { order },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get list of laundry orders based on user role
 * @route GET /api/v1/laundry/orders
 * @access Private
 */
async function getLaundryOrders(req, res, next) {
  try {
    const actorType = req.auth.subject_type;
    const actorId = req.auth.sub;

    let filter = {};
    if (actorType === "USER") filter.customer = actorId;
    else if (actorType === "BUSINESS") filter.business = actorId;
    else if (actorType === "RIDER") filter.rider = actorId;

    const orders = await LaundryOrder.find(filter)
      .populate("customer", "profile")
      .populate("business", "name phone_number locations")
      .populate("rider", "personal_info assigned_asset")
      .sort({ createdAt: -1 });

    return res.json({
      message: "Laundry orders retrieved successfully",
      success: true,
      data: { orders },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getLaundryVendors,
  createLaundryItem,
  getLaundryCatalog,
  updateLaundryItem,
  deleteLaundryItem,
  bookLaundryService,
  payLaundryOrder,
  updateLaundryOrderStatus,
  cancelLaundryOrder,
  getLaundryOrders,
};
