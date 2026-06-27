import { timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";

export function safeCompare(value, expected) {
  const a = Buffer.from(String(value || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, JWT_SECRET, { expiresIn: "7d" });
}

export function sanitizeCloudinarySegment(value, fallback) {
  const sanitized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return sanitized || fallback;
}

export function cleanGeminiJson(rawText) {
  return rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export function getUploadErrorMessage(error) {
  if (error?.status === 429 || String(error?.message || "").includes("RESOURCE_EXHAUSTED")) {
    return "AI quota exhausted. Try again later or contact support.";
  }
  if (error instanceof SyntaxError) {
    return "AI returned invalid JSON. Please retry the upload.";
  }
  return error.message || "Resume parsing failed.";
}
