const express = require("express");
const router = express.Router();
const {
  getAllRestaurants,
  getRestaurantById,
  getRestaurantMenu,
  getMyRestaurantMenu,
  getRestaurantCategories,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} = require("../controllers/restaurant.controller");
const { authenticateAccessToken } = require("../middlewares/auth.middleware");
const { uploadSingleImage } = require("../middlewares/upload.middleware");

// Public endpoints
router.get("/", getAllRestaurants);
router.get("/categories", getRestaurantCategories);
router.get("/my-menu", authenticateAccessToken, getMyRestaurantMenu);
router.get("/:id", getRestaurantById);
router.get("/:id/menu", getRestaurantMenu);


// Protected endpoints for business owners / admins with Cloudinary image upload middleware
router.post(
  "/:id/menu",
  authenticateAccessToken,
  uploadSingleImage("image"),
  createMenuItem,
);
router.put(
  "/menu/:itemId",
  authenticateAccessToken,
  uploadSingleImage("image"),
  updateMenuItem,
);
router.delete("/menu/:itemId", authenticateAccessToken, deleteMenuItem);

module.exports = router;
