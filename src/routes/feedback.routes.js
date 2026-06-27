import { Router } from "express";
import { optionalAuth } from "../middlewares/auth.js";
import { submitFeedback } from "../controllers/feedback.controller.js";

const router = Router();

router.post("/", optionalAuth, submitFeedback);

export default router;
