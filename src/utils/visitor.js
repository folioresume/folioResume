import { createHash } from "node:crypto";
import { JWT_SECRET } from "../config/env.js";

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}

function decodeHeaderValue(value) {
  try {
    return decodeURIComponent(firstHeaderValue(value));
  } catch {
    return firstHeaderValue(value);
  }
}

export function requestIp(req) {
  const forwardedFor = firstHeaderValue(req.headers["x-forwarded-for"]);
  const ip =
    forwardedFor.split(",")[0]?.trim() ||
    firstHeaderValue(req.headers["cf-connecting-ip"]) ||
    firstHeaderValue(req.headers["x-real-ip"]) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown";
  return ip.replace(/^::ffff:/, "");
}

export function visitorInfoFromRequest(req) {
  const ip = requestIp(req);
  return {
    city:
      decodeHeaderValue(req.headers["x-vercel-ip-city"]) ||
      decodeHeaderValue(req.headers["cf-ipcity"]) ||
      decodeHeaderValue(req.headers["x-app-city"]),
    region:
      decodeHeaderValue(req.headers["x-vercel-ip-country-region"]) ||
      decodeHeaderValue(req.headers["cf-region"]) ||
      decodeHeaderValue(req.headers["x-app-region"]),
    country:
      decodeHeaderValue(req.headers["x-vercel-ip-country"]) ||
      decodeHeaderValue(req.headers["cf-ipcountry"]) ||
      decodeHeaderValue(req.headers["x-app-country"]),
    timezone:
      decodeHeaderValue(req.headers["x-vercel-ip-timezone"]) ||
      decodeHeaderValue(req.headers["cf-timezone"]) ||
      decodeHeaderValue(req.headers["x-app-timezone"]),
    ipHash: createHash("sha256").update(`${JWT_SECRET}:${ip}`).digest("hex"),
    userAgent: firstHeaderValue(req.headers["user-agent"]).slice(0, 240),
    referrer: firstHeaderValue(req.headers.referer || req.headers.referrer).slice(0, 300),
    visitedAt: new Date(),
  };
}
