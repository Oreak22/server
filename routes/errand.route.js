const express = require("express");
const router = express.Router();
const errandController = require("../controllers/errand.controller");
const { authenticateAccessToken } = require("../middlewares/auth.middleware");

// Time & Complexity Calculator endpoint
router.post("/estimate", errandController.calculateErrandEstimate);

// Protected endpoints
router.use(authenticateAccessToken);

router.post("/orders", errandController.createErrandOrder);
router.get("/orders", errandController.getErrandOrders);
router.post("/orders/:orderId/pay", errandController.payErrandOrder);
router.patch("/orders/:orderId/status", errandController.updateErrandOrderStatus);
router.post("/orders/:orderId/cancel", errandController.cancelErrandOrder);

module.exports = router;
