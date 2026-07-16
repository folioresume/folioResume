import { Router } from "express";
import { requireAuth } from "../middlewares/auth.js";
import { imageUploadLimiter } from "../middlewares/rateLimiter.js";
import { imageUpload } from "../middlewares/upload.js";
import { uploadImage } from "../controllers/upload.controller.js";

const router = Router();

router.post("/image", imageUploadLimiter, requireAuth, imageUpload.single("image"), uploadImage);

export default router;
