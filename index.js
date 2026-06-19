import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import { v2 as cloudinary } from "cloudinary";
import { createHash, timingSafeEqual, webcrypto } from "node:crypto";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import { OAuth2Client } from "google-auth-library";
import apiLogger from "./utils/logger.js";



if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";

function normalizeOrigin(value = "") {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  try {
    return new URL(trimmedValue).origin;
  } catch {
    return trimmedValue.replace(/\/+$/, "");
  }
}

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || CLIENT_ORIGIN)
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean)
);
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const API_KEY = process.env.API_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_env";
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/resume_parser";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const CLOUDINARY_PROJECT_NAME =
  process.env.CLOUDINARY_PROJECT_NAME || process.env.PROJECT_NAME || "resumeai";
const PORTFOLIO_BASE_URL = process.env.PORTFOLIO_BASE_URL || "http://localhost:3001";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false") === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || "FolioResume <no-reply@folioresume.com>";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const EXTRACTION_PROMPT = `
You are a resume parser. Return ONLY valid JSON. No markdown, no explanation.

Extract resume data using this schema:
{
  "personalInfo": {
    "name": null,
    "title": null,
    "email": null,
    "phone": [],
    "location": null,
    "github": null,
    "linkedin": null,
    "portfolio": null,
    "imgUrl": null
  },
  "summary": null,
  "skills": [
    {
      "skill_category_name": null,
      "skills_belongs_this_category": []
    }
  ],
  "experience": [
    {
      "company": null,
      "role": null,
      "type": null,
      "location": null,
      "startDate": null,
      "endDate": null,
      "current": false,
      "responsibilities": [],
      "imgUrl": null
    }
  ],
  "education": [
    {
      "degree": null,
      "institution": null,
      "startYear": null,
      "endYear": null,
      "score": null,
      "location": null,
      "imgUrl": null
    }
  ],
  "projects": [
    {
      "name": null,
      "technologies": [],
      "features": [],
      "liveUrl": null,
      "githubUrl": null,
      "imgUrl": null
    }
  ],
  "certificates": [
    {
      "name": null,
      "issuer": null,
      "link": null,
      "issueDate": null,
      "expiryDate": null,
      "credentialId": null,
      "imgUrl": null
    }
  ]
}

Rules:
- Return valid JSON only.
- Missing string/number => null, missing array => [].
- Group skills dynamically from resume content; avoid fixed categories unless clearly implied.
- Do not duplicate skills across categories.
- current=true only if endDate is Present/Current/Ongoing.
- Extract all experience, projects, education, and certifications.
- Extract all available contact info; use null if missing.
- Infer name from email/linkedin if absent; otherwise null.
- Extract summary/objective if present; else null.
- Dates: use YYYY-MM or YYYY. If only year exists, use YYYY-01.
- imgUrl: try relevant logo/image from company/institute/linkedin context; else null.
- Always follow the schema exactly.
`;

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are supported."));
    }

    cb(null, true);
  },
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are supported."));
    }

    cb(null, true);
  },
});

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: false },
    googleId: { type: String, default: null },
    profile: {
      title: { type: String, default: "" },
      phone: { type: String, default: "" },
      company: { type: String, default: "" },
      location: { type: String, default: "" },
      linkedin: { type: String, default: "" },
      imageUrl: { type: String, default: "" },
      summary: { type: String, default: "" },
      competencies: { type: [String], default: [] },
    },
  },
  { timestamps: true }
);

const resumeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    originalFileName: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: "application/pdf" },
    parseStatus: {
      type: String,
      enum: ["completed", "failed"],
      default: "completed",
    },
    parseError: { type: String, default: null },
    parsedData: { type: mongoose.Schema.Types.Mixed, default: null },
    portfolioTotalCount: { type: Number, default: 0 },
    portfolioUniqueCount: { type: Number, default: 0 },
    portfolioVisitorKeys: { type: [String], default: [] },
    portfolioLastVisit: {
      city: { type: String, default: "" },
      region: { type: String, default: "" },
      country: { type: String, default: "" },
      timezone: { type: String, default: "" },
      ipHash: { type: String, default: "" },
      userAgent: { type: String, default: "" },
      referrer: { type: String, default: "" },
      visitedAt: { type: Date, default: null },
    },
    portfolioVisits: {
      type: [
        {
          city: { type: String, default: "" },
          region: { type: String, default: "" },
          country: { type: String, default: "" },
          timezone: { type: String, default: "" },
          ipHash: { type: String, default: "" },
          userAgent: { type: String, default: "" },
          referrer: { type: String, default: "" },
          visitedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
);

const feedbackSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    type: {
      type: String,
      enum: ["feedback", "issue", "suggestion", "bug"],
      default: "feedback",
    },
    subject: { type: String, required: true, trim: true, maxlength: 140 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },
    pageUrl: { type: String, default: "", trim: true, maxlength: 1000 },
    browser: { type: String, default: "", trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ["new", "reviewing", "resolved", "closed"],
      default: "new",
    },
    source: { type: String, default: "web", trim: true },
  },
  { timestamps: true }
);

const otpChallengeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    purpose: {
      type: String,
      enum: ["registration", "password_reset"],
      required: true,
    },
    otpHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Resume = mongoose.model("Resume", resumeSchema);
const Feedback = mongoose.model("Feedback", feedbackSchema);
const OtpChallenge = mongoose.model("OtpChallenge", otpChallengeSchema);

const app = express();

if (process.env.NODE_ENV === "production" && JWT_SECRET === "change_this_secret_in_env") {
  throw new Error("JWT_SECRET must be configured in production.");
}

function allowedOrigin(origin) {
  return ALLOWED_ORIGINS.has(normalizeOrigin(origin));
}

function allowedHost(host = "") {
  if (ALLOWED_HOSTS.length === 0) {
    return true;
  }

  const hostname = host.split(":")[0].toLowerCase();
  return ALLOWED_HOSTS.includes(hostname);
}

function safeCompare(value, expected) {
  const valueBuffer = Buffer.from(String(value || ""));
  const expectedBuffer = Buffer.from(String(expected || ""));

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}

app.use(apiLogger);
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin is not allowed by CORS."));
    },
  })
);
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (!allowedHost(req.headers.host)) {
    return res.status(403).json({ error: "Host is not allowed." });
  }

  if (origin && !allowedOrigin(origin)) {
    return res.status(403).json({ error: "Origin is not allowed." });
  }

  next();
});
app.use(express.json({ limit: "2mb" }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts. Please try again later." },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.UPLOAD_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads. Please try again later." },
});

const imageUploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.IMAGE_UPLOAD_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many image uploads. Please try again later." },
});

let mailTransporter = null;

function configuredMailTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("Email service is not configured.");
  }

  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }

  return mailTransporter;
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOtp(otp) {
  return createHash("sha256")
    .update(String(otp))
    .digest("hex");
}

async function sendOtpEmail({ email, name, otp, purpose }) {
  const isPasswordReset = purpose === "password_reset";
  const subject = isPasswordReset
    ? "Reset your FolioResume password"
    : "Verify your FolioResume account";
  const intro = isPasswordReset
    ? "Use this OTP to reset your FolioResume password."
    : "Use this OTP to verify your email and finish creating your FolioResume account.";

  await configuredMailTransporter().sendMail({
    from: MAIL_FROM,
    to: email,
    subject,
    text: `${intro}\n\nYour OTP is ${otp}.\n\nThis code expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#111827">
        <h2 style="margin:0 0 12px;color:#3525cd">FolioResume</h2>
        <p>Hi ${name || "there"},</p>
        <p>${intro}</p>
        <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:#f3f4f6;text-align:center">
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#111827">${otp}</div>
        </div>
        <p style="font-size:14px;color:#4b5563">This code expires in ${OTP_TTL_MINUTES} minutes.</p>
        <p style="font-size:14px;color:#4b5563">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}

async function createOtpChallenge({ user, email, purpose }) {
  const otp = generateOtp();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  await OtpChallenge.updateMany(
    {
      email: normalizedEmail,
      purpose,
      consumedAt: null,
    },
    { $set: { consumedAt: new Date() } },
  );

  const challenge = await OtpChallenge.create({
    user: user?._id || null,
    email: normalizedEmail,
    purpose,
    otpHash: hashOtp(otp),
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
  });

  await sendOtpEmail({
    email: normalizedEmail,
    name: user?.name || "",
    otp,
    purpose,
  });

  return challenge;
}

async function verifyOtpChallenge({ challengeId, email, otp, purpose }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const challenge = await OtpChallenge.findOne({
    _id: challengeId,
    email: normalizedEmail,
    purpose,
    consumedAt: null,
  });

  if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
    throw new Error("Invalid or expired OTP.");
  }

  if (challenge.attempts >= 5) {
    throw new Error("Too many OTP attempts. Please request a new code.");
  }

  const validOtp = safeCompare(hashOtp(otp), challenge.otpHash);
  if (!validOtp) {
    challenge.attempts += 1;
    await challenge.save();
    throw new Error("Invalid OTP.");
  }

  challenge.consumedAt = new Date();
  await challenge.save();

  return challenge;
}

function requireApiKey(req, res, next) {
  if (req.path.startsWith("/portfolio/")) {
    next();
    return;
  }

  if (!API_KEY) {
    next();
    return;
  }

  const providedKey = req.headers["x-api-key"];

  if (!safeCompare(providedKey, API_KEY)) {
    return res.status(401).json({ error: "Valid API key is required." });
  }

  next();
}

app.use("/api", generalLimiter, requireApiKey);

function cleanGeminiJson(rawText) {
  return rawText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    profile: user.profile,
    createdAt: user.createdAt,
  };
}

function publicVisit(visit = {}) {
  return {
    city: visit.city || "",
    region: visit.region || "",
    country: visit.country || "",
    timezone: visit.timezone || "",
    userAgent: visit.userAgent || "",
    referrer: visit.referrer || "",
    visitedAt: visit.visitedAt || null,
  };
}

function publicResume(resume) {
  const id = resume._id.toString();
  const portfolioUrl = new URL(PORTFOLIO_BASE_URL);
  portfolioUrl.searchParams.set("resumeId", id);

  return {
    id,
    user: resume.user?.toString?.() || null,
    originalFileName: resume.originalFileName,
    fileSize: resume.fileSize,
    mimeType: resume.mimeType,
    parseStatus: resume.parseStatus,
    parseError: resume.parseError,
    parsedData: resume.parsedData,
    portfolioTotalCount: resume.portfolioTotalCount || 0,
    portfolioUniqueCount: resume.portfolioUniqueCount || 0,
    portfolioUrl: portfolioUrl.toString(),
    portfolioLastVisit: resume.portfolioLastVisit
      ? publicVisit(resume.portfolioLastVisit)
      : null,
    portfolioVisits: Array.isArray(resume.portfolioVisits)
      ? resume.portfolioVisits.map(publicVisit).reverse()
      : [],
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
  };
}

function publicPortfolioData(user, resume) {
  const parsedData = resume?.parsedData && typeof resume.parsedData === "object"
    ? resume.parsedData
    : {};
  const personalInfo = {
    ...(parsedData.personalInfo || {}),
    name: parsedData.personalInfo?.name || user.name,
    email: parsedData.personalInfo?.email || user.email,
    title: parsedData.personalInfo?.title || user.profile?.title || null,
    phone: parsedData.personalInfo?.phone?.length
      ? parsedData.personalInfo.phone
      : user.profile?.phone
        ? [user.profile.phone]
        : [],
    location: parsedData.personalInfo?.location || user.profile?.location || null,
    linkedin: parsedData.personalInfo?.linkedin || user.profile?.linkedin || null,
    imgUrl:
      parsedData.personalInfo?.imgUrl ||
      user.profile?.imageUrl ||
      null,
  };

  return {
    personalInfo,
    summary: parsedData.summary || user.profile?.summary || null,
    skills: parsedData.skills || [
      {
        skill_category_name: "Competencies",
        skills_belongs_this_category: user.profile?.competencies || [],
      },
    ],
    experience: parsedData.experience || [],
    education: parsedData.education || [],
    projects: parsedData.projects || [],
    certificates: parsedData.certificates || [],
  };
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString() }, JWT_SECRET, { expiresIn: "7d" });
}

async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");

    if (!token) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub);

    if (!user) {
      return res.status(401).json({ error: "Session user was not found." });
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session." });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");

    if (!token) {
      next();
      return;
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub);

    if (user) {
      req.user = user;
    }
  } catch {
    // Feedback should still be accepted for signed-out users.
  }

  next();
}

function sanitizeCloudinarySegment(value, fallback) {
  const sanitized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return sanitized || fallback;
}

function cloudinaryReady() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

function uploadBufferToCloudinary(file, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error("Cloudinary upload failed."));
          return;
        }

        resolve(result);
      },
    );

    stream.end(file.buffer);
  });
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return String(value || "");
}

function decodeHeaderValue(value) {
  try {
    return decodeURIComponent(firstHeaderValue(value));
  } catch {
    return firstHeaderValue(value);
  }
}

function requestIp(req) {
  const forwardedFor = firstHeaderValue(req.headers["x-forwarded-for"]);
  const ip = (
    forwardedFor.split(",")[0]?.trim() ||
    firstHeaderValue(req.headers["cf-connecting-ip"]) ||
    firstHeaderValue(req.headers["x-real-ip"]) ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );

  return ip.replace(/^::ffff:/, "");
}

function visitorInfoFromRequest(req) {
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
    ipHash: createHash("sha256")
      .update(`${JWT_SECRET}:${ip}`)
      .digest("hex"),
    userAgent: firstHeaderValue(req.headers["user-agent"]).slice(0, 240),
    referrer: firstHeaderValue(req.headers.referer || req.headers.referrer).slice(0, 300),
    visitedAt: new Date(),
  };
}

async function recordPortfolioVisit(resumeId, req) {
  const visit = visitorInfoFromRequest(req);
  const resume = await Resume.findOneAndUpdate(
    {
      _id: resumeId,
      parseStatus: "completed",
      parsedData: { $ne: null },
    },
    {
      $inc: { portfolioTotalCount: 1 },
      $set: { portfolioLastVisit: visit },
      $push: {
        portfolioVisits: {
          $each: [visit],
          $slice: -100,
        },
      },
    },
    { new: true },
  ).lean();

  if (!resume) {
    return null;
  }

  await Resume.updateOne(
    {
      _id: resume._id,
      portfolioVisitorKeys: { $ne: visit.ipHash },
    },
    {
      $inc: { portfolioUniqueCount: 1 },
      $addToSet: { portfolioVisitorKeys: visit.ipHash },
    },
  );

  return Resume.findById(resume._id).lean();
}

function getUploadErrorMessage(error) {
  if (error?.status === 429 || String(error?.message || "").includes("RESOURCE_EXHAUSTED")) {
    return "Gemini quota is exhausted for the configured API key/model. Try another model or API key, then upload again.";
  }

  if (error instanceof SyntaxError) {
    return "AI returned invalid JSON. Please retry the upload.";
  }

  return error.message || "Resume parsing failed.";
}

async function parseResumePdf(filePath) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured on the backend.");
  }

  const base64Data = fs.readFileSync(filePath).toString("base64");
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: EXTRACTION_PROMPT },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64Data,
            },
          },
        ],
      },
    ],
    config: {
      thinkingConfig: {
        thinkingLevel: "low",
      },
    },
  });

  return JSON.parse(cleanGeminiJson(response.text));
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "resume-parser", model: GEMINI_MODEL });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!name || !normalizedEmail || !password) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  try {
    const challenge = await createOtpChallenge({
      user: null,
      email: normalizedEmail,
      purpose: "registration",
    });

    res.json({
      challengeId: challenge._id.toString(),
      email: normalizedEmail,
      expiresInMinutes: OTP_TTL_MINUTES,
      requiresOtp: true,
    });
  } catch (mailError) {
    console.error("Registration OTP email failed:", mailError);
    res.status(503).json({
      error: "Unable to send registration OTP. Please check email configuration.",
    });
  }
});

app.post("/api/auth/register/verify-otp", authLimiter, async (req, res) => {
  const { challengeId, name, email, password, otp } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!challengeId || !name || !normalizedEmail || !password || !otp) {
    return res.status(400).json({
      error: "Name, email, password, challenge, and OTP are required.",
    });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  try {
    await verifyOtpChallenge({
      challengeId,
      email: normalizedEmail,
      otp,
      purpose: "registration",
    });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email: normalizedEmail, passwordHash });

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (otpError) {
    res.status(401).json({
      error: otpError instanceof Error ? otpError.message : "Invalid OTP.",
    });
  }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = await User.findOne({ email: normalizedEmail });
  const validPassword = user?.passwordHash
    ? await bcrypt.compare(password, user.passwordHash)
    : false;

  if (!user || !validPassword) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});

app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
  const { email } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    return res.status(400).json({ error: "Email is required." });
  }

  const user = await User.findOne({ email: normalizedEmail });

  if (!user || !user.passwordHash) {
    return res.json({
      ok: true,
      message: "If an account exists, a password reset OTP has been sent.",
    });
  }

  try {
    const challenge = await createOtpChallenge({
      user,
      email: normalizedEmail,
      purpose: "password_reset",
    });

    res.json({
      challengeId: challenge._id.toString(),
      email: normalizedEmail,
      expiresInMinutes: OTP_TTL_MINUTES,
      message: "Password reset OTP sent.",
      ok: true,
    });
  } catch (mailError) {
    console.error("Password reset OTP email failed:", mailError);
    res.status(503).json({
      error: "Unable to send password reset OTP. Please check email configuration.",
    });
  }
});

app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  const { challengeId, email, otp, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!challengeId || !normalizedEmail || !otp || !password) {
    return res.status(400).json({
      error: "Email, challenge, OTP, and new password are required.",
    });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    const challenge = await verifyOtpChallenge({
      challengeId,
      email: normalizedEmail,
      otp,
      purpose: "password_reset",
    });
    const user = await User.findById(challenge.user);

    if (!user) {
      return res.status(401).json({ error: "User was not found." });
    }

    user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (otpError) {
    res.status(401).json({
      error: otpError instanceof Error ? otpError.message : "Invalid OTP.",
    });
  }
});

app.post("/api/auth/google", authLimiter, async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: "Google ID Token is required." });
  }

  let email;
  let name;
  let googleId;
  let imageUrl = "";

  if (!GOOGLE_CLIENT_ID || !googleClient) {
    return res.status(503).json({ error: "Google sign-in is not configured." });
  }

  if (String(idToken).startsWith("mock_")) {
    return res.status(401).json({ error: "Invalid Google token." });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(400).json({ error: "Invalid Google token payload." });
    }
    email = payload.email;
    name = payload.name;
    googleId = payload.sub;
    imageUrl = payload.picture || "";
  } catch (error) {
    console.error("Google token verification failed:", error);
    return res.status(401).json({ error: "Failed to verify Google token." });
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return res.status(400).json({ error: "Could not retrieve email from Google." });
  }

  try {
    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
      }

      // Capture the Google profile photo only once. Never overwrite a user-set photo.
      if (imageUrl && !user.profile?.imageUrl) {
        user.profile = {
          ...user.profile,
          imageUrl,
        };
      }
      await user.save();
    } else {
      user = await User.create({
        name: name || "Google User",
        email: normalizedEmail,
        googleId,
        profile: {
          imageUrl,
        },
      });
    }

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (dbError) {
    console.error("Database error during Google auth:", dbError);
    res.status(500).json({ error: "Failed to authenticate with Google." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get("/api/profile", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post("/api/feedback", optionalAuth, async (req, res) => {
  const allowedTypes = new Set(["feedback", "issue", "suggestion", "bug"]);
  const type = allowedTypes.has(req.body.type) ? req.body.type : "feedback";
  const subject = String(req.body.subject || "").trim();
  const message = String(req.body.message || "").trim();

  if (subject.length < 3) {
    return res.status(400).json({ error: "Please add a short subject." });
  }

  if (message.length < 10) {
    return res.status(400).json({ error: "Please describe the feedback or issue." });
  }

  const feedback = await Feedback.create({
    user: req.user?._id || null,
    name: String(req.body.name || req.user?.name || "").trim(),
    email: String(req.body.email || req.user?.email || "").trim().toLowerCase(),
    type,
    subject,
    message,
    pageUrl: String(req.body.pageUrl || "").trim(),
    browser: String(req.body.browser || req.headers["user-agent"] || "").trim(),
    source: "web",
  });

  res.status(201).json({
    feedback: {
      id: feedback._id.toString(),
      type: feedback.type,
      subject: feedback.subject,
      status: feedback.status,
      createdAt: feedback.createdAt,
    },
  });
});

app.get("/api/portfolio/:resumeId", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.resumeId)) {
    return res.status(400).json({ error: "Invalid resume id." });
  }

  const shouldTrackVisit = req.query.trackVisit === "1";
  const resume = shouldTrackVisit
    ? await recordPortfolioVisit(req.params.resumeId, req)
    : await Resume.findOne({
        _id: req.params.resumeId,
        parseStatus: "completed",
        parsedData: { $ne: null },
      }).lean();

  if (!resume) {
    return res.status(404).json({ error: "Portfolio resume not found." });
  }

  const user = resume.user ? await User.findById(resume.user).lean() : null;

  res.json({
    user: user ? publicUser(user) : null,
    resume: publicResume(resume),
    data: publicPortfolioData(
      user || {
        _id: null,
        name: "",
        email: "",
        profile: {},
      },
      resume,
    ),
  });
});

app.post("/api/portfolio/:resumeId/visit", async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.resumeId)) {
    return res.status(400).json({ error: "Invalid resume id." });
  }

  const updatedResume = await recordPortfolioVisit(req.params.resumeId, req);

  if (!updatedResume) {
    return res.status(404).json({ error: "Portfolio resume not found." });
  }

  res.json({
    ok: true,
    stats: {
      totalCount: updatedResume?.portfolioTotalCount || 0,
      uniqueCount: updatedResume?.portfolioUniqueCount || 0,
      lastVisit: updatedResume?.portfolioLastVisit
        ? publicVisit(updatedResume.portfolioLastVisit)
        : null,
    },
  });
});

app.put("/api/profile", requireAuth, async (req, res) => {
  const { name, profile = {} } = req.body;

  if (typeof name === "string" && name.trim()) {
    req.user.name = name.trim();
  }

  req.user.profile = {
    ...req.user.profile,
    ...profile,
    competencies: Array.isArray(profile.competencies)
      ? profile.competencies.map(String).filter(Boolean)
      : req.user.profile.competencies,
  };
  await req.user.save();

  res.json({ user: publicUser(req.user) });
});

app.post(
  "/api/uploads/image",
  imageUploadLimiter,
  requireAuth,
  imageUpload.single("image"),
  async (req, res) => {
    if (!cloudinaryReady()) {
      return res.status(500).json({ error: "Cloudinary is not configured." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Please choose an image to upload." });
    }

    const allowedCategories = new Set([
      "profile",
      "certificate",
      "project",
      "education",
      "experience",
      "resume",
    ]);
    const category = sanitizeCloudinarySegment(req.body.category, "resume");
    const projectName = sanitizeCloudinarySegment(
      req.body.projectName || CLOUDINARY_PROJECT_NAME,
      "resumeai",
    );

    if (!allowedCategories.has(category)) {
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
      res.status(502).json({
        error: error?.message || "Image upload failed.",
      });
    }
  },
);

app.get("/api/resumes", requireAuth, async (req, res) => {
  const resumes = await Resume.find({
    user: req.user._id,
    parseStatus: "completed",
  })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ count: resumes.length, resumes: resumes.map(publicResume) });
});

app.get("/api/resumes/:id", requireAuth, async (req, res) => {
  const resume = await Resume.findOne({ _id: req.params.id, user: req.user._id }).lean();

  if (!resume) {
    return res.status(404).json({ error: "Resume not found." });
  }

  res.json({ resume: publicResume(resume) });
});

app.put("/api/resumes/:id", requireAuth, async (req, res) => {
  const resume = await Resume.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { parsedData: req.body.parsedData, parseStatus: "completed", parseError: null },
    { new: true }
  );

  if (!resume) {
    return res.status(404).json({ error: "Resume not found." });
  }

  res.json({ resume: publicResume(resume) });
});

app.delete("/api/resumes/:id", requireAuth, async (req, res) => {
  const resume = await Resume.findOneAndDelete({ _id: req.params.id, user: req.user._id });

  if (!resume) {
    return res.status(404).json({ error: "Resume not found." });
  }

  res.json({ ok: true });
});

app.post("/api/resumes/parse", uploadLimiter, requireAuth, upload.single("resume"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Please choose a PDF resume before submitting." });
  }

  try {
    const parsedData = await parseResumePdf(req.file.path);
    const savedResume = await Resume.create({
      user: req.user._id,
      originalFileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      parseStatus: "completed",
      parsedData,
    });

    res.status(201).json({
      resumeId: savedResume._id.toString(),
      resume: savedResume.parsedData,
      record: publicResume(savedResume),
      meta: { model: GEMINI_MODEL },
    });
  } catch (error) {
    const uploadError = getUploadErrorMessage(error);
    res.status(502).json({
      error: uploadError,
    });
  } finally {
    fs.promises.rm(req.file.path, { force: true }).catch(() => {});
  }
});

app.use((error, req, res, next) => {
  if (error.message === "Origin is not allowed by CORS.") {
    return res.status(403).json({ error: "Origin is not allowed." });
  }

  if (
    error instanceof multer.MulterError ||
    error.message?.includes("PDF") ||
    error.message?.includes("image")
  ) {
    return res.status(400).json({ error: error.message });
  }

  next(error);
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Unexpected backend error." });
});

async function startServer() {
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log("Connected to MongoDB");

  app.listen(PORT, () => {
    console.log(`Resume parser API running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server failed to start:", error.message || error);
  process.exit(1);
});
