import { Router } from "express";
import authRoutes from "./auth.routes.js";
import profileRoutes from "./profile.routes.js";
import resumeRoutes from "./resume.routes.js";
import portfolioRoutes from "./portfolio.routes.js";
import paymentRoutes from "./payment.routes.js";
import feedbackRoutes from "./feedback.routes.js";
import uploadRoutes from "./upload.routes.js";
import adminRoutes from "./admin.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/profile", profileRoutes);
router.use("/resumes", resumeRoutes);
router.use("/portfolio", portfolioRoutes);
router.use("/payments", paymentRoutes);
router.use("/feedback", feedbackRoutes);
router.use("/uploads", uploadRoutes);
router.use("/admin", adminRoutes);

export default router;
