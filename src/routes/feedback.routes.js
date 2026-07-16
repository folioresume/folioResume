import { Router } from "express";
import { optionalAuth } from "../middlewares/auth.js";
import { feedbackLimiter } from "../middlewares/rateLimiter.js";
import { submitFeedback } from "../controllers/feedback.controller.js";

const router = Router();

router.post("/", feedbackLimiter, optionalAuth, submitFeedback);

export default router;
