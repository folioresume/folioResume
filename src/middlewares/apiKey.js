import { API_KEY } from "../config/env.js";
import { safeCompare } from "../utils/helpers.js";

export function requireApiKey(req, res, next) {
  // Public/self-authenticating endpoints: portfolios are public, admin has its own
  // JWT, and the Razorpay webhook is a server-to-server call (no API key possible)
  // that authenticates itself via an HMAC signature over the raw body.
  if (
    req.path.startsWith("/portfolio/") ||
    req.path.startsWith("/admin/") ||
    req.path === "/payments/webhook"
  ) {
    return next();
  }
  if (!API_KEY) return next();

  if (!safeCompare(req.headers["x-api-key"], API_KEY)) {
    return res.status(401).json({ error: "Valid API key is required." });
  }
  next();
}
