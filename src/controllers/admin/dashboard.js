import User from "../../models/User.js";
import Resume from "../../models/Resume.js";
import PaymentLog from "../../models/PaymentLog.js";

export async function getDashboardStats(req, res) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    newToday,
    premiumUsers,
    suspendedUsers,
    totalPortfolios,
    published,
    draft,
    expired,
    revenueAll,
    revenueToday,
    revenueMonth,
    pendingRenewals,
    parsedToday,
    parsedMonth,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: startOfDay } }),
    User.countDocuments({ totalPublishedPortfolios: { $gt: 0 } }),
    User.countDocuments({ suspended: true }),
    Resume.countDocuments({ user: { $ne: null } }),
    Resume.countDocuments({ status: "active" }),
    Resume.countDocuments({ status: "draft" }),
    Resume.countDocuments({ status: "expired" }),
    PaymentLog.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    PaymentLog.aggregate([
      { $match: { status: "paid", createdAt: { $gte: startOfDay } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    PaymentLog.aggregate([
      { $match: { status: "paid", createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Resume.countDocuments({ status: "active", expiresAt: { $gt: now, $lte: in30Days } }),
    Resume.countDocuments({ createdAt: { $gte: startOfDay } }),
    Resume.countDocuments({ createdAt: { $gte: startOfMonth } }),
  ]);

  res.json({
    stats: {
      totalUsers,
      newToday,
      premiumUsers,
      freeUsers: totalUsers - premiumUsers,
      suspendedUsers,
      activeUsers: totalUsers - suspendedUsers,
      totalPortfolios,
      published,
      draft,
      expired,
      revenueTotal: revenueAll[0]?.total || 0,
      revenueToday: revenueToday[0]?.total || 0,
      revenueMonth: revenueMonth[0]?.total || 0,
      pendingRenewals,
      aiParseToday: parsedToday,
      aiParseMonth: parsedMonth,
      storageUsedGB: 0,
    },
  });
}

export async function getRecentActivity(req, res) {
  const [recentUsers, recentPayments, recentPortfolios] = await Promise.all([
    User.find()
      .select("name email createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    PaymentLog.find({ status: "paid" })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("userId", "name")
      .populate("portfolioId", "handle")
      .lean(),
    Resume.find({ status: "active" })
      .select("handle publishedAt parsedData user")
      .sort({ publishedAt: -1 })
      .limit(5)
      .populate("user", "name")
      .lean(),
  ]);

  const activity = [
    ...recentUsers.map((u) => ({
      type: "user",
      msg: `${u.name} registered`,
      time: u.createdAt,
    })),
    ...recentPayments.map((p) => ({
      type: "payment",
      msg: `Payment ₹${p.amount} received from ${p.userId?.name || "Unknown"}`,
      time: p.createdAt,
    })),
    ...recentPortfolios.map((r) => ({
      type: "publish",
      msg: `Portfolio published — ${r.handle || r.parsedData?.personalInfo?.name || "unnamed"}`,
      time: r.publishedAt,
    })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 15);

  res.json({ activity });
}
