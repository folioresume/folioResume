import { cloudinaryReady, uploadBufferToCloudinary } from "../utils/cloudinary.js";
import { sanitizeCloudinarySegment } from "../utils/helpers.js";
import { CLOUDINARY_PROJECT_NAME } from "../config/env.js";

const ALLOWED_CATEGORIES = new Set([
  "profile", "certificate", "project", "education", "experience", "resume",
]);

export async function uploadImage(req, res) {
  if (!cloudinaryReady()) return res.status(500).json({ error: "Cloudinary is not configured." });
  if (!req.file) return res.status(400).json({ error: "Please choose an image to upload." });

  const category = sanitizeCloudinarySegment(req.body.category, "resume");
  const projectName = sanitizeCloudinarySegment(
    req.body.projectName || CLOUDINARY_PROJECT_NAME,
    "resumeai",
  );

  if (!ALLOWED_CATEGORIES.has(category)) {
    return res.status(400).json({ error: "Unsupported image category." });
  }

  try {
    const folder = `${projectName}/${category}`;
    const result = await uploadBufferToCloudinary(req.file, folder);
    res.status(201).json({
      url: result.secure_url,
      publicId: result.public_id,
      folder,
      category,
      width: result.width,
      height: result.height,
      format: result.format,
    });
  } catch (error) {
    res.status(502).json({ error: error?.message || "Image upload failed." });
  }
}
