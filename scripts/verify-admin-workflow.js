require("dotenv").config();
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const socketService = require("../services/socket.service");
const { createAccessToken } = require("../services/token.service");

const Admin = require("../models/admin.model");
const User = require("../models/user.model");
const Business = require("../models/business.model");
const Rider = require("../models/rider.model");
const MenuItem = require("../models/menuItem.model");
const Order = require("../models/order.model");
const Dispute = require("../models/dispute.model");
const Wallet = require("../models/wallet.model");

const authRoutes = require("../routes/auth.route");
const orderRoutes = require("../routes/order.route");
const adminRoutes = require("../routes/admin.route");

async function runAdminWorkflowVerification() {
  console.log("=== Starting Admin Dashboard Routes & Dispute Management Verification ===");

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("[Test] Connected to MongoDB");

  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/orders", orderRoutes);
  app.use("/api/v1/admin", adminRoutes);

  const server = http.createServer(app);
  socketService.init(server);

  const TEST_PORT = 9878;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test] Server running on port ${TEST_PORT}`);

  // Create Test Admin, User, Business, Rider
  const testAdmin = await Admin.create({
    role: "SUPER_ADMIN",
    profile: {
      full_name: "Super Admin Test",
      email: `admin_${Date.now()}@example.com`,
      phone_number: `+23470${Math.floor(10000000 + Math.random() * 90000000)}`,
    },
    auth: { password: "Password123!" },
  });

  const testUser = await User.create({
    profile: {
      first_name: "Dispute",
      last_name: "Customer",
      email: `user_disp_${Date.now()}@example.com`,
      phone_number: `+23480${Math.floor(10000000 + Math.random() * 90000000)}`,
    },
    auth: { password: "Password123!" },
  });

  const testBusiness = await Business.create({
    name: "Admin Test Bistro",
    contact_email: `biz_adm_${Date.now()}@example.com`,
    phone_number: `+23481${Math.floor(10000000 + Math.random() * 90000000)}`,
    locations: [{
      street_address: "100 Admin Way",
      city: "Lagos",
      state: "Lagos",
      coordinates: { type: "Point", coordinates: [3.3792, 6.5244] },
    }],
    business_type: "RESTAURANT",
  });

  const customerWallet = await Wallet.create({
    wallet_id: `wal_usr_${testUser._id}`,
    owner: testUser._id,
    owner_id: String(testUser._id),
    owner_type: "USER",
    virtual_account_number: `99${Math.floor(100000000 + Math.random() * 900000000)}`,
    bank_name: "Wema Bank",
    current_balance: 1000,
  });

  const menuItem = await MenuItem.create({
    business: testBusiness._id,
    name: "Special Steak",
    price: 5000,
    category: "Main",
  });

  const order = await Order.create({
    order_id: `ord_test_${Date.now()}`,
    customer: testUser._id,
    business: testBusiness._id,
    items: [{ menu_item: menuItem._id, quantity: 1, name: "Special Steak", unit_price: 5000, subtotal: 5000 }],
    pricing: { items_total: 5000, delivery_fee: 1000, total_amount: 6000 },
    delivery_address: { street_address: "100 Admin Way", city: "Lagos", state: "Lagos", coordinates: { type: "Point", coordinates: [3.3792, 6.5244] } },
    payment_status: "PAID",
    order_status: "DELIVERED",
  });

  const adminToken = createAccessToken("ADMIN", testAdmin).token;
  const userToken = createAccessToken("USER", testUser).token;

  console.log("[Test] Seed entities and tokens created successfully.");

  // 1. Test GET /api/v1/admin/metrics
  const metricsRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/admin/metrics`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const metricsData = await metricsRes.json();
  console.log("[Test] GET /admin/metrics:", metricsData.data.platform_summary);

  // 2. Test POST /api/v1/admin/disputes
  const createDisputeRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/admin/disputes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      order_id: order._id,
      reason: "ITEM_MISSING",
      description: "Steak was missing side salad item.",
    }),
  });
  const disputeData = await createDisputeRes.json();
  const createdDispute = disputeData.data.dispute;
  console.log(`[Test] Created dispute ${createdDispute.dispute_id} for order ${order.order_id}`);

  // 3. Test GET /api/v1/admin/disputes
  const getDisputesRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/admin/disputes`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const disputesList = await getDisputesRes.json();
  console.log(`[Test] GET /admin/disputes count: ${disputesList.data.disputes.length}`);

  // 4. Test PATCH /api/v1/admin/disputes/:disputeId/resolve (RESOLVED_REFUNDED)
  const resolveRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/admin/disputes/${createdDispute._id}/resolve`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      status: "RESOLVED_REFUNDED",
      resolution_notes: "Approved full refund of ₦6000 due to order issue.",
      refund_amount: 6000,
    }),
  });
  const resolveData = await resolveRes.json();
  console.log("[Test] Resolved dispute:", resolveData.message);

  // Verify Customer Wallet Balance Credited
  const updatedWallet = await Wallet.findById(customerWallet._id);
  console.log(`[Test] Customer Wallet Balance after refund: ₦${updatedWallet.current_balance} (Initial: ₦1000)`);

  // 5. Test GET /api/v1/admin/users
  const usersRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/admin/users?type=USER`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const usersData = await usersRes.json();
  console.log(`[Test] GET /admin/users count: ${usersData.data.accounts.length}`);

  // 6. Test PATCH /api/v1/admin/users/:userId/status
  const statusRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/admin/users/${testUser._id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ account_type: "USER", status: "SUSPENDED" }),
  });
  const statusData = await statusRes.json();
  console.log("[Test] Updated account status:", statusData.message);

  // Clean up
  await Admin.deleteOne({ _id: testAdmin._id });
  await User.deleteOne({ _id: testUser._id });
  await Business.deleteOne({ _id: testBusiness._id });
  await MenuItem.deleteOne({ _id: menuItem._id });
  await Order.deleteOne({ _id: order._id });
  await Dispute.deleteOne({ _id: createdDispute._id });
  await Wallet.deleteOne({ _id: customerWallet._id });

  server.close();
  await mongoose.disconnect();

  const passed =
    metricsData.success &&
    createdDispute.dispute_id &&
    updatedWallet.current_balance === 7000 && // 1000 + 6000 refund
    statusData.data.account.account_status === "SUSPENDED";

  if (passed) {
    console.log("\n✅ ALL ADMIN DASHBOARD & DISPUTE MANAGEMENT TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("\n❌ ADMIN DASHBOARD TEST FAILED.");
    process.exit(1);
  }
}

runAdminWorkflowVerification().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
