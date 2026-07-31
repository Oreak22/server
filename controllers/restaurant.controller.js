const mongoose = require("mongoose");
const Business = require("../models/business.model");
const MenuItem = require("../models/menuItem.model");
const { uploadImage } = require("../services/cloudinary.service");

/**
 * Helper to safely parse JSON strings from multipart/form-data fields
 */
function parseJsonField(val) {
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

/**
 * @desc Get all food categories / cravings across registered restaurants
 * @route GET /api/v1/restaurants/categories
 * @access Public
 */
async function getRestaurantCategories(req, res, next) {
  try {
    const categoriesFromItems = await MenuItem.distinct("category", {
      status: "ACTIVE",
    });

    const defaultCategories = [
      "Swallow & Mains",
      "Fast Food",
      "Burgers & Pizza",
      "African Delicacies",
      "Rice Dishes",
      "Soups & Stews",
      "Drinks & Beverages",
      "Desserts & Snacks",
      "Chef Special",
    ];

    const categories = [
      ...new Set([...categoriesFromItems, ...defaultCategories]),
    ].sort();

    return res.json({
      message: "Restaurant categories fetched successfully",
      success: true,
      data: { categories },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get all registered restaurants with filtering, geospatial location, and pagination
 * @route GET /api/v1/restaurants
 * @access Public
 */
async function getAllRestaurants(req, res, next) {
  try {
    const {
      search,
      q,
      city,
      state,
      is_open,
      lat,
      lng,
      latitude,
      longitude,
      max_distance_km,
      page = 1,
      limit = 10,
    } = req.query;

    const searchTerm = search || q;
    const filter = {
      status: "ACTIVE",
      "services_rendered.category": "RESTAURANT",
    };

    const userLat = parseFloat(lat || latitude);
    const userLng = parseFloat(lng || longitude);

    if (!isNaN(userLat) && !isNaN(userLng)) {
      const maxDistanceMeters = (parseFloat(max_distance_km) || 10) * 1000;
      filter["locations.coordinates"] = {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [userLng, userLat],
          },
          $maxDistance: maxDistanceMeters,
        },
      };
    }

    if (searchTerm) {
      const searchRegex = new RegExp(searchTerm.trim(), "i");
      filter.$or = [
        { name: searchRegex },
        { "locations.city": searchRegex },
        { "locations.state": searchRegex },
        { "locations.street_address": searchRegex },
      ];
    }

    if (city) {
      filter["locations.city"] = new RegExp(city.trim(), "i");
    }

    if (state) {
      filter["locations.state"] = new RegExp(state.trim(), "i");
    }

    if (is_open === "true") {
      filter["open_status.is_open_now"] = true;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [restaurants, total] = await Promise.all([
      Business.find(filter)
        .select("-auth")
        .sort({ "open_status.is_open_now": -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Business.countDocuments(filter),
    ]);


    return res.json({
      message: "Restaurants fetched successfully",
      success: true,
      data: {
        restaurants,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum) || 1,
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get single restaurant details by ID
 * @route GET /api/v1/restaurants/:id
 * @access Public
 */
async function getRestaurantById(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid restaurant ID format" });
    }

    const restaurant = await Business.findById(id).select("-auth");

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    const isRestaurant = restaurant.services_rendered?.some(
      (s) => s.category === "RESTAURANT",
    );

    if (!isRestaurant) {
      return res
        .status(400)
        .json({ message: "Specified business is not registered as a restaurant" });
    }

    return res.json({
      message: "Restaurant details fetched successfully",
      success: true,
      data: { restaurant },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get menu items for a specific restaurant
 * @route GET /api/v1/restaurants/:id/menu
 * @access Public
 */
async function getRestaurantMenu(req, res, next) {
  try {
    const { id } = req.params;
    const { category, is_available, groupByCategory, all } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid restaurant ID format" });
    }

    const restaurant = await Business.findById(id).select(
      "name locations open_status services_rendered contact_email phone_number",
    );

    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    const filter = {
      business: id,
      status: { $ne: "ARCHIVED" },
    };

    if (category) {
      filter.category = new RegExp(`^${category.trim()}$`, "i");
    }

    if (all !== "true" && is_available !== "false") {
      filter.is_available = true;
    } else if (is_available === "false") {
      filter.is_available = false;
    }

    const menuItems = await MenuItem.find(filter).sort({
      category: 1,
      name: 1,
    });

    const categories = [
      ...new Set(menuItems.map((item) => item.category)),
    ].sort();

    let formattedMenu = menuItems;

    if (groupByCategory === "true") {
      formattedMenu = categories.reduce((acc, cat) => {
        acc[cat] = menuItems.filter((item) => item.category === cat);
        return acc;
      }, {});
    }

    return res.json({
      message: "Restaurant menu fetched successfully",
      success: true,
      data: {
        restaurant: {
          id: restaurant._id,
          name: restaurant.name,
          locations: restaurant.locations,
          open_status: restaurant.open_status,
          contact_email: restaurant.contact_email,
          phone_number: restaurant.phone_number,
        },
        categories,
        total_items: menuItems.length,
        menu: formattedMenu,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get authenticated business owner's own menu
 * @route GET /api/v1/restaurants/my-menu
 * @access Private (Business)
 */
async function getMyRestaurantMenu(req, res, next) {
  try {
    if (req.auth.subject_type !== "BUSINESS") {
      return res.status(403).json({ message: "Business merchant access required" });
    }

    const businessId = req.auth.sub;
    const menuItems = await MenuItem.find({
      business: businessId,
      status: { $ne: "ARCHIVED" },
    }).sort({ category: 1, createdAt: -1 });

    const categories = [...new Set(menuItems.map((item) => item.category))].sort();

    return res.json({
      message: "Own restaurant menu fetched successfully",
      success: true,
      data: {
        categories,
        total_items: menuItems.length,
        menuItems,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Create a new menu item for a restaurant (with Cloudinary image upload)
 * @route POST /api/v1/restaurants/:id/menu
 * @access Private (Business / Admin)
 */
async function createMenuItem(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid restaurant ID format" });
    }

    if (
      req.auth.subject_type === "BUSINESS" &&
      String(req.auth.sub) !== String(id)
    ) {
      return res
        .status(403)
        .json({ message: "Unauthorized to add menu items to this restaurant" });
    }

    if (
      req.auth.subject_type !== "BUSINESS" &&
      req.auth.subject_type !== "ADMIN"
    ) {
      return res
        .status(403)
        .json({ message: "Only business owners or admins can add menu items" });
    }

    const restaurant = await Business.findById(id);
    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    const name = req.body.name;
    const price = req.body.price !== undefined ? Number(req.body.price) : undefined;
    const description = req.body.description;
    const category = req.body.category || "General";
    const preparation_time_minutes = req.body.preparation_time_minutes
      ? Number(req.body.preparation_time_minutes)
      : 20;
    const is_available =
      req.body.is_available !== undefined
        ? req.body.is_available === "true" || req.body.is_available === true
        : true;

    const options = parseJsonField(req.body.options) || [];
    const dietary_flags = parseJsonField(req.body.dietary_flags) || [];

    if (!name || price === undefined || isNaN(price)) {
      return res
        .status(400)
        .json({ message: "Valid item name and price are required" });
    }

    // Handle Cloudinary image upload if file buffer or image string provided
    let imageUrl = req.body.image_url;
    const fileOrImage = req.file || req.body.image || req.body.image_url;
    if (fileOrImage) {
      imageUrl = await uploadImage(fileOrImage, `oloja/restaurants/${id}/menu`);
    }

    const menuItem = await MenuItem.create({
      business: id,
      name,
      description,
      category,
      price,
      image_url: imageUrl,
      is_available,
      preparation_time_minutes,
      dietary_flags,
      options,
    });

    return res.status(201).json({
      message: "Menu item created successfully",
      success: true,
      data: { menuItem },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Update a menu item (with Cloudinary image upload)
 * @route PUT /api/v1/restaurants/menu/:itemId
 * @access Private (Business / Admin)
 */
async function updateMenuItem(req, res, next) {
  try {
    const { itemId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: "Invalid menu item ID format" });
    }

    const menuItem = await MenuItem.findById(itemId);
    if (!menuItem) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    if (
      req.auth.subject_type === "BUSINESS" &&
      String(req.auth.sub) !== String(menuItem.business)
    ) {
      return res
        .status(403)
        .json({ message: "Unauthorized to update this menu item" });
    }

    if (
      req.auth.subject_type !== "BUSINESS" &&
      req.auth.subject_type !== "ADMIN"
    ) {
      return res
        .status(403)
        .json({ message: "Only business owners or admins can update menu items" });
    }

    // Handle Cloudinary image upload if new file or image string is provided
    const fileOrImage = req.file || req.body.image || req.body.image_url;
    if (fileOrImage) {
      menuItem.image_url = await uploadImage(
        fileOrImage,
        `oloja/restaurants/${menuItem.business}/menu`,
      );
    }

    const allowedFields = [
      "name",
      "description",
      "category",
      "price",
      "is_available",
      "preparation_time_minutes",
      "status",
    ];

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        if (field === "price" || field === "preparation_time_minutes") {
          menuItem[field] = Number(req.body[field]);
        } else if (field === "is_available") {
          menuItem[field] =
            req.body[field] === "true" || req.body[field] === true;
        } else {
          menuItem[field] = req.body[field];
        }
      }
    });

    if (req.body.options !== undefined) {
      menuItem.options = parseJsonField(req.body.options);
    }

    if (req.body.dietary_flags !== undefined) {
      menuItem.dietary_flags = parseJsonField(req.body.dietary_flags);
    }

    await menuItem.save();

    return res.json({
      message: "Menu item updated successfully",
      success: true,
      data: { menuItem },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Delete/archive a menu item
 * @route DELETE /api/v1/restaurants/menu/:itemId
 * @access Private (Business / Admin)
 */
async function deleteMenuItem(req, res, next) {
  try {
    const { itemId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: "Invalid menu item ID format" });
    }

    const menuItem = await MenuItem.findById(itemId);
    if (!menuItem) {
      return res.status(404).json({ message: "Menu item not found" });
    }

    if (
      req.auth.subject_type === "BUSINESS" &&
      String(req.auth.sub) !== String(menuItem.business)
    ) {
      return res
        .status(403)
        .json({ message: "Unauthorized to delete this menu item" });
    }

    if (
      req.auth.subject_type !== "BUSINESS" &&
      req.auth.subject_type !== "ADMIN"
    ) {
      return res
        .status(403)
        .json({ message: "Only business owners or admins can delete menu items" });
    }

    menuItem.status = "ARCHIVED";
    menuItem.is_available = false;
    await menuItem.save();

    return res.json({
      message: "Menu item archived successfully",
      success: true,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getAllRestaurants,
  getRestaurantById,
  getRestaurantMenu,
  getMyRestaurantMenu,
  getRestaurantCategories,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
};

