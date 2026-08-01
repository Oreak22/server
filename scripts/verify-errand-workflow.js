require("dotenv").config();
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const socketService = require("../services/socket.service");
const { createAccessToken } = require("../services/token.service");

const User = require("../models/user.model");
const Rider = require("../models/rider.model");
const ErrandOrder = require("../models/errandOrder.model");
const Wallet = require("../models/wallet.model");

const authRoutes = require("../routes/auth.route");
const errandRoutes = require("../routes/errand.route");

async function runErrandWorkflowVerification() {
  console.log("=== Starting Errand Features Subsystem Verification ===");

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("[Test] Connected to MongoDB");

  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/errands", errandRoutes);

  const server = http.createServer(app);
  socketService.init(server);

  const TEST_PORT = 9880;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test] Server & WebSockets running on port ${TEST_PORT}`);

  // Seed Customer, Rider, and Wallets
  const testUser = await User.create({
    profile: {
      first_name: "Errand",
      last_name: "Customer",
      email: `usr_erd_${Date.now()}@example.com`,
      phone_number: `+23480${Math.floor(10000000 + Math.random() * 90000000)}`,
    },
    auth: { password: "Password123!" },
  });

  const testRider = await Rider.create({
    rider_id: `rdr_${Date.now()}`,
    personal_info: {
      full_name: "Swift Errand Runner",
      phone_number: `+23490${Math.floor(10000000 + Math.random() * 90000000)}`,
      emergency_contact: "+2348000000000",
    },
    employment_details: {
      employment_status: "FULL_TIME",
      base_daily_salary: 5000,
      date_joined: new Date(),
    },
    assigned_asset: {
      vehicle_id: `v_${Date.now()}`,
      vehicle_type: "MOTORCYCLE",
      license_plate: `ERD-${Math.floor(1000 + Math.random() * 9000)}`,
      tracker_device_id: `tr_${Date.now()}`,
    },
    daily_performance_counters: { date: new Date() },
    auth: { password: "Password123!" },
  });

  const customerWallet = await Wallet.create({
    wallet_id: `wal_usr_${testUser._id}`,
    owner: testUser._id,
    owner_id: String(testUser._id),
    owner_type: "USER",
    virtual_account_number: `99${Math.floor(100000000 + Math.random() * 900000000)}`,
    bank_name: "Wema Bank",
    current_balance: 30000,
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

  const userToken = createAccessToken("USER", testUser).token;
  const riderToken = createAccessToken("RIDER", testRider).token;

  console.log("[Test] Seed database entities created.");

  // 1. Calculate Fee Estimate via POST /api/v1/errands/estimate
  const estimateRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/errands/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      complexity_tier: "GROCERY_SHOPPING",
      estimated_item_budget: 15000,
      errand_location: {
        name: "Shoprite Ikeja City Mall",
        street_address: "Obafemi Awolowo Way",
        city: "Lagos",
        state: "Lagos",
        coordinates: { type: "Point", coordinates: [3.3582, 6.6173] },
      },
      dropoff_location: {
        name: "Home",
        street_address: "14 Allen Avenue",
        city: "Lagos",
        state: "Lagos",
        coordinates: { type: "Point", coordinates: [3.3521, 6.5985] },
      },
      driver_tip: 1000,
    }),
  });
  const estimateData = await estimateRes.json();
  console.log(`[Test] Errand Fee Estimate calculated: Distance ${estimateData.data.estimated_distance_km} km, Total: ₦${estimateData.data.pricing.total_amount}`);

  // 2. Create Errand Request
  const createRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/errands/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      task_description: "Please buy 2 bags of jasmine rice and 1 bottle of oil from Shoprite and deliver to 14 Allen Avenue.",
      errand_category: "SHOPPING_AND_BUYING",
      complexity_tier: "GROCERY_SHOPPING",
      estimated_item_budget: 15000,
      errand_location: {
        name: "Shoprite Ikeja City Mall",
        street_address: "Obafemi Awolowo Way",
        city: "Lagos",
        state: "Lagos",
        coordinates: { type: "Point", coordinates: [3.3582, 6.6173] },
      },
      dropoff_location: {
        name: "Home Apartment",
        street_address: "14 Allen Avenue",
        city: "Lagos",
        state: "Lagos",
        coordinates: { type: "Point", coordinates: [3.3521, 6.5985] },
        contact_person: "John Doe",
        contact_phone: "+2348012345678",
      },
      driver_tip: 1000,
    }),
  });
  const createData = await createRes.json();
  const errandOrder = createData.data.order;
  console.log(`[Test] Errand Order created with ID ${errandOrder.order_id}, Total Amount: ₦${errandOrder.pricing.total_amount}`);

  // 3. Pay Errand Order with Wallet
  const payRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/errands/orders/${errandOrder._id}/pay`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const payData = await payRes.json();
  console.log("[Test] Pay Errand Order:", payData.message);

  // 4. Progress Status via Rider
  const statusTransitions = ["ASSIGNED", "AT_ERRAND_LOCATION", "PURCHASING_IN_PROGRESS", "IN_TRANSIT", "DELIVERED"];

  for (const status of statusTransitions) {
    const statusRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/errands/orders/${errandOrder._id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${riderToken}` },
      body: JSON.stringify({
        order_status: status,
      }),
    });
    const statusData = await statusRes.json();
    console.log(`[Test] Errand status updated to: ${statusData.data.order.order_status}`);
  }

  // 5. Verify Rider Payout
  const updatedRiderWallet = await Wallet.findById(riderWallet._id);
  console.log(`[Test] Rider Wallet Balance after completing errand: ₦${updatedRiderWallet.current_balance}`);

  // Cleanup
  await User.deleteOne({ _id: testUser._id });
  await Rider.deleteOne({ _id: testRider._id });
  await ErrandOrder.deleteOne({ _id: errandOrder._id });
  await Wallet.deleteOne({ _id: customerWallet._id });
  await Wallet.deleteOne({ _id: riderWallet._id });

  server.close();
  await mongoose.disconnect();

  const passed =
    estimateData.success &&
    createData.success &&
    payData.data.order.payment_status === "PAID" &&
    updatedRiderWallet.current_balance > 0;

  if (passed) {
    console.log("\n✅ ALL ERRAND FEATURES SUBSYSTEM TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("\n❌ ERRAND FEATURES TEST FAILED.");
    process.exit(1);
  }
}

runErrandWorkflowVerification().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
