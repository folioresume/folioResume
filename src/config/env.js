import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { webcrypto } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

dotenv.config({ path: path.join(__dirname, "../../.env"), quiet: true });

export const PORT = process.env.PORT || 4000;
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
export const API_KEY = process.env.API_KEY || "";
export const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_env";
export const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/resume_parser";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
export const CLOUDINARY_PROJECT_NAME =
  process.env.CLOUDINARY_PROJECT_NAME || process.env.PROJECT_NAME || "resumeai";
export const PORTFOLIO_BASE_URL = process.env.PORTFOLIO_BASE_URL || "http://localhost:3001";
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
export const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
export const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
export const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
export const FREE_PARSE_LIMIT = Number(process.env.FREE_PARSE_LIMIT || 3);
export const PORTFOLIO_PRICE = Number(process.env.PORTFOLIO_PRICE || 99);
export const FOUNDING_PRICE = Number(process.env.FOUNDING_PRICE || 49);
export const FOUNDING_USER_LIMIT = Number(process.env.FOUNDING_USER_LIMIT || 100);
export const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
export const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "admin_secret_change_me";
export const SMTP_HOST = process.env.SMTP_HOST || "";
export const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
export const SMTP_SECURE = String(process.env.SMTP_SECURE || "false") === "true";
export const SMTP_USER = process.env.SMTP_USER || "";
export const SMTP_PASS = process.env.SMTP_PASS || "";
export const MAIL_FROM =
  process.env.MAIL_FROM || SMTP_USER || "FolioResume <no-reply@folioresume.com>";

export function normalizeOrigin(value = "") {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || CLIENT_ORIGIN)
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean),
);

export const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
