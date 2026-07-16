import Coupon from "../../models/Coupon.js";
import PaymentLog from "../../models/PaymentLog.js";
import { looksLikeObjectId } from "../../utils/handle.js";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listCoupons(req, res) {
  const { search = "", active, page = 1, limit = 50 } = req.query;
  const parsedLimit = Math.min(Number(limit) || 50, 200);
  const skip = (Math.max(Number(page), 1) - 1) * parsedLimit;

  const query = {};
  if (search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim().toUpperCase()), "i");
    query.$or = [{ code: rx }, { description: new RegExp(escapeRegex(search.trim()), "i") }];
  }
  if (active === "true") query.active = true;
  if (active === "false") query.active = false;

  const [coupons, total] = await Promise.all([
    Coupon.find(query).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
    Coupon.countDocuments(query),
  ]);

  res.json({ coupons, pagination: { page: Number(page), limit: parsedLimit, total, pages: Math.ceil(total / parsedLimit) } });
}

export async function createCoupon(req, res) {
  const { code, discountType, discountValue, maxUsage, expiresAt, active, description, minAmount } = req.body || {};

  if (!code?.trim()) return res.status(400).json({ error: "Coupon code is required." });
  if (!discountValue || Number(discountValue) < 1) return res.status(400).json({ error: "discountValue must be >= 1." });
  if (discountType === "percent" && Number(discountValue) > 100) return res.status(400).json({ error: "Percent discount cannot exceed 100." });

  const normalizedCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!normalizedCode) return res.status(400).json({ error: "Invalid coupon code characters." });

  const exists = await Coupon.findOne({ code: normalizedCode }).lean();
  if (exists) return res.status(409).json({ error: "Coupon code already exists." });

  const coupon = await Coupon.create({
    code: normalizedCode,
    discountType: discountType || "fixed",
    discountValue: Number(discountValue),
    maxUsage: Number(maxUsage) || 0,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    active: active !== false,
    description: String(description || "").trim().slice(0, 200),
    minAmount: Number(minAmount) || 0,
  });

  res.status(201).json({ coupon });
}

export async function updateCoupon(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid coupon id." });

  const { discountType, discountValue, maxUsage, expiresAt, active, description, minAmount } = req.body || {};
  const update = {};

  if (discountType !== undefined) update.discountType = discountType;
  if (discountValue !== undefined) {
    if (Number(discountValue) < 1) return res.status(400).json({ error: "discountValue must be >= 1." });
    update.discountValue = Number(discountValue);
  }
  if (maxUsage !== undefined) update.maxUsage = Number(maxUsage) || 0;
  if (expiresAt !== undefined) update.expiresAt = expiresAt ? new Date(expiresAt) : null;
  if (active !== undefined) update.active = Boolean(active);
  if (description !== undefined) update.description = String(description).trim().slice(0, 200);
  if (minAmount !== undefined) update.minAmount = Number(minAmount) || 0;

  const coupon = await Coupon.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
  if (!coupon) return res.status(404).json({ error: "Coupon not found." });

  res.json({ coupon });
}

export async function deleteCoupon(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid coupon id." });

  const coupon = await Coupon.findByIdAndDelete(id).lean();
  if (!coupon) return res.status(404).json({ error: "Coupon not found." });

  res.json({ ok: true });
}

export async function getCouponStats(req, res) {
  const [totalCoupons, activeCoupons, totalUsage, revenueData] = await Promise.all([
    Coupon.countDocuments(),
    Coupon.countDocuments({ active: true }),
    Coupon.aggregate([{ $group: { _id: null, total: { $sum: "$usedCount" } } }]),
    PaymentLog.aggregate([
      { $match: { status: "paid", couponId: { $ne: null } } },
      { $group: { _id: null, totalDiscount: { $sum: "$discountAmount" }, count: { $sum: 1 } } },
    ]),
  ]);

  res.json({
    totalCoupons,
    activeCoupons,
    totalUsage: totalUsage[0]?.total || 0,
    totalDiscount: revenueData[0]?.totalDiscount || 0,
    couponPayments: revenueData[0]?.count || 0,
  });
}
