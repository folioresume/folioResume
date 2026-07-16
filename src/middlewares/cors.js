import cors from "cors";
import { ALLOWED_ORIGINS, ALLOWED_HOSTS, normalizeOrigin } from "../config/env.js";

export function allowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(normalizeOrigin(origin));
}

export function allowedHost(host = "") {
  if (ALLOWED_HOSTS.length === 0) return true;
  return ALLOWED_HOSTS.includes(host.split(":")[0].toLowerCase());
}

export const corsMiddleware = cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || allowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin is not allowed by CORS."));
  },
});

export function hostCheckMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (!allowedHost(req.headers.host)) {
    return res.status(403).json({ error: "Host is not allowed." });
  }
  if (origin && !allowedOrigin(origin)) {
    return res.status(403).json({ error: "Origin is not allowed." });
  }
  next();
}
