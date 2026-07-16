import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { issuePreviewToken, getPortfolio, visitPortfolio } from "../controllers/portfolio.controller.js";

const router = Router();

router.post("/:resumeId/preview-token", requireAuth, issuePreviewToken);
router.get("/:resumeId", getPortfolio);
router.post("/:resumeId/visit", visitPortfolio);

export default router;
