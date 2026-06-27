import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { paymentLimiter, couponValidateLimiter } from "../middlewares/rateLimiter.js";
import {
  createOrder, verifyPayment, handleWebhook, getPaymentHistory,
  getPricing, validateCouponForUser,
} from "../controllers/payment.controller.js";

const router = Router();

router.get("/pricing", requireAuth, getPricing);
router.post("/validate-coupon", couponValidateLimiter, requireAuth, validateCouponForUser);
router.post("/create-order", paymentLimiter, requireAuth, createOrder);
router.post("/verify", requireAuth, verifyPayment);
router.post("/webhook", handleWebhook);
router.get("/history", requireAuth, getPaymentHistory);

export default router;
