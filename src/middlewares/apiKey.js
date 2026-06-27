import { API_KEY } from "../config/env.js";
import { safeCompare } from "../utils/helpers.js";

export function requireApiKey(req, res, next) {
  if (req.path.startsWith("/portfolio/") || req.path.startsWith("/admin/")) {
    return next();
  }
  if (!API_KEY) return next();

  if (!safeCompare(req.headers["x-api-key"], API_KEY)) {
    return res.status(401).json({ error: "Valid API key is required." });
  }
  next();
}
