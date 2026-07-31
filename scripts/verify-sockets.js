require("dotenv").config();
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const { io: Client } = require("socket.io-client");
const socketService = require("../services/socket.service");
const { createAccessToken } = require("../services/token.service");

async function runSocketVerification() {
  console.log("=== Starting Socket.io WebSocket Verification ===");

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI environment variable missing");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("[Test] Connected to MongoDB");

  const app = express();
  const server = http.createServer(app);
  socketService.init(server);

  const TEST_PORT = 9876;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test] Socket server listening on port ${TEST_PORT}`);

  const userObj = { _id: new mongoose.Types.ObjectId(), id: "usr_test123" };
  const businessObj = { _id: new mongoose.Types.ObjectId(), id: "biz_test456" };

  const userToken = createAccessToken("USER", userObj).token;
  const businessToken = createAccessToken("BUSINESS", businessObj).token;

  console.log("[Test] Generated JWT access tokens for USER and BUSINESS");

  // Connect socket clients
  const userSocket = Client(`http://localhost:${TEST_PORT}`, {
    auth: { token: userToken },
  });

  const businessSocket = Client(`http://localhost:${TEST_PORT}`, {
    auth: { token: businessToken },
  });

  await new Promise((resolve, reject) => {
    let connectedCount = 0;
    const checkConnected = () => {
      connectedCount++;
      if (connectedCount === 2) resolve();
    };

    userSocket.on("connect", () => {
      console.log(`[Test] User socket connected (${userSocket.id})`);
      checkConnected();
    });

    businessSocket.on("connect", () => {
      console.log(`[Test] Business socket connected (${businessSocket.id})`);
      checkConnected();
    });

    userSocket.on("connect_error", reject);
    businessSocket.on("connect_error", reject);
  });

  // Track received events
  const receivedEvents = [];

  businessSocket.on("order_created", (data) => {
    console.log("[Test] Business socket received 'order_created':", data.event);
    receivedEvents.push("order_created_business");
  });

  userSocket.on("order_created", (data) => {
    console.log("[Test] User socket received 'order_created':", data.event);
    receivedEvents.push("order_created_user");
  });

  userSocket.on("order_paid", (data) => {
    console.log("[Test] User socket received 'order_paid':", data.event);
    receivedEvents.push("order_paid_user");
  });

  userSocket.on("order_status_updated", (data) => {
    console.log("[Test] User socket received 'order_status_updated':", data.event, "->", data.order.order_status);
    receivedEvents.push(`order_status_${data.order.order_status}`);
  });

  userSocket.on("order_cancelled", (data) => {
    console.log("[Test] User socket received 'order_cancelled':", data.event);
    receivedEvents.push("order_cancelled_user");
  });

  // Test Order Object
  const dummyOrder = {
    _id: new mongoose.Types.ObjectId(),
    order_id: "ord_test_9999",
    customer: userObj._id,
    business: businessObj._id,
    order_status: "PENDING",
    payment_status: "PENDING",
  };

  // Test Join Order Room
  userSocket.emit("join_order", dummyOrder.order_id);
  await new Promise((r) => setTimeout(r, 200));

  // Trigger Notifications
  console.log("[Test] Triggering notifyOrderCreated...");
  socketService.notifyOrderCreated(dummyOrder);

  await new Promise((r) => setTimeout(r, 200));

  console.log("[Test] Triggering notifyOrderPayment...");
  dummyOrder.payment_status = "PAID";
  dummyOrder.order_status = "ACCEPTED";
  socketService.notifyOrderPayment(dummyOrder);
  socketService.notifyOrderStatusUpdated(dummyOrder);

  await new Promise((r) => setTimeout(r, 200));

  console.log("[Test] Triggering status update PREPARING...");
  dummyOrder.order_status = "PREPARING";
  socketService.notifyOrderStatusUpdated(dummyOrder);

  await new Promise((r) => setTimeout(r, 200));

  console.log("[Test] Triggering notifyOrderCancelled...");
  dummyOrder.order_status = "CANCELLED";
  socketService.notifyOrderCancelled(dummyOrder, { refund_processed: true, refunded_amount: 1500 });

  await new Promise((r) => setTimeout(r, 300));

  // Clean up
  userSocket.disconnect();
  businessSocket.disconnect();
  server.close();
  await mongoose.disconnect();

  console.log("\nReceived Events Summary:", receivedEvents);

  const requiredEvents = [
    "order_created_business",
    "order_created_user",
    "order_paid_user",
    "order_status_ACCEPTED",
    "order_status_PREPARING",
    "order_cancelled_user",
  ];

  const allPassed = requiredEvents.every((ev) => receivedEvents.includes(ev));

  if (allPassed) {
    console.log("\n✅ ALL SOCKET VERIFICATION TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("\n❌ SOCKET VERIFICATION FAILED: Missing required events.");
    process.exit(1);
  }
}

runSocketVerification().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
