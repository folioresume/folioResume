import PaymentLog from "../../models/PaymentLog.js";

export async function listPayments(req, res) {
  const { status = "all", page = 1, limit = 20, startDate, endDate } = req.query;
  const parsedLimit = Math.min(Number(limit) || 20, 100);
  const skip = (Math.max(Number(page), 1) - 1) * parsedLimit;

  const query = {};
  if (status !== "all") query.status = status;

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  const [payments, total] = await Promise.all([
    PaymentLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .populate("userId", "name email")
      .populate("portfolioId", "handle originalFileName parsedData")
      .lean(),
    PaymentLog.countDocuments(query),
  ]);

  res.json({
    payments: payments.map((p) => ({
      _id: p._id,
      orderId: p.razorpayOrderId,
      paymentId: p.razorpayPaymentId,
      amount: p.amount,
      status: p.status,
      user: p.userId ? { _id: p.userId._id, name: p.userId.name, email: p.userId.email } : null,
      portfolio: p.portfolioId
        ? {
            _id: p.portfolioId._id,
            handle: p.portfolioId.handle,
            name: p.portfolioId.parsedData?.personalInfo?.name || p.portfolioId.originalFileName,
          }
        : null,
      createdAt: p.createdAt,
    })),
    pagination: {
      page: Number(page),
      limit: parsedLimit,
      total,
      pages: Math.ceil(total / parsedLimit),
    },
  });
}

export async function getPaymentStats(req, res) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [all, today, month, countByStatus] = await Promise.all([
    PaymentLog.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    PaymentLog.aggregate([
      { $match: { status: "paid", createdAt: { $gte: startOfDay } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    PaymentLog.aggregate([
      { $match: { status: "paid", createdAt: { $gte: startOfMonth } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    PaymentLog.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const byStatus = Object.fromEntries(countByStatus.map((s) => [s._id, s.count]));

  res.json({
    revenueTotal: all[0]?.total || 0,
    revenueToday: today[0]?.total || 0,
    revenueMonth: month[0]?.total || 0,
    transactionsTotal: all[0]?.count || 0,
    transactionsToday: today[0]?.count || 0,
    transactionsMonth: month[0]?.count || 0,
    byStatus: {
      paid: byStatus.paid || 0,
      created: byStatus.created || 0,
      failed: byStatus.failed || 0,
    },
  });
}

export async function exportPaymentsCSV(req, res) {
  const { status = "all", startDate, endDate } = req.query;

  const query = {};
  if (status !== "all") query.status = status;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt.$lte = end;
    }
  }

  const payments = await PaymentLog.find(query)
    .sort({ createdAt: -1 })
    .limit(5000)
    .populate("userId", "name email")
    .populate("portfolioId", "handle")
    .lean();

  const rows = [
    ["Date", "Order ID", "Payment ID", "Amount (INR)", "Status", "User Name", "User Email", "Portfolio Handle"],
    ...payments.map((p) => [
      new Date(p.createdAt).toISOString().split("T")[0],
      p.razorpayOrderId,
      p.razorpayPaymentId || "",
      p.amount,
      p.status,
      p.userId?.name || "",
      p.userId?.email || "",
      p.portfolioId?.handle || "",
    ]),
  ];

  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="payments-${Date.now()}.csv"`);
  res.send(csv);
}
