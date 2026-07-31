const http = require("http");
const express = require("express");
const app = express();
require("dotenv").config();
const mongoose = require("mongoose");
const socketService = require("./services/socket.service");

const authRoutes = require("./routes/auth.route");
const walletRoutes = require("./routes/wallet.route");
const monnifyRoutes = require("./routes/monnify.route");
const profileRoutes = require("./routes/profile.route");
const restaurantRoutes = require("./routes/restaurant.route");
const orderRoutes = require("./routes/order.route");
const riderRoutes = require("./routes/rider.route");
const adminRoutes = require("./routes/admin.route");

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Initialize Socket.io WebSockets
socketService.init(server);

app.use(express.static("public"));
app.use(
  express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/wallets", walletRoutes);
app.use("/api/v1/monnify", monnifyRoutes);
app.use("/api/v1/profile", profileRoutes);
app.use("/api/v1/restaurants", restaurantRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/riders", riderRoutes);
app.use("/api/v1/admin", adminRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is required to start the server");
  process.exit(1);
}

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    server.listen(PORT, () => {
      console.log("Connected to MongoDB");
      console.log(`Server & WebSockets running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed", err);
    process.exit(1);
  });

