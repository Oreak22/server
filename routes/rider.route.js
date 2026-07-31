const express = require("express");
const router = express.Router();
const riderController = require("../controllers/rider.controller");
const { authenticateAccessToken } = require("../middlewares/auth.middleware");

// All rider routes require JWT authentication
router.use(authenticateAccessToken);

router.patch("/duty-status", riderController.updateDutyStatus);
router.post("/location", riderController.updateLocation);
router.get("/available-deliveries", riderController.getAvailableDeliveries);
router.get("/active-order", riderController.getRiderActiveOrder);
router.post("/orders/:orderId/accept", riderController.acceptDelivery);
router.post("/orders/:orderId/decline", riderController.declineDelivery);

module.exports = router;
