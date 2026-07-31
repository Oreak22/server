require("dotenv").config();
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const { io: Client } = require("socket.io-client");
const socketService = require("../services/socket.service");
const { createAccessToken } = require("../services/token.service");

const User = require("../models/user.model");
const Business = require("../models/business.model");
const Rider = require("../models/rider.model");
const MenuItem = require("../models/menuItem.model");
const Order = require("../models/order.model");
const Wallet = require("../models/wallet.model");

const authRoutes = require("../routes/auth.route");
const orderRoutes = require("../routes/order.route");
const riderRoutes = require("../routes/rider.route");

async function runRiderWorkflowVerification() {
  console.log("=== Starting Rider/Driver Workflow & GPS Telemetry Verification ===");

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("[Test] Connected to MongoDB");

  // Drop legacy index if present
  await Rider.collection.dropIndex("rider_id_1").catch(() => {});

  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/orders", orderRoutes);
  app.use("/api/v1/riders", riderRoutes);

  const server = http.createServer(app);
  socketService.init(server);

  const TEST_PORT = 9877;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test] Server & WebSockets running on port ${TEST_PORT}`);

  // Create Test User, Business, Rider
  const testUser = await User.create({
    profile: {
      first_name: "Test",
      last_name: "Customer",
      email: `customer_${Date.now()}@example.com`,
      phone_number: `+23480${Math.floor(10000000 + Math.random() * 90000000)}`,
    },
    auth: { password: "Password123!" },
  });

  const testBusiness = await Business.create({
    name: "Speedy Eats Test Restaurant",
    contact_email: `biz_${Date.now()}@example.com`,
    phone_number: `+23481${Math.floor(10000000 + Math.random() * 90000000)}`,
    locations: [{
      street_address: "123 Commercial Ave",
      city: "Lagos",
      state: "Lagos",
      coordinates: { type: "Point", coordinates: [3.3792, 6.5244] },
    }],
    business_type: "RESTAURANT",
  });

  const testRider = await Rider.create({
    rider_id: `rdr_${Date.now()}`,
    personal_info: {
      full_name: "John Rider Express",
      phone_number: `+23490${Math.floor(10000000 + Math.random() * 90000000)}`,
      emergency_contact: "+2348000000000",
    },
    employment_details: {
      employment_status: "FULL_TIME",
      base_daily_salary: 5000,
      date_joined: new Date(),
    },
    assigned_asset: {
      vehicle_id: `veh_${Date.now()}`,
      vehicle_type: "MOTORCYCLE",
      license_plate: `LAG-${Math.floor(1000 + Math.random() * 9000)}`,
      tracker_device_id: `track_${Date.now()}`,
    },
    daily_performance_counters: { date: new Date() },
  });

  // Create Wallets
  const customerWallet = await Wallet.create({
    wallet_id: `wal_usr_${testUser._id}`,
    owner: testUser._id,
    owner_id: String(testUser._id),
    owner_type: "USER",
    virtual_account_number: `99${Math.floor(100000000 + Math.random() * 900000000)}`,
    bank_name: "Wema Bank",
    current_balance: 50000,
  });

  const riderWallet = await Wallet.create({
    wallet_id: `wal_rdr_${testRider._id}`,
    owner: testRider._id,
    owner_id: String(testRider._id),
    owner_type: "RIDER",
    virtual_account_number: `99${Math.floor(100000000 + Math.random() * 900000000)}`,
    bank_name: "Wema Bank",
    current_balance: 0,
  });

  const menuItem = await MenuItem.create({
    business: testBusiness._id,
    name: "Gourmet Burger",
    price: 3500,
    category: "Main",
  });

  // Issue Access Tokens
  const userToken = createAccessToken("USER", testUser).token;
  const riderToken = createAccessToken("RIDER", testRider).token;

  console.log("[Test] Database entities & tokens generated.");

  // Connect WebSockets
  const customerSocket = Client(`http://localhost:${TEST_PORT}`, { auth: { token: userToken } });
  const riderSocket = Client(`http://localhost:${TEST_PORT}`, { auth: { token: riderToken } });

  await new Promise((resolve) => {
    let connected = 0;
    const check = () => { if (++connected === 2) resolve(); };
    customerSocket.on("connect", check);
    riderSocket.on("connect", check);
  });
  console.log("[Test] WebSockets connected for Customer & Rider.");

  // Track received socket events
  const socketEventsReceived = [];

  customerSocket.on("rider_location_updated", (payload) => {
    console.log("[Test] Customer received 'rider_location_updated':", payload.telemetry.location);
    socketEventsReceived.push("rider_location_updated");
  });

  customerSocket.on("order_status_updated", (payload) => {
    console.log("[Test] Customer received 'order_status_updated':", payload.order.order_status);
    socketEventsReceived.push(`status_${payload.order.order_status}`);
  });

  // 1. Rider Duty Status update
  const dutyRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/riders/duty-status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${riderToken}` },
    body: JSON.stringify({ status: "AVAILABLE" }),
  });
  const dutyData = await dutyRes.json();
  console.log("[Test] Update Rider Duty Status:", dutyData.message);

  // 2. Rider REST Location update
  const locRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/riders/location`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${riderToken}` },
    body: JSON.stringify({ latitude: 6.5244, longitude: 3.3792, speed_kmh: 30, heading_degrees: 90 }),
  });
  const locData = await locRes.json();
  console.log("[Test] Update Rider REST Location:", locData.message);

  // 3. Customer Places & Pays Order
  const orderRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      business: testBusiness._id,
      items: [{ menu_item: menuItem._id, quantity: 2 }],
      delivery_address: {
        street_address: "15 Marina St",
        city: "Lagos",
        state: "Lagos",
        coordinates: { type: "Point", coordinates: [3.3792, 6.5244] },
      },
      delivery_fee: 1000,
      driver_tip: 500,
    }),
  });
  const orderData = await orderRes.json();
  const createdOrder = orderData.data.order;
  console.log(`[Test] Customer placed order ${createdOrder.order_id}`);

  // Customer joins order room
  customerSocket.emit("join_order", createdOrder.order_id);
  await new Promise((r) => setTimeout(r, 200));

  // Pay order
  await fetch(`http://localhost:${TEST_PORT}/api/v1/orders/${createdOrder._id}/pay`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}` },
  });
  console.log("[Test] Customer paid order with wallet.");

  // 4. Rider accepts delivery job
  const acceptRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/riders/orders/${createdOrder._id}/accept`, {
    method: "POST",
    headers: { Authorization: `Bearer ${riderToken}` },
  });
  const acceptData = await acceptRes.json();
  console.log("[Test] Rider accepted delivery job:", acceptData.message);

  // 5. Rider emits high-frequency GPS ping via WebSockets
  riderSocket.emit("update_location", {
    latitude: 6.5300,
    longitude: 3.3850,
    speed_kmh: 45,
    heading_degrees: 120,
    active_order_id: createdOrder.order_id,
  });

  await new Promise((r) => setTimeout(r, 300));

  // 6. Update status IN_TRANSIT and then DELIVERED
  await fetch(`http://localhost:${TEST_PORT}/api/v1/orders/${createdOrder._id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${riderToken}` },
    body: JSON.stringify({ order_status: "IN_TRANSIT" }),
  });

  await new Promise((r) => setTimeout(r, 200));

  await fetch(`http://localhost:${TEST_PORT}/api/v1/orders/${createdOrder._id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${riderToken}` },
    body: JSON.stringify({ order_status: "DELIVERED" }),
  });
  console.log("[Test] Order marked as DELIVERED by rider.");

  await new Promise((r) => setTimeout(r, 300));

  // Verify Rider Wallet Credited
  const updatedRiderWallet = await Wallet.findById(riderWallet._id);
  console.log(`[Test] Rider Wallet Balance after delivery payout: ₦${updatedRiderWallet.current_balance}`);

  // Clean up DB entities
  await User.deleteOne({ _id: testUser._id });
  await Business.deleteOne({ _id: testBusiness._id });
  await Rider.deleteOne({ _id: testRider._id });
  await MenuItem.deleteOne({ _id: menuItem._id });
  await Order.deleteOne({ _id: createdOrder._id });
  await Wallet.deleteMany({ _id: { $in: [customerWallet._id, riderWallet._id] } });

  customerSocket.disconnect();
  riderSocket.disconnect();
  server.close();
  await mongoose.disconnect();

  console.log("\nReceived Socket Events Summary:", socketEventsReceived);

  const passed =
    socketEventsReceived.includes("rider_location_updated") &&
    socketEventsReceived.includes("status_IN_TRANSIT") &&
    socketEventsReceived.includes("status_DELIVERED") &&
    updatedRiderWallet.current_balance === 1500; // 1000 delivery fee + 500 driver tip

  if (passed) {
    console.log("\n✅ ALL RIDER WORKFLOW & GPS TELEMETRY TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("\n❌ RIDER WORKFLOW TEST FAILED.");
    process.exit(1);
  }
}

runRiderWorkflowVerification().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
