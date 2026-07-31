const mongoose = require("mongoose");
const crypto = require("crypto");
const Admin = require("../models/admin.model");
const User = require("../models/user.model");
const Business = require("../models/business.model");
const Rider = require("../models/rider.model");
const Order = require("../models/order.model");
const Dispute = require("../models/dispute.model");
const Wallet = require("../models/wallet.model");
const WalletTransaction = require("../models/walletTransaction.model");

/**
 * @desc Get real-time platform system metrics and statistics
 * @route GET /api/v1/admin/metrics
 * @access Private (ADMIN)
 */
async function getSystemMetrics(req, res, next) {
  try {
    if (req.auth.subject_type !== "ADMIN") {
      return res.status(403).json({ message: "Only administrators can view system metrics" });
    }

    const [
      totalUsers,
      totalBusinesses,
      activeBusinesses,
      totalRiders,
      availableRiders,
      deliveringRiders,
      orderStatusCounts,
      gmvAggregation,
      disputeCounts,
    ] = await Promise.all([
      User.countDocuments(),
      Business.countDocuments(),
      Business.countDocuments({ status: "ACTIVE" }),
      Rider.countDocuments(),
      Rider.countDocuments({ "live_telemetry.current_status": "AVAILABLE" }),
      Rider.countDocuments({ "live_telemetry.current_status": "DELIVERING" }),
      Order.aggregate([
        { $group: { _id: "$order_status", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { order_status: { $in: ["PAID", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "IN_TRANSIT", "DELIVERED"] } } },
        { $group: { _id: null, total_gmv: { $sum: "$pricing.total_amount" } } },
      ]),
      Dispute.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);

    const formattedOrderStats = {
      PENDING_PAYMENT: 0,
      PAID: 0,
      ACCEPTED: 0,
      PREPARING: 0,
      READY_FOR_PICKUP: 0,
      IN_TRANSIT: 0,
      DELIVERED: 0,
      CANCELLED: 0,
    };
    orderStatusCounts.forEach((item) => {
      if (item._id && formattedOrderStats[item._id] !== undefined) {
        formattedOrderStats[item._id] = item.count;
      }
    });

    const formattedDisputeStats = {
      OPEN: 0,
      UNDER_INVESTIGATION: 0,
      RESOLVED_REFUNDED: 0,
      RESOLVED_REJECTED: 0,
      CLOSED: 0,
    };
    disputeCounts.forEach((item) => {
      if (item._id && formattedDisputeStats[item._id] !== undefined) {
        formattedDisputeStats[item._id] = item.count;
      }
    });

    const totalGmv = gmvAggregation.length > 0 ? gmvAggregation[0].total_gmv : 0;
    const totalOrdersCount = Object.values(formattedOrderStats).reduce((a, b) => a + b, 0);

    return res.json({
      message: "System metrics fetched successfully",
      success: true,
      data: {
        platform_summary: {
          total_users: totalUsers,
          total_businesses: totalBusinesses,
          active_businesses: activeBusinesses,
          total_riders: totalRiders,
          available_riders: availableRiders,
          delivering_riders: deliveringRiders,
          total_gmv_ngn: totalGmv,
          total_orders: totalOrdersCount,
        },
        orders_by_status: formattedOrderStats,
        disputes_by_status: formattedDisputeStats,
        generated_at: new Date(),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Create a new order dispute
 * @route POST /api/v1/admin/disputes
 * @access Private (USER / BUSINESS / RIDER / ADMIN)
 */
async function createDispute(req, res, next) {
  try {
    const { order_id, reason, description } = req.body;

    if (!order_id || !reason || !description) {
      return res.status(400).json({ message: "order_id, reason, and description are required" });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(order_id);
    const lookup = isObjectId ? { _id: order_id } : { order_id };

    const order = await Order.findOne(lookup);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const openerType = req.auth?.subject_type || "USER";
    const openerId = req.auth?.sub;

    const dispute = await Dispute.create({
      order: order._id,
      opened_by_type: openerType,
      opened_by: openerId,
      reason,
      description,
    });

    const populatedDispute = await Dispute.findById(dispute._id)
      .populate("order")
      .populate("opened_by", "profile name personal_info");

    return res.status(201).json({
      message: `Dispute created successfully with ID ${dispute.dispute_id}`,
      success: true,
      data: { dispute: populatedDispute },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get disputes list with filtering options
 * @route GET /api/v1/admin/disputes
 * @access Private (ADMIN)
 */
async function getDisputes(req, res, next) {
  try {
    if (req.auth.subject_type !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can list platform disputes" });
    }

    const { status, reason, limit = 20, page = 1 } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (reason) filter.reason = reason;

    const skip = (Number(page) - 1) * Number(limit);

    const disputes = await Dispute.find(filter)
      .populate("order")
      .populate("opened_by", "profile name personal_info")
      .populate("assigned_admin", "profile role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Dispute.countDocuments(filter);

    return res.json({
      message: "Disputes fetched successfully",
      success: true,
      data: {
        disputes,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get single dispute by ID
 * @route GET /api/v1/admin/disputes/:disputeId
 * @access Private (ADMIN)
 */
async function getDisputeById(req, res, next) {
  try {
    if (req.auth.subject_type !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can view dispute details" });
    }

    const { disputeId } = req.params;
    const isObjectId = mongoose.Types.ObjectId.isValid(disputeId);
    const lookup = isObjectId ? { _id: disputeId } : { dispute_id: disputeId };

    const dispute = await Dispute.findOne(lookup)
      .populate({
        path: "order",
        populate: [
          { path: "customer", select: "profile" },
          { path: "business", select: "name phone_number locations" },
          { path: "rider", select: "personal_info assigned_asset" },
        ],
      })
      .populate("opened_by", "profile name personal_info")
      .populate("assigned_admin", "profile role");

    if (!dispute) {
      return res.status(404).json({ message: "Dispute record not found" });
    }

    return res.json({
      message: "Dispute details retrieved successfully",
      success: true,
      data: { dispute },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Resolve dispute and handle customer refund if applicable
 * @route PATCH /api/v1/admin/disputes/:disputeId/resolve
 * @access Private (ADMIN)
 */
async function resolveDispute(req, res, next) {
  try {
    if (req.auth.subject_type !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can resolve disputes" });
    }

    const { disputeId } = req.params;
    const { status, resolution_notes, refund_amount } = req.body;

    const validStatuses = ["RESOLVED_REFUNDED", "RESOLVED_REJECTED", "CLOSED", "UNDER_INVESTIGATION"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(disputeId);
    const lookup = isObjectId ? { _id: disputeId } : { dispute_id: disputeId };

    const dispute = await Dispute.findOne(lookup).populate("order");
    if (!dispute) {
      return res.status(404).json({ message: "Dispute record not found" });
    }

    const now = new Date();

    // If resolving with a refund, process customer wallet credit
    if (status === "RESOLVED_REFUNDED") {
      const amountToRefund = refund_amount !== undefined ? Number(refund_amount) : (dispute.order?.pricing?.total_amount || 0);

      if (amountToRefund > 0 && dispute.order?.customer) {
        const customerWallet = await Wallet.findOne({
          owner: dispute.order.customer,
          owner_type: "USER",
        });

        if (customerWallet) {
          const balanceBefore = customerWallet.current_balance;
          customerWallet.current_balance += amountToRefund;
          const balanceAfter = customerWallet.current_balance;
          customerWallet.last_updated_at = now;
          await customerWallet.save();

          await WalletTransaction.create({
            transaction_id: `txn_${crypto.randomBytes(6).toString("hex")}`,
            wallet: customerWallet._id,
            wallet_id: customerWallet.wallet_id,
            transaction_type: "CREDIT",
            amount: amountToRefund,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            reference_code: `DSP_REFUND_${dispute.dispute_id}`,
            description: `Refund for dispute ${dispute.dispute_id} on order ${dispute.order.order_id}`,
            order_id: dispute.order.order_id,
          });
        }
      }

      dispute.refund_amount = amountToRefund;
    }

    dispute.status = status;
    dispute.resolution_notes = resolution_notes || dispute.resolution_notes;
    dispute.assigned_admin = req.auth.sub;
    dispute.resolved_at = now;

    await dispute.save();

    const updatedDispute = await Dispute.findById(dispute._id)
      .populate({
        path: "order",
        populate: [{ path: "customer", select: "profile" }],
      })
      .populate("assigned_admin", "profile role");

    return res.json({
      message: `Dispute ${dispute.dispute_id} resolved with status "${status}"`,
      success: true,
      data: { dispute: updatedDispute },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Get platform users (Customers, Businesses, Riders)
 * @route GET /api/v1/admin/users
 * @access Private (ADMIN)
 */
async function getPlatformUsers(req, res, next) {
  try {
    if (req.auth.subject_type !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can list platform users" });
    }

    const { type = "USER", limit = 20, page = 1 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    let accounts = [];
    let total = 0;

    if (type === "BUSINESS") {
      accounts = await Business.find().skip(skip).limit(Number(limit)).sort({ createdAt: -1 });
      total = await Business.countDocuments();
    } else if (type === "RIDER") {
      accounts = await Rider.find().skip(skip).limit(Number(limit)).sort({ createdAt: -1 });
      total = await Rider.countDocuments();
    } else {
      accounts = await User.find().skip(skip).limit(Number(limit)).sort({ createdAt: -1 });
      total = await User.countDocuments();
    }

    return res.json({
      message: `Platform ${type.toLowerCase()} accounts fetched successfully`,
      success: true,
      data: {
        accounts,
        pagination: {
          total,
          page: Number(page),
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * @desc Update account status (ACTIVE, SUSPENDED, INACTIVE) for User, Business, or Rider
 * @route PATCH /api/v1/admin/users/:userId/status
 * @access Private (ADMIN)
 */
async function updateAccountStatus(req, res, next) {
  try {
    if (req.auth.subject_type !== "ADMIN") {
      return res.status(403).json({ message: "Only admins can update account statuses" });
    }

    const { userId } = req.params;
    const { account_type = "USER", status } = req.body;

    const validStatuses = ["ACTIVE", "SUSPENDED", "INACTIVE"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    let updatedAccount = null;

    if (account_type === "BUSINESS") {
      updatedAccount = await Business.findByIdAndUpdate(userId, { status }, { new: true });
    } else if (account_type === "RIDER") {
      updatedAccount = await Rider.findByIdAndUpdate(userId, { account_status: status }, { new: true });
    } else {
      updatedAccount = await User.findByIdAndUpdate(userId, { account_status: status }, { new: true });
    }

    if (!updatedAccount) {
      return res.status(404).json({ message: "Account not found" });
    }

    return res.json({
      message: `Account status updated to ${status}`,
      success: true,
      data: { account: updatedAccount },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSystemMetrics,
  createDispute,
  getDisputes,
  getDisputeById,
  resolveDispute,
  getPlatformUsers,
  updateAccountStatus,
};
