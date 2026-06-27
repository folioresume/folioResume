import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { uploadLimiter } from "../middlewares/rateLimiter.js";
import { upload } from "../middlewares/upload.js";
import {
  getResumes, getResume, parseResume, updateResume, deleteResume, updateHandle,
} from "../controllers/resume.controller.js";

const router = Router();

router.get("/", requireAuth, getResumes);
router.get("/:id", requireAuth, getResume);
router.post("/parse", uploadLimiter, requireAuth, upload.single("resume"), parseResume);
router.put("/:id/handle", requireAuth, updateHandle);
router.put("/:id", requireAuth, updateResume);
router.delete("/:id", requireAuth, deleteResume);

export default router;
