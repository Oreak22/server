const express = require("express");
const authController = require("../controllers/auth.controller");

const router = express.Router();

router.post("/clients/register", authController.registerClient);
router.post("/clients/login", authController.loginClient);
router.post("/clients/google/register", authController.registerClientWithGoogle);
router.post("/clients/google/login", authController.loginClientWithGoogle);

router.post("/businesses/register", authController.registerBusiness);
router.post("/businesses/login", authController.loginBusiness);

router.post("/admins/register", authController.registerAdmin);
router.post("/admins/login", authController.loginAdmin);

router.post("/riders/register", authController.registerRider);
router.post("/riders/login", authController.loginRider);

router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);

router.post("/email/verify", authController.verifyEmail);
router.post("/email/resend-code", authController.resendEmailVerification);

router.post("/password/forgot", authController.requestPasswordReset);
router.post("/password/reset", authController.resetPassword);

module.exports = router;
