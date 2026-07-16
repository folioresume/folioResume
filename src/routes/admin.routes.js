import { Router } from "express";
import { adminLogin, requireAdminAuth } from "../controllers/admin.controller.js";
import { adminLoginLimiter } from "../middlewares/rateLimiter.js";

import { getDashboardStats, getRecentActivity } from "../controllers/admin/dashboard.js";
import { listUsers, getUser, suspendUser, unsuspendUser, deleteUser, resetParseCount, extendSubscription, sendUserEmail, convertToPremium } from "../controllers/admin/users.js";
import { listPortfolios, unpublishPortfolio, republishPortfolio, extendPortfolioExpiry, deletePortfolio } from "../controllers/admin/portfolios.js";
import { listPayments, getPaymentStats, exportPaymentsCSV } from "../controllers/admin/payments.js";
import { getRevenueChart, getUserGrowthChart, getConversionStats, getAiUsageStats } from "../controllers/admin/analytics.js";
import { listFeedback, updateFeedbackStatus } from "../controllers/admin/feedback.js";
import { listCoupons, createCoupon, updateCoupon, deleteCoupon, getCouponStats } from "../controllers/admin/coupons.js";
import {
  getPricingSettings, updatePricingSettings,
  getGeneralSettings, updateGeneralSettings,
  getSeoSettings, updateSeoSettings,
  getCmsPage, updateCmsPage, getAllCmsPages,
  getNotificationSettings, updateNotificationSettings,
} from "../controllers/admin/settings.js";

const router = Router();
const auth = requireAdminAuth;

// ── Auth (public, rate-limited) ────────────────────────────────────────────
router.post("/auth/login", adminLoginLimiter, adminLogin);
router.get("/auth/me", auth, (req, res) => {
  res.json({ admin: { email: req.admin.email, role: "admin", name: "Super Admin" } });
});

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get("/dashboard/stats", auth, getDashboardStats);
router.get("/dashboard/activity", auth, getRecentActivity);

// ── Users ───────────────────────────────────────────────────────────────────
router.get("/users", auth, listUsers);
router.get("/users/:id", auth, getUser);
router.post("/users/:id/suspend", auth, suspendUser);
router.post("/users/:id/unsuspend", auth, unsuspendUser);
router.delete("/users/:id", auth, deleteUser);
router.post("/users/:id/reset-parse-count", auth, resetParseCount);
router.post("/users/:id/extend-subscription", auth, extendSubscription);
router.post("/users/:id/send-email", auth, sendUserEmail);
router.post("/users/:id/convert-premium", auth, convertToPremium);

// ── Portfolios ──────────────────────────────────────────────────────────────
router.get("/portfolios", auth, listPortfolios);
router.post("/portfolios/:id/unpublish", auth, unpublishPortfolio);
router.post("/portfolios/:id/republish", auth, republishPortfolio);
router.post("/portfolios/:id/extend-expiry", auth, extendPortfolioExpiry);
router.delete("/portfolios/:id", auth, deletePortfolio);

// ── Payments ────────────────────────────────────────────────────────────────
router.get("/payments", auth, listPayments);
router.get("/payments/stats", auth, getPaymentStats);
router.get("/payments/export", auth, exportPaymentsCSV);

// ── Analytics ───────────────────────────────────────────────────────────────
router.get("/analytics/revenue", auth, getRevenueChart);
router.get("/analytics/user-growth", auth, getUserGrowthChart);
router.get("/analytics/conversion", auth, getConversionStats);
router.get("/analytics/ai-usage", auth, getAiUsageStats);

// ── Feedback ────────────────────────────────────────────────────────────────
router.get("/feedback", auth, listFeedback);
router.patch("/feedback/:id/status", auth, updateFeedbackStatus);

// ── Coupons ─────────────────────────────────────────────────────────────────
router.get("/coupons/stats", auth, getCouponStats);
router.get("/coupons", auth, listCoupons);
router.post("/coupons", auth, createCoupon);
router.patch("/coupons/:id", auth, updateCoupon);
router.delete("/coupons/:id", auth, deleteCoupon);

// ── Pricing Settings ─────────────────────────────────────────────────────────
router.get("/pricing", auth, getPricingSettings);
router.put("/pricing", auth, updatePricingSettings);

// ── General Settings ─────────────────────────────────────────────────────────
router.get("/settings/general", auth, getGeneralSettings);
router.put("/settings/general", auth, updateGeneralSettings);

// ── SEO Settings ─────────────────────────────────────────────────────────────
router.get("/settings/seo", auth, getSeoSettings);
router.put("/settings/seo", auth, updateSeoSettings);

// ── CMS ──────────────────────────────────────────────────────────────────────
router.get("/cms", auth, getAllCmsPages);
router.get("/cms/:page", auth, getCmsPage);
router.put("/cms/:page", auth, updateCmsPage);

// ── Notifications ─────────────────────────────────────────────────────────────
router.get("/settings/notifications", auth, getNotificationSettings);
router.put("/settings/notifications", auth, updateNotificationSettings);

export default router;
