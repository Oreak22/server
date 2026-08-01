require("dotenv").config();
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const socketService = require("../services/socket.service");
const { createAccessToken } = require("../services/token.service");

const User = require("../models/user.model");
const Business = require("../models/business.model");
const Rider = require("../models/rider.model");
const LaundryItem = require("../models/laundryItem.model");
const LaundryOrder = require("../models/laundryOrder.model");
const Wallet = require("../models/wallet.model");

const authRoutes = require("../routes/auth.route");
const laundryRoutes = require("../routes/laundry.route");

async function runLaundryWorkflowVerification() {
  console.log("=== Starting Laundry Service Subsystem Verification ===");

  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is missing");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("[Test] Connected to MongoDB");

  const app = express();
  app.use(express.json());
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/laundry", laundryRoutes);

  const server = http.createServer(app);
  socketService.init(server);

  const TEST_PORT = 9879;
  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`[Test] Server & WebSockets running on port ${TEST_PORT}`);

  // Create Test Laundry Vendor, Customer, Rider, and Wallets
  const testVendor = await Business.create({
    name: "Fresh & Crisp Laundry",
    contact_email: `laundry_${Date.now()}@example.com`,
    phone_number: `+23481${Math.floor(10000000 + Math.random() * 90000000)}`,
    locations: [{
      street_address: "22 Commercial Ave",
      city: "Lagos",
      state: "Lagos",
      coordinates: { type: "Point", coordinates: [3.3792, 6.5244] },
    }],
    business_type: "LAUNDRY",
    services_rendered: [{ name: "Wash & Fold", category: "LAUNDRY", base_price: 600 }],
  });

  const testUser = await User.create({
    profile: {
      first_name: "Laundry",
      last_name: "Customer",
      email: `usr_lnd_${Date.now()}@example.com`,
      phone_number: `+23480${Math.floor(10000000 + Math.random() * 90000000)}`,
    },
    auth: { password: "Password123!" },
  });

  const testRider = await Rider.create({
    rider_id: `rdr_${Date.now()}`,
    personal_info: {
      full_name: "Speedy Laundry Courier",
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
      license_plate: `LND-${Math.floor(1000 + Math.random() * 9000)}`,
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
    current_balance: 20000,
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
  const vendorToken = createAccessToken("BUSINESS", testVendor).token;

  console.log("[Test] Database seed entities created.");

  // 1. Create Catalog Item via POST /api/v1/laundry/catalog
  const catalogRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/laundry/catalog`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${vendorToken}` },
    body: JSON.stringify({
      name: "Standard Laundry Bag (Per Kg)",
      category: "BAG_WEIGHT_TIER",
      supported_services: ["WASH_AND_FOLD", "WASH_AND_IRON"],
      pricing_type: "PER_KG",
      unit_price: 600,
      description: "Washing and folding for general laundry bag",
    }),
  });
  const catalogData = await catalogRes.json();
  console.log("[Test] Created Laundry Catalog Item:", catalogData.data.item.name);

  // 2. Fetch Vendors and Catalog
  const vendorRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/laundry/vendors`);
  const vendorList = await vendorRes.json();
  console.log(`[Test] GET /laundry/vendors returned ${vendorList.data.vendors.length} vendor(s)`);

  // 3. Book Laundry Service with Scheduling Calendar & Bag Weight
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const returnDay = new Date();
  returnDay.setDate(returnDay.getDate() + 3);

  const bookingRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/laundry/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      business: testVendor._id,
      service_type: "WASH_AND_FOLD",
      pricing_mode: "BAG_WEIGHT",
      bag_weight: {
        weight_kg: 10,
        price_per_kg: 600,
        bag_tier: "MEDIUM_BAG_10KG",
      },
      care_preferences: {
        detergent_preference: "HYPOALLERGENIC",
        starch_level: "LIGHT_STARCH",
        is_express_turnover: true,
        special_instructions: "Separate white shirts",
      },
      pickup_slot: {
        date: tomorrow.toISOString(),
        time_slot: "09:00 - 11:00 AM",
      },
      return_slot: {
        date: returnDay.toISOString(),
        time_slot: "03:00 - 05:00 PM",
      },
      pickup_address: {
        street_address: "15 Marina St",
        city: "Lagos",
        state: "Lagos",
        coordinates: { type: "Point", coordinates: [3.3792, 6.5244] },
      },
      return_address: {
        street_address: "15 Marina St",
        city: "Lagos",
        state: "Lagos",
        coordinates: { type: "Point", coordinates: [3.3792, 6.5244] },
      },
      pickup_delivery_fee: 1000,
      driver_tip: 500,
    }),
  });
  const bookingData = await bookingRes.json();
  const bookedOrder = bookingData.data.order;
  console.log(`[Test] Laundry service booked with Order ID ${bookedOrder.order_id}, Total Amount: ₦${bookedOrder.pricing.total_amount}`);

  // 4. Pay Laundry Order via Delivery Wallet
  const payRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/laundry/orders/${bookedOrder._id}/pay`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const payData = await payRes.json();
  console.log("[Test] Pay Laundry Order:", payData.message);

  // 5. Update Status Progression to DELIVERED with Rider Payout
  const statusTransitions = ["PICKUP_SCHEDULED", "PICKED_UP", "WASHING_IN_PROGRESS", "READY_FOR_DELIVERY", "DELIVERED"];

  for (const status of statusTransitions) {
    const statusRes = await fetch(`http://localhost:${TEST_PORT}/api/v1/laundry/orders/${bookedOrder._id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${vendorToken}` },
      body: JSON.stringify({
        order_status: status,
        rider_id: testRider._id,
      }),
    });
    const statusData = await statusRes.json();
    console.log(`[Test] Order status transitioned to: ${statusData.data.order.order_status}`);
  }

  // 6. Verify Rider Wallet Payout
  const updatedRiderWallet = await Wallet.findById(riderWallet._id);
  console.log(`[Test] Rider Wallet Balance after delivery completion: ₦${updatedRiderWallet.current_balance} (Delivery Fee + Tip: ₦1500)`);

  // Cleanup
  await Business.deleteOne({ _id: testVendor._id });
  await User.deleteOne({ _id: testUser._id });
  await Rider.deleteOne({ _id: testRider._id });
  await LaundryItem.deleteOne({ _id: catalogData.data.item._id });
  await LaundryOrder.deleteOne({ _id: bookedOrder._id });
  await Wallet.deleteOne({ _id: customerWallet._id });
  await Wallet.deleteOne({ _id: riderWallet._id });

  server.close();
  await mongoose.disconnect();

  const passed =
    bookingData.success &&
    payData.data.order.payment_status === "PAID" &&
    updatedRiderWallet.current_balance === 1500;

  if (passed) {
    console.log("\n✅ ALL LAUNDRY SERVICE SUBSYSTEM TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.error("\n❌ LAUNDRY SERVICE TEST FAILED.");
    process.exit(1);
  }
}

runLaundryWorkflowVerification().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
