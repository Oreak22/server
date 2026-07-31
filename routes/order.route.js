const express = require("express");
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  getOrderById,
  updateOrder,
  cancelOrder,
  payOrderWithWallet,
  updateOrderStatus,
} = require("../controllers/order.controller");
const { assignRiderToOrder } = require("../controllers/rider.controller");
const { authenticateAccessToken } = require("../middlewares/auth.middleware");

// Protected order routes
router.post("/", authenticateAccessToken, createOrder);
router.get("/", authenticateAccessToken, getMyOrders);
router.get("/:orderId", authenticateAccessToken, getOrderById);
router.put("/:orderId", authenticateAccessToken, updateOrder);
router.patch("/:orderId/status", authenticateAccessToken, updateOrderStatus);
router.post("/:orderId/cancel", authenticateAccessToken, cancelOrder);
router.post("/:orderId/pay", authenticateAccessToken, payOrderWithWallet);
router.post("/:orderId/assign-rider", authenticateAccessToken, assignRiderToOrder);

module.exports = router;

