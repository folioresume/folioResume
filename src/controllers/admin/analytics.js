import User from "../../models/User.js";
import Resume from "../../models/Resume.js";
import PaymentLog from "../../models/PaymentLog.js";

function dateRange(period) {
  const now = new Date();
  if (period === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (period === "12m") return new Date(now.getFullYear() - 1, now.getMonth(), 1);
  // default 30d
  return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
}

function groupFormat(period) {
  if (period === "12m") {
    return {
      format: "%Y-%m",
      dateLabel: (d) => {
        const [y, m] = d.split("-");
        return new Date(y, m - 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
      },
    };
  }
  return {
    format: "%Y-%m-%d",
    dateLabel: (d) => {
      const date = new Date(d);
      return date.toLocaleString("en-IN", { month: "short", day: "numeric" });
    },
  };
}

export async function getRevenueChart(req, res) {
  const period = req.query.period || "30d";
  const since = dateRange(period);
  const { format, dateLabel } = groupFormat(period);

  const data = await PaymentLog.aggregate([
    { $match: { status: "paid", createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format, date: "$createdAt" } },
        revenue: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({
    data: data.map((d) => ({
      label: dateLabel(d._id),
      revenue: d.revenue,
      transactions: d.count,
    })),
  });
}

export async function getUserGrowthChart(req, res) {
  const since = dateRange("12m");

  const data = await User.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
        users: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json({
    data: data.map((d) => {
      const [y, m] = d._id.split("-");
      const label = new Date(y, m - 1).toLocaleString("en-IN", { month: "short", year: "2-digit" });
      return { label, users: d.users };
    }),
  });
}

export async function getConversionStats(req, res) {
  const [totalUsers, premiumUsers, totalResumes, publishedResumes, totalPayments, paidPayments] =
    await Promise.all([
      User.countDocuments(),
      User.countDocuments({ totalPublishedPortfolios: { $gt: 0 } }),
      Resume.countDocuments({ user: { $ne: null } }),
      Resume.countDocuments({ status: "active" }),
      PaymentLog.countDocuments(),
      PaymentLog.countDocuments({ status: "paid" }),
    ]);

  res.json({
    userConversionRate: totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 100) : 0,
    portfolioPublishRate: totalResumes > 0 ? Math.round((publishedResumes / totalResumes) * 100) : 0,
    paymentSuccessRate: totalPayments > 0 ? Math.round((paidPayments / totalPayments) * 100) : 0,
    premiumUsers,
    freeUsers: totalUsers - premiumUsers,
    publishedPortfolios: publishedResumes,
    draftPortfolios: totalResumes - publishedResumes,
  });
}

export async function getAiUsageStats(req, res) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [parsedToday, parsedMonth, parsedTotal, failedTotal, daily] = await Promise.all([
    Resume.countDocuments({ parseStatus: "completed", createdAt: { $gte: startOfDay } }),
    Resume.countDocuments({ parseStatus: "completed", createdAt: { $gte: startOfMonth } }),
    Resume.countDocuments({ parseStatus: "completed" }),
    Resume.countDocuments({ parseStatus: "failed" }),
    Resume.aggregate([
      { $match: { createdAt: { $gte: since30d } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          total: { $sum: 1 },
          failed: { $sum: { $cond: [{ $eq: ["$parseStatus", "failed"] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({
    parsedToday,
    parsedMonth,
    parsedTotal,
    failedTotal,
    successRate: parsedTotal + failedTotal > 0
      ? Math.round((parsedTotal / (parsedTotal + failedTotal)) * 100)
      : 100,
    daily: daily.map((d) => {
      const date = new Date(d._id);
      return {
        label: date.toLocaleString("en-IN", { month: "short", day: "numeric" }),
        total: d.total,
        failed: d.failed,
        success: d.total - d.failed,
      };
    }),
  });
}
