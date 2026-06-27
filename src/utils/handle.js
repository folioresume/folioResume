import Resume from "../models/Resume.js";
import { RESERVED_HANDLES, HANDLE_PATTERN } from "../constants/index.js";

export function normalizeHandle(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidHandle(handle) {
  return HANDLE_PATTERN.test(handle) && !RESERVED_HANDLES.has(handle);
}

// Mongoose's ObjectId.isValid() accepts any 12-char string — use a strict
// 24-hex check to avoid mistaking a custom handle for an ObjectId.
export function looksLikeObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || ""));
}

export function portfolioFilter(idOrHandle) {
  const base = { parseStatus: "completed", parsedData: { $ne: null } };
  if (looksLikeObjectId(idOrHandle)) return { ...base, _id: idOrHandle };
  return { ...base, handle: normalizeHandle(idOrHandle) };
}

// Generate a random alphanumeric suffix of given length.
function randomSuffix(len = 4) {
  return Math.random().toString(36).slice(2, 2 + len).padEnd(len, "0");
}

// Convert a person's name to a URL-safe slug base.
function nameToSlug(name = "") {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")   // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, "")       // trim leading/trailing hyphens
    .slice(0, 18)                   // cap so suffix fits in 30-char limit
    .replace(/-+$/g, "");           // trim again after slice
}

/**
 * Auto-generate a unique portfolio handle at parse time.
 * Uses the person's first name + random suffix.
 * Retries up to `maxAttempts` times if handle is already taken.
 */
export async function generateUniqueHandle(parsedName = "", maxAttempts = 8) {
  const firstName = (parsedName || "").trim().split(/\s+/)[0] || "";
  const base = nameToSlug(firstName) || "user";

  for (let i = 0; i < maxAttempts; i++) {
    const suffix = randomSuffix(4);
    const candidate = `${base}-${suffix}`;  // e.g. "chandan-a3f7"

    if (!isValidHandle(candidate)) continue;

    const exists = await Resume.findOne({ handle: candidate }).select("_id").lean();
    if (!exists) return candidate;
  }

  // Ultimate fallback: pure random 8-char handle
  for (let i = 0; i < 5; i++) {
    const candidate = `u-${randomSuffix(6)}`;
    const exists = await Resume.findOne({ handle: candidate }).select("_id").lean();
    if (!exists) return candidate;
  }

  return null; // extremely unlikely — skip handle if all retries fail
}
