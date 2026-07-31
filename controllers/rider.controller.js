const mongoose = require("mongoose");
const Rider = require("../models/rider.model");
const Order = require("../models/order.model");
const socketService = require("../services/socket.service");

/**
 * @desc Update rider duty status (AVAILABLE, OFFLINE, ON_BREAK)
 * @route PATCH /api/v1/riders/duty-status
 * @access Private (RIDER)
 */
async function updateDutyStatus(req, res, next) {
  try {
    if (req.auth.subject_type !== "RIDER") {
      return res.status(403).json({ message: "Only registered riders can update duty status" });
    }

    const riderId = req.auth.sub;
    const { status } = req.body;

    const validStatuses = ["AVAILABLE", "OFFLINE", "ON_BREAK"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        message: `Invalid duty status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const rider = await Rider.findById(riderId);
    if (!rider) {
      return res.status(404).json({ message: "Rider profile not found" });
    }

    // Do not allow setting to OFFLINE if currently delivering an order
    if (rider.live_telemetry.current_status === "DELIVERING" && status === "OFFLINE") {
      return res.status(400).json({
        message: "Cannot set status to OFFLINE while actively delivering an order",
      });
    }

    rider.live_telemetry.current_status = status;
    rider.live_telemetry.last_ping_time = new Date();
    await rider.save();

    return res.json({
      message: `Duty status updated to ${status}`,
      success: true,
      data: {
        current_status: rider.live_telemetry.current_status,
        last_ping_time: rider.live_telemetry.last_ping_time,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Update rider live GPS location coordinates
 * @route POST /api/v1/riders/location
 * @access Private (RIDER)
 */
async function updateLocation(req, res, next) {
  try {
    if (req.auth.subject_type !== "RIDER") {
      return res.status(403).json({ message: "Only riders can update location coordinates" });
    }

    const riderId = req.auth.sub;
    const { latitude, longitude, altitude_meters, heading_degrees, speed_kmh } = req.body;

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: "Valid latitude (-90 to 90) and longitude (-180 to 180) are required" });
    }

    const rider = await Rider.findById(riderId);
    if (!rider) {
      return res.status(404).json({ message: "Rider profile not found" });
    }

    const locationData = {
      latitude: lat,
      longitude: lng,
      altitude_meters: altitude_meters !== undefined ? Number(altitude_meters) : undefined,
      heading_degrees: heading_degrees !== undefined ? Number(heading_degrees) : undefined,
      speed_kmh: speed_kmh !== undefined ? Number(speed_kmh) : 0,
    };

    rider.live_telemetry.last_coordinates = locationData;
    rider.live_telemetry.last_ping_time = new Date();
    await rider.save();

    const activeOrderId = rider.live_telemetry.current_active_order_id;

    // Broadcast GPS Telemetry via WebSockets in real time
    socketService.notifyRiderLocationUpdated(riderId, {
      rider_id: riderId,
      rider_name: rider.personal_info?.full_name,
      phone_number: rider.personal_info?.phone_number,
      location: locationData,
      active_order_id: activeOrderId,
      timestamp: rider.live_telemetry.last_ping_time,
    }, activeOrderId);

    return res.json({
      message: "GPS location updated successfully",
      success: true,
      data: {
        location: locationData,
        last_ping_time: rider.live_telemetry.last_ping_time,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get available delivery orders needing rider assignment
 * @route GET /api/v1/riders/available-deliveries
 * @access Private (RIDER / ADMIN)
 */
async function getAvailableDeliveries(req, res, next) {
  try {
    const riderId = req.auth.sub;

    const orders = await Order.find({
      order_status: { $in: ["ACCEPTED", "READY_FOR_PICKUP", "PREPARING"] },
      $or: [{ rider: null }, { rider: { $exists: false } }, { rider: riderId }],
    })
      .populate("business", "name phone_number locations")
      .populate("customer", "profile")
      .sort({ createdAt: -1 });

    return res.json({
      message: "Available delivery jobs fetched successfully",
      success: true,
      data: { orders, count: orders.length },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Accept a delivery order job
 * @route POST /api/v1/riders/orders/:orderId/accept
 * @access Private (RIDER)
 */
async function acceptDelivery(req, res, next) {
  try {
    if (req.auth.subject_type !== "RIDER") {
      return res.status(403).json({ message: "Only riders can accept delivery jobs" });
    }

    const riderId = req.auth.sub;
    const { orderId } = req.params;

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await Order.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.rider && String(order.rider) !== String(riderId)) {
      return res.status(400).json({ message: "Order has already been assigned to another rider" });
    }

    if (["DELIVERED", "CANCELLED"].includes(order.order_status)) {
      return res.status(400).json({ message: `Cannot accept order in status "${order.order_status}"` });
    }

    const rider = await Rider.findById(riderId);
    if (!rider) {
      return res.status(404).json({ message: "Rider profile not found" });
    }

    // Assign rider to order
    order.rider = riderId;
    await order.save();

    // Update rider active status and telemetry
    rider.live_telemetry.current_status = "DELIVERING";
    rider.live_telemetry.current_active_order_id = order.order_id;
    rider.live_telemetry.last_ping_time = new Date();
    await rider.save();

    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "profile")
      .populate("business", "name phone_number locations")
      .populate("rider", "personal_info assigned_asset live_telemetry");

    // Real-time WebSocket notifications
    socketService.notifyOrderStatusUpdated(populatedOrder);

    return res.json({
      message: `Delivery job accepted for order ${order.order_id}`,
      success: true,
      data: { order: populatedOrder },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Decline a delivery order job offer
 * @route POST /api/v1/riders/orders/:orderId/decline
 * @access Private (RIDER)
 */
async function declineDelivery(req, res, next) {
  try {
    if (req.auth.subject_type !== "RIDER") {
      return res.status(403).json({ message: "Only riders can decline delivery jobs" });
    }

    const { orderId } = req.params;

    return res.json({
      message: `Delivery job ${orderId} declined`,
      success: true,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get currently assigned active delivery for logged-in rider
 * @route GET /api/v1/riders/active-order
 * @access Private (RIDER)
 */
async function getRiderActiveOrder(req, res, next) {
  try {
    if (req.auth.subject_type !== "RIDER") {
      return res.status(403).json({ message: "Only riders can view active orders" });
    }

    const riderId = req.auth.sub;

    const order = await Order.findOne({
      rider: riderId,
      order_status: { $in: ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "IN_TRANSIT"] },
    })
      .populate("customer", "profile")
      .populate("business", "name phone_number locations contact_email")
      .populate("items.menu_item");

    return res.json({
      message: order ? "Active order retrieved successfully" : "No active order assigned",
      success: true,
      data: { order },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Admin / Business assign a specific rider to an order
 * @route POST /api/v1/orders/:orderId/assign-rider
 * @access Private (ADMIN / BUSINESS)
 */
async function assignRiderToOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const { rider_id } = req.body;

    if (!rider_id || !mongoose.Types.ObjectId.isValid(rider_id)) {
      return res.status(400).json({ message: "A valid rider ID is required" });
    }

    const rider = await Rider.findById(rider_id);
    if (!rider) {
      return res.status(404).json({ message: "Rider not found" });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(orderId);
    const lookup = isObjectId ? { _id: orderId } : { order_id: orderId };

    const order = await Order.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order.rider = rider._id;
    await order.save();

    rider.live_telemetry.current_status = "DELIVERING";
    rider.live_telemetry.current_active_order_id = order.order_id;
    await rider.save();

    const populatedOrder = await Order.findById(order._id)
      .populate("customer", "profile")
      .populate("business", "name phone_number locations")
      .populate("rider", "personal_info assigned_asset live_telemetry");

    socketService.notifyOrderStatusUpdated(populatedOrder);

    return res.json({
      message: `Rider ${rider.personal_info?.full_name || rider._id} assigned to order ${order.order_id}`,
      success: true,
      data: { order: populatedOrder },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  updateDutyStatus,
  updateLocation,
  getAvailableDeliveries,
  acceptDelivery,
  declineDelivery,
  getRiderActiveOrder,
  assignRiderToOrder,
};
