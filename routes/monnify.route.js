const express = require("express");
const monnifyController = require("../controllers/monnify.controller");

const router = express.Router();

router.post("/webhook", monnifyController.handleWebhook);

module.exports = router;
