const express = require("express");
const walletController = require("../controllers/wallet.controller");
const {
  authenticateAccessToken,
  requireAdminRole,
} = require("../middlewares/auth.middleware");

const router = express.Router();

router.post(
  "/delivery-fees/deduct",
  authenticateAccessToken,
  requireAdminRole("DISPATCHER", "COORDINATOR", "SUPER_ADMIN"),
  walletController.deductDeliveryFee,
);

module.exports = router;
