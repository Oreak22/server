const express = require("express");
const router = express.Router();
const adminController = require("../controllers/admin.controller");
const { authenticateAccessToken } = require("../middlewares/auth.middleware");

// All admin routes require JWT authentication
router.use(authenticateAccessToken);

router.get("/metrics", adminController.getSystemMetrics);
router.post("/disputes", adminController.createDispute);
router.get("/disputes", adminController.getDisputes);
router.get("/disputes/:disputeId", adminController.getDisputeById);
router.patch("/disputes/:disputeId/resolve", adminController.resolveDispute);
router.get("/users", adminController.getPlatformUsers);
router.patch("/users/:userId/status", adminController.updateAccountStatus);

module.exports = router;
