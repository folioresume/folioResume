import { createHmac } from "node:crypto";
import Resume from "../models/Resume.js";
import User from "../models/User.js";
import PaymentLog from "../models/PaymentLog.js";
import Coupon from "../models/Coupon.js";
import razorpay from "../config/razorpay.js";
import { publicResume } from "../utils/formatters.js";
import { looksLikeObjectId } from "../utils/handle.js";
import { safeCompare } from "../utils/helpers.js";
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } from "../config/env.js";
import { getPricingConfig } from "../services/settings.service.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcDiscount(coupon, amount) {
  if (!coupon) return 0;
  if (coupon.discountType === "percent") {
    return Math.round((coupon.discountValue / 100) * amount);
  }
  return Math.min(coupon.discountValue, amount - 1); // at least ₹1 payable
}

async function validateCouponDoc(code, amount) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase().slice(0, 32);
  const coupon = await Coupon.findOne({ code: normalized }).lean();
  if (!coupon || !coupon.active) return null;
  if (coupon.expiresAt && coupon.expiresAt < new Date()) return null;
  if (coupon.maxUsage > 0 && coupon.usedCount >= coupon.maxUsage) return null;
  if (amount < coupon.minAmount) return null;
  return coupon;
}

// ── Get pricing (no order created) ──────────────────────────────────────────

export async function getPricing(req, res) {
  const { resumeId } = req.query;
  if (!resumeId || !looksLikeObjectId(resumeId)) {
    return res.status(400).json({ error: "Valid resumeId is required." });
  }

  const resume = await Resume.findOne({ _id: resumeId, user: req.user._id }).lean();
  if (!resume) return res.status(404).json({ error: "Resume not found." });
  if (resume.status === "active") return res.status(400).json({ error: "Portfolio is already published." });

  const pricing = await getPricingConfig();
  const activeCount = await Resume.countDocuments({ status: "active" });
  const isFoundingOffer = activeCount < pricing.foundingUserLimit;
  const basePrice = isFoundingOffer ? pricing.foundingPrice : pricing.portfolioPrice;

  res.json({
    isFoundingOffer,
    regularPrice: pricing.portfolioPrice,
    foundingPrice: pricing.foundingPrice,
    foundingUserLimit: pricing.foundingUserLimit,
    slotsRemaining: Math.max(0, pricing.foundingUserLimit - activeCount),
    basePrice,
    pricingEnabled: pricing.pricingEnabled,
  });
}

// ── Validate coupon (client-facing, auth required) ───────────────────────────

export async function validateCouponForUser(req, res) {
  const { code, resumeId } = req.body || {};
  if (!code?.trim()) return res.status(400).json({ error: "Coupon code is required." });
  if (!resumeId || !looksLikeObjectId(resumeId)) {
    return res.status(400).json({ error: "Valid resumeId is required." });
  }

  const resume = await Resume.findOne({ _id: resumeId, user: req.user._id }).lean();
  if (!resume) return res.status(404).json({ error: "Resume not found." });

  const pricing = await getPricingConfig();
  const activeCount = await Resume.countDocuments({ status: "active" });
  const isFoundingOffer = activeCount < pricing.foundingUserLimit;
  const basePrice = isFoundingOffer ? pricing.foundingPrice : pricing.portfolioPrice;

  const coupon = await validateCouponDoc(code, basePrice);
  if (!coupon) {
    return res.status(400).json({ valid: false, error: "Invalid, expired, or inapplicable coupon." });
  }

  const discount = calcDiscount(coupon, basePrice);
  const finalAmount = Math.max(1, basePrice - discount);

  res.json({
    valid: true,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    discount,
    originalAmount: basePrice,
    finalAmount,
    description: coupon.description,
  });
}

// ── Create Razorpay order ────────────────────────────────────────────────────

export async function createOrder(req, res) {
  if (!razorpay) return res.status(503).json({ error: "Payment service is not configured." });

  const { resumeId, couponCode } = req.body;
  if (!resumeId || !looksLikeObjectId(resumeId)) {
    return res.status(400).json({ error: "Valid resume id is required." });
  }

  const resume = await Resume.findOne({ _id: resumeId, user: req.user._id });
  if (!resume) return res.status(404).json({ error: "Resume not found." });
  if (resume.status === "active") return res.status(400).json({ error: "Portfolio is already published." });

  const pricing = await getPricingConfig();
  const activeCount = await Resume.countDocuments({ status: "active" });
  const isFoundingOffer = activeCount < pricing.foundingUserLimit;
  const basePrice = isFoundingOffer ? pricing.foundingPrice : pricing.portfolioPrice;

  // Apply coupon if provided
  const coupon = couponCode ? await validateCouponDoc(couponCode, basePrice) : null;
  const discount = coupon ? calcDiscount(coupon, basePrice) : 0;
  const finalAmount = Math.max(1, basePrice - discount);

  const receipt = `rcp_${resumeId.slice(-8)}_${Date.now()}`;
  const razorpayOrder = await razorpay.orders.create({
    amount: finalAmount * 100,
    currency: "INR",
    receipt,
    notes: { resumeId, userId: req.user._id.toString() },
  });

  await PaymentLog.findOneAndUpdate(
    { razorpayOrderId: razorpayOrder.id },
    {
      userId: req.user._id,
      portfolioId: resume._id,
      razorpayOrderId: razorpayOrder.id,
      amount: finalAmount,
      originalAmount: basePrice,
      discountAmount: discount,
      couponId: coupon?._id || null,
      couponCode: coupon?.code || null,
      status: "created",
    },
    { upsert: true, new: true },
  );

  resume.orderId = razorpayOrder.id;
  await resume.save();

  res.json({
    orderId: razorpayOrder.id,
    amount: finalAmount,
    originalAmount: basePrice,
    discount,
    currency: "INR",
    razorpayKeyId: RAZORPAY_KEY_ID,
    isFoundingOffer,
    foundingPrice: pricing.foundingPrice,
    regularPrice: pricing.portfolioPrice,
    couponApplied: !!coupon,
    couponCode: coupon?.code || null,
  });
}

// ── Verify payment ───────────────────────────────────────────────────────────

export async function verifyPayment(req, res) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, resumeId } = req.body;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !resumeId) {
    return res.status(400).json({ error: "Missing required payment verification fields." });
  }
  if (!RAZORPAY_KEY_SECRET) return res.status(503).json({ error: "Payment service is not configured." });

  const expectedSignature = createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (!safeCompare(razorpaySignature, expectedSignature)) {
    return res.status(400).json({ error: "Payment signature verification failed." });
  }

  // Bind the Razorpay order to the payment log created at order time, and confirm
  // it belongs to this user and was created for this exact resume. Without this,
  // a valid signature could be replayed against a different resume the user owns.
  const log = await PaymentLog.findOne({ razorpayOrderId });
  if (!log) return res.status(400).json({ error: "Unknown payment order." });
  if (log.userId.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: "This payment does not belong to you." });
  }
  if (log.status === "paid") return res.status(409).json({ error: "Payment already processed." });
  if (log.portfolioId.toString() !== String(resumeId)) {
    return res.status(400).json({ error: "Payment order does not match this resume." });
  }

  const resume = await Resume.findOne({ _id: resumeId, user: req.user._id });
  if (!resume) return res.status(404).json({ error: "Resume not found." });

  const publishedAt = new Date();
  const expiresAt = new Date(publishedAt.getTime() + 365 * 24 * 60 * 60 * 1000);

  resume.status = "active";
  resume.paymentStatus = "paid";
  resume.paymentId = razorpayPaymentId;
  resume.publishedAt = publishedAt;
  resume.expiresAt = expiresAt;
  await resume.save();

  // Atomically flip only if still unpaid so a duplicate verify + webhook can't
  // both count the same payment twice.
  const paidLog = await PaymentLog.findOneAndUpdate(
    { _id: log._id, status: { $ne: "paid" } },
    { razorpayPaymentId, status: "paid" },
    { new: true },
  );

  if (paidLog) {
    await User.updateOne({ _id: req.user._id }, { $inc: { totalPublishedPortfolios: 1 } });

    // Atomically increment coupon usage (prevents race conditions)
    if (paidLog.couponId) {
      await Coupon.findOneAndUpdate(
        { _id: paidLog.couponId, $or: [{ maxUsage: 0 }, { $expr: { $lt: ["$usedCount", "$maxUsage"] } }] },
        { $inc: { usedCount: 1 } },
      );
    }
  }

  res.json({
    success: true,
    portfolioUrl: publicResume(resume).portfolioUrl,
    expiresAt: expiresAt.toISOString(),
    publishedAt: publishedAt.toISOString(),
  });
}

// ── Webhook ──────────────────────────────────────────────────────────────────

export async function handleWebhook(req, res) {
  if (!RAZORPAY_WEBHOOK_SECRET) return res.status(200).json({ ok: true });
  if (!req.rawBody) return res.status(400).json({ error: "Raw body not available." });

  const signature = req.headers["x-razorpay-signature"];
  const expectedSig = createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  if (!safeCompare(signature || "", expectedSig)) {
    return res.status(400).json({ error: "Invalid webhook signature." });
  }

  let event;
  try { event = JSON.parse(req.rawBody.toString()); }
  catch { return res.status(400).json({ error: "Invalid webhook payload." }); }

  if (event.event === "payment.captured") {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) {
      const log = await PaymentLog.findOne({ razorpayOrderId: payment.order_id });
      if (log && log.status !== "paid") {
        log.razorpayPaymentId = payment.id;
        log.status = "paid";
        await log.save();

        const portfolioResume = await Resume.findById(log.portfolioId);
        if (portfolioResume && portfolioResume.status !== "active") {
          const publishedAt = new Date();
          portfolioResume.status = "active";
          portfolioResume.paymentStatus = "paid";
          portfolioResume.paymentId = payment.id;
          portfolioResume.publishedAt = publishedAt;
          portfolioResume.expiresAt = new Date(publishedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
          await portfolioResume.save();
          await User.updateOne({ _id: log.userId }, { $inc: { totalPublishedPortfolios: 1 } });

          if (log.couponId) {
            await Coupon.findOneAndUpdate(
              { _id: log.couponId, $or: [{ maxUsage: 0 }, { $expr: { $lt: ["$usedCount", "$maxUsage"] } }] },
              { $inc: { usedCount: 1 } },
            );
          }
        }
      }
    }
  } else if (event.event === "payment.failed") {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) {
      await PaymentLog.findOneAndUpdate(
        { razorpayOrderId: payment.order_id },
        { razorpayPaymentId: payment.id, status: "failed" },
      );
      const log = await PaymentLog.findOne({ razorpayOrderId: payment.order_id });
      if (log) await Resume.findByIdAndUpdate(log.portfolioId, { paymentStatus: "failed" });
    }
  }

  res.json({ ok: true });
}

// ── Payment history ──────────────────────────────────────────────────────────

export async function getPaymentHistory(req, res) {
  const payments = await PaymentLog.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .populate("portfolioId", "originalFileName handle parsedData")
    .lean();

  res.json({
    payments: payments.map((p) => ({
      id: p._id.toString(),
      portfolioId: p.portfolioId?._id?.toString() || null,
      portfolioName: p.portfolioId?.parsedData?.personalInfo?.name || p.portfolioId?.originalFileName || "Unknown",
      portfolioHandle: p.portfolioId?.handle || null,
      razorpayOrderId: p.razorpayOrderId,
      razorpayPaymentId: p.razorpayPaymentId || null,
      amount: p.amount,
      originalAmount: p.originalAmount || p.amount,
      discountAmount: p.discountAmount || 0,
      couponCode: p.couponCode || null,
      status: p.status,
      createdAt: p.createdAt,
    })),
  });
}
