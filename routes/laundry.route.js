const express = require("express");
const router = express.Router();
const laundryController = require("../controllers/laundry.controller");
const { authenticateAccessToken } = require("../middlewares/auth.middleware");

// Public endpoints
router.get("/vendors", laundryController.getLaundryVendors);
router.get("/vendors/:businessId/catalog", laundryController.getLaundryCatalog);

// Protected endpoints
router.use(authenticateAccessToken);

router.post("/catalog", laundryController.createLaundryItem);
router.put("/catalog/:itemId", laundryController.updateLaundryItem);
router.delete("/catalog/:itemId", laundryController.deleteLaundryItem);

router.post("/orders", laundryController.bookLaundryService);
router.get("/orders", laundryController.getLaundryOrders);
router.post("/orders/:orderId/pay", laundryController.payLaundryOrder);
router.patch("/orders/:orderId/status", laundryController.updateLaundryOrderStatus);
router.post("/orders/:orderId/cancel", laundryController.cancelLaundryOrder);

module.exports = router;
