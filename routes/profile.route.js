const express = require("express");
const profileController = require("../controllers/profile.controller");
const { authenticateAccessToken } = require("../middlewares/auth.middleware");

const router = express.Router();

router.use(authenticateAccessToken);

router.get("/me", profileController.getEditableProfile);
router.patch("/me", profileController.updateEditableProfile);
router.post("/monnify/kyc", profileController.completeMonnifyKyc);

module.exports = router;
