import { Router } from "express";
import { authLimiter } from "../middlewares/rateLimiter.js";
import { requireAuth } from "../middlewares/auth.js";
import {
  register, registerVerifyOtp, login, forgotPassword,
  resetPassword, googleAuth, logout, getMe,
} from "../controllers/auth.controller.js";

const router = Router();

router.post("/register", authLimiter, register);
router.post("/register/verify-otp", authLimiter, registerVerifyOtp);
router.post("/login", authLimiter, login);
router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.post("/google", authLimiter, googleAuth);
router.post("/logout", logout);
router.get("/me", requireAuth, getMe);

export default router;
