import rateLimit from "express-rate-limit";

const limitMessage = (msg) => ({ error: msg });

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Too many requests. Please try again later."),
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Too many auth attempts. Please try again later."),
});

export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Too many uploads. Please try again later."),
});

export const imageUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.IMAGE_UPLOAD_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Too many image uploads. Please try again later."),
});

export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.PAYMENT_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Too many payment attempts. Please try again later."),
});

export const couponValidateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Too many coupon attempts. Please slow down."),
});

export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Too many admin login attempts. Try again in 15 minutes."),
});
