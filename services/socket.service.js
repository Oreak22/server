const { Server } = require("socket.io");
const { verifyAccessToken } = require("./token.service");

let io = null;

/**
 * Initialize Socket.io server instance
 * @param {import("http").Server} httpServer
 */
function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Authentication Middleware for WebSocket Connections
  io.use((socket, next) => {
    try {
      let token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization;

      if (!token) {
        return next(new Error("Authentication token required"));
      }

      if (token.startsWith("Bearer ")) {
        token = token.slice(7).trim();
      }

      const decoded = verifyAccessToken(token);
      socket.user = decoded; // { sub, subject_type, public_id, role, exp }
      next();
    } catch (err) {
      next(new Error(`Authentication failed: ${err.message}`));
    }
  });

  io.on("connection", (socket) => {
    const { sub, subject_type, public_id } = socket.user || {};
    console.log(
      `[Socket Connected] ID: ${socket.id} | ${subject_type} ID: ${sub}`,
    );

    // Join Role/User Specific Rooms
    if (sub && subject_type) {
      const roomName = `${subject_type.toLowerCase()}:${sub}`;
      socket.join(roomName);

      if (public_id && public_id !== sub) {
        socket.join(`${subject_type.toLowerCase()}:${public_id}`);
      }

      if (subject_type === "ADMIN") {
        socket.join("admin:all");
      }
    }

    // Join Specific Order Tracking Room
    socket.on("join_order", (orderId) => {
      if (orderId) {
        const orderRoom = `order:${orderId}`;
        socket.join(orderRoom);
        console.log(`[Socket] Client ${socket.id} joined ${orderRoom}`);
        socket.emit("order_room_joined", { order_id: orderId, success: true });
      }
    });

    // Leave Specific Order Tracking Room
    socket.on("leave_order", (orderId) => {
      if (orderId) {
        const orderRoom = `order:${orderId}`;
        socket.leave(orderRoom);
        console.log(`[Socket] Client ${socket.id} left ${orderRoom}`);
        socket.emit("order_room_left", { order_id: orderId, success: true });
      }
    });

    // High-frequency Rider GPS Telemetry via WebSockets
    socket.on("update_location", (locationData) => {
      if (socket.user?.subject_type === "RIDER" && locationData) {
        const riderId = socket.user.sub;
        const activeOrderId = locationData.active_order_id;
        
        notifyRiderLocationUpdated(
          riderId,
          {
            rider_id: riderId,
            location: {
              latitude: Number(locationData.latitude),
              longitude: Number(locationData.longitude),
              speed_kmh: Number(locationData.speed_kmh || 0),
              heading_degrees: Number(locationData.heading_degrees || 0),
            },
            active_order_id: activeOrderId,
            timestamp: new Date(),
          },
          activeOrderId
        );
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(`[Socket Disconnected] ID: ${socket.id} | Reason: ${reason}`);
    });
  });

  return io;
}

/**
 * Get active Socket.io instance
 */
function getIO() {
  if (!io) {
    throw new Error("Socket.io has not been initialized!");
  }
  return io;
}

/**
 * Emit event to specific room
 */
function emitToRoom(room, event, data) {
  if (io) {
    io.to(room).emit(event, data);
  }
}

/**
 * Broadcast event when a new order is created
 */
function notifyOrderCreated(order) {
  if (!io || !order) return;

  const payload = {
    event: "order_created",
    timestamp: new Date(),
    order,
  };

  const businessId = String(order.business?._id || order.business);
  const customerId = String(order.customer?._id || order.customer);

  // Notify restaurant business
  emitToRoom(`business:${businessId}`, "order_created", payload);
  // Notify admin dashboard
  emitToRoom("admin:all", "order_created", payload);
  // Also emit to user who created it
  emitToRoom(`user:${customerId}`, "order_created", payload);
}

/**
 * Broadcast event when an order status is updated throughout lifecycle
 */
function notifyOrderStatusUpdated(order) {
  if (!io || !order) return;

  const payload = {
    event: "order_status_updated",
    timestamp: new Date(),
    order,
  };

  const customerId = String(order.customer?._id || order.customer);
  const businessId = String(order.business?._id || order.business);

  // Notify customer
  if (customerId) {
    emitToRoom(`user:${customerId}`, "order_status_updated", payload);
  }

  // Notify business
  if (businessId) {
    emitToRoom(`business:${businessId}`, "order_status_updated", payload);
  }

  // Notify rider if assigned
  if (order.rider) {
    const riderId = String(order.rider?._id || order.rider);
    emitToRoom(`rider:${riderId}`, "order_status_updated", payload);
  }

  // Notify specific order rooms
  if (order._id) emitToRoom(`order:${order._id}`, "order_status_updated", payload);
  if (order.order_id) emitToRoom(`order:${order.order_id}`, "order_status_updated", payload);

  // Notify admin
  emitToRoom("admin:all", "order_status_updated", payload);
}

/**
 * Broadcast event when an order payment is processed
 */
function notifyOrderPayment(order) {
  if (!io || !order) return;

  const payload = {
    event: "order_paid",
    timestamp: new Date(),
    order,
  };

  const customerId = String(order.customer?._id || order.customer);
  const businessId = String(order.business?._id || order.business);

  if (customerId) emitToRoom(`user:${customerId}`, "order_paid", payload);
  if (businessId) emitToRoom(`business:${businessId}`, "order_paid", payload);

  if (order._id) emitToRoom(`order:${order._id}`, "order_paid", payload);
  if (order.order_id) emitToRoom(`order:${order.order_id}`, "order_paid", payload);

  emitToRoom("admin:all", "order_paid", payload);
}

/**
 * Broadcast event when an order is cancelled
 */
function notifyOrderCancelled(order, refundDetails = {}) {
  if (!io || !order) return;

  const payload = {
    event: "order_cancelled",
    timestamp: new Date(),
    order,
    refund_details: refundDetails,
  };

  const customerId = String(order.customer?._id || order.customer);
  const businessId = String(order.business?._id || order.business);

  if (customerId) emitToRoom(`user:${customerId}`, "order_cancelled", payload);
  if (businessId) emitToRoom(`business:${businessId}`, "order_cancelled", payload);

  if (order.rider) {
    const riderId = String(order.rider?._id || order.rider);
    emitToRoom(`rider:${riderId}`, "order_cancelled", payload);
  }

  if (order._id) emitToRoom(`order:${order._id}`, "order_cancelled", payload);
  if (order.order_id) emitToRoom(`order:${order.order_id}`, "order_cancelled", payload);

  emitToRoom("admin:all", "order_cancelled", payload);
}

/**
 * Broadcast live rider GPS location telemetry updates
 */
function notifyRiderLocationUpdated(riderId, telemetryData, activeOrderId) {
  if (!io || !riderId) return;

  const payload = {
    event: "rider_location_updated",
    timestamp: new Date(),
    telemetry: telemetryData,
  };

  // Emit to rider room
  emitToRoom(`rider:${riderId}`, "rider_location_updated", payload);

  // If rider is delivering an order, emit to active order room
  if (activeOrderId) {
    emitToRoom(`order:${activeOrderId}`, "rider_location_updated", payload);
  }

  // Emit to admin dashboard
  emitToRoom("admin:all", "rider_location_updated", payload);
}

/**
 * Broadcast dispatch offer notification for available riders
 */
function notifyDispatchOffer(order) {
  if (!io || !order) return;

  const payload = {
    event: "delivery_dispatch_offer",
    timestamp: new Date(),
    order,
  };

  emitToRoom("admin:all", "delivery_dispatch_offer", payload);
}

module.exports = {
  init,
  getIO,
  emitToRoom,
  notifyOrderCreated,
  notifyOrderStatusUpdated,
  notifyOrderPayment,
  notifyOrderCancelled,
  notifyRiderLocationUpdated,
  notifyDispatchOffer,
};
