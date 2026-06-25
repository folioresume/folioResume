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
import { createHash, createHmac, timingSafeEqual, webcrypto } from "node:crypto";
import Razorpay from "razorpay";
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
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const FREE_PARSE_LIMIT = Number(process.env.FREE_PARSE_LIMIT || 3);
const PORTFOLIO_PRICE = Number(process.env.PORTFOLIO_PRICE || 99);
const FOUNDING_PRICE = Number(process.env.FOUNDING_PRICE || 49);
const FOUNDING_USER_LIMIT = Number(process.env.FOUNDING_USER_LIMIT || 100);
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

const razorpay = RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
  : null;

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
  "links": [],
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
- links: extract ALL social/professional URLs found in the resume (LeetCode, GitHub, LinkedIn, Instagram, Twitter, CodePen, Behance, Dribbble, portfolio site, etc.) as { "label": "<platform name>", "url": "<full URL>" }. Include github and linkedin here too if present. Keep labels short and human-readable (e.g. "LeetCode", "GitHub", "LinkedIn", "Portfolio").
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
    freeParseCount: { type: Number, default: 0 },
    totalPublishedPortfolios: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const resumeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    handle: {
      type: String,
      lowercase: true,
      trim: true,
      default: undefined,
    },
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
    status: {
      type: String,
      enum: ["draft", "active", "expired"],
      default: "draft",
    },
    publishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid", "failed"],
      default: "unpaid",
    },
    paymentId: { type: String, default: null },
    orderId: { type: String, default: null },
  },
  { timestamps: true }
);

// Partial index: only indexes documents where handle is a non-null string,
// so multiple resumes with no handle (undefined/null) coexist without conflict.
resumeSchema.index(
  { handle: 1 },
  {
    unique: true,
    partialFilterExpression: { handle: { $type: "string" } },
    name: "handle_unique_partial",
  },
);

const paymentLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    portfolioId: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", required: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["created", "paid", "failed"],
      default: "created",
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
const PaymentLog = mongoose.model("PaymentLog", paymentLogSchema);

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
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      if (req.path === "/api/payments/webhook") {
        req.rawBody = buf;
      }
    },
  }),
);

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

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.PAYMENT_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payment attempts. Please try again later." },
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
  console.log(req)
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
    freeParseCount: user.freeParseCount || 0,
    totalPublishedPortfolios: user.totalPublishedPortfolios || 0,
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
  const handle = resume.handle || null;
  // Clean public URL: domainname.com/username when a handle is set.
  // Preview URL: ?resumeId=<id> when no handle yet (allows owner to preview draft).
  const portfolioUrl = handle
    ? `${PORTFOLIO_BASE_URL.replace(/\/+$/, "")}/${handle}`
    : (() => {
        const u = new URL(PORTFOLIO_BASE_URL);
        u.searchParams.set("resumeId", id);
        return u.toString();
      })();

  return {
    id,
    handle,
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
    status: resume.status || "draft",
    publishedAt: resume.publishedAt || null,
    expiresAt: resume.expiresAt || null,
    paymentStatus: resume.paymentStatus || "unpaid",
    paymentId: resume.paymentId || null,
    orderId: resume.orderId || null,
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

  // Merge explicit links with social URLs from personalInfo so that existing
  // resumes (parsed before the links field was added) still show all links.
  const parsedLinks = Array.isArray(parsedData.links) ? parsedData.links : [];
  const piSocialLinks = [
    { label: "GitHub", url: parsedData.personalInfo?.github },
    { label: "LinkedIn", url: parsedData.personalInfo?.linkedin },
    { label: "Portfolio", url: parsedData.personalInfo?.portfolio },
  ].filter((l) => l.url);
  const seenLinkUrls = new Set(parsedLinks.map((l) => l.url).filter(Boolean));
  const mergedLinks = [
    ...parsedLinks,
    ...piSocialLinks.filter((l) => !seenLinkUrls.has(l.url)),
  ];

  return {
    personalInfo,
    links: mergedLinks,
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

const RESERVED_HANDLES = new Set([
  "api",
  "portfolio",
  "admin",
  "login",
  "register",
  "dashboard",
  "resumes",
  "resume",
  "settings",
  "profile",
  "help",
  "templates",
  "preview",
  "edit",
  "new",
  "static",
  "assets",
  "favicon",
]);

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

function normalizeHandle(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidHandle(handle) {
  return HANDLE_PATTERN.test(handle) && !RESERVED_HANDLES.has(handle);
}

// Mongoose's ObjectId.isValid() accepts any 12-char string, so use a strict
// 24-hex check to avoid mistaking a custom handle for an ObjectId.
function looksLikeObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || ""));
}

// Builds a Mongo filter matching a published portfolio by ObjectId or custom handle.
function portfolioFilter(idOrHandle) {
  const base = { parseStatus: "completed", parsedData: { $ne: null } };

  if (looksLikeObjectId(idOrHandle)) {
    return { ...base, _id: idOrHandle };
  }

  return { ...base, handle: normalizeHandle(idOrHandle) };
}

async function recordPortfolioVisit(idOrHandle, req) {
  const visit = visitorInfoFromRequest(req);
  const resume = await Resume.findOneAndUpdate(
    portfolioFilter(idOrHandle),
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
  // console.log(req);
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

// Issues a short-lived (30 min) preview token for the owner to preview their
// own unpublished portfolio. The portfolio app passes this back as ?preview=<token>.
app.post("/api/portfolio/:resumeId/preview-token", requireAuth, async (req, res) => {
  const { resumeId } = req.params;
  if (!looksLikeObjectId(resumeId)) {
    return res.status(400).json({ error: "Invalid resume ID." });
  }
  const resume = await Resume.findOne({ _id: resumeId, user: req.user._id }).lean();
  if (!resume) {
    return res.status(404).json({ error: "Resume not found or access denied." });
  }
  const token = jwt.sign(
    { resumeId, type: "portfolio-preview" },
    JWT_SECRET,
    { expiresIn: "30m" },
  );
  res.json({ token, expiresIn: 1800 });
});

app.get("/api/portfolio/:resumeId", async (req, res) => {
  const idOrHandle = req.params.resumeId;

  if (!looksLikeObjectId(idOrHandle) && !isValidHandle(normalizeHandle(idOrHandle))) {
    return res.status(400).json({ error: "Invalid portfolio id." });
  }

  const accessedByHandle = !looksLikeObjectId(idOrHandle);

  // ObjectId access = owner preview mode. Require a valid signed preview token
  // so that random guessing of MongoDB IDs cannot expose unpublished portfolios.
  if (!accessedByHandle) {
    const previewToken = req.query.preview;
    if (!previewToken) {
      return res.status(403).json({ error: "Portfolio preview requires a valid preview token." });
    }
    try {
      const decoded = jwt.verify(previewToken, JWT_SECRET);
      if (decoded.type !== "portfolio-preview" || decoded.resumeId !== idOrHandle) {
        return res.status(403).json({ error: "Invalid preview token." });
      }
    } catch {
      return res.status(403).json({ error: "Preview token has expired. Please generate a new preview link." });
    }
  }

  // Find the resume without payment-gating so we can return meaningful errors.
  const baseFilter = { parseStatus: "completed", parsedData: { $ne: null } };
  const idFilter = accessedByHandle
    ? { ...baseFilter, handle: normalizeHandle(idOrHandle) }
    : { ...baseFilter, _id: idOrHandle };

  let resume = await Resume.findOne(idFilter).lean();

  if (!resume) {
    return res.status(404).json({ error: "Portfolio resume not found." });
  }

  // Auto-expire portfolios whose subscription period has lapsed.
  if (resume.status === "active" && resume.expiresAt && new Date(resume.expiresAt) < new Date()) {
    await Resume.updateOne({ _id: resume._id }, { $set: { status: "expired" } });
    resume = { ...resume, status: "expired" };
  }

  const portfolioStatus = resume.status || "draft";

  // Handle-based (public URL): apply payment gate.
  if (accessedByHandle) {
    if (portfolioStatus === "expired") {
      return res.status(402).json({
        error: "Portfolio subscription has expired. Please renew to make it public again.",
        status: "expired",
      });
    }
    if (portfolioStatus === "draft") {
      return res.status(402).json({
        error: "This portfolio has not been published yet.",
        status: "draft",
      });
    }
  }

  // Track visits only for public handle access, not owner previews.
  const shouldTrackVisit = req.query.trackVisit === "1" && accessedByHandle;
  if (shouldTrackVisit) {
    resume = await recordPortfolioVisit(idOrHandle, req) || resume;
  }

  const user = resume.user ? await User.findById(resume.user).lean() : null;

  res.json({
    user: user ? publicUser(user) : null,
    resume: publicResume(resume),
    data: publicPortfolioData(
      user || { _id: null, name: "", email: "", profile: {} },
      resume,
    ),
  });
});

app.post("/api/portfolio/:resumeId/visit", async (req, res) => {
  const idOrHandle = req.params.resumeId;

  if (!looksLikeObjectId(idOrHandle) && !isValidHandle(normalizeHandle(idOrHandle))) {
    return res.status(400).json({ error: "Invalid portfolio id." });
  }

  const updatedResume = await recordPortfolioVisit(idOrHandle, req);

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

app.put("/api/resumes/:id/handle", requireAuth, async (req, res) => {
  const handle = normalizeHandle(req.body.handle);

  if (!handle) {
    return res.status(400).json({ error: "Please choose a portfolio link." });
  }

  if (!isValidHandle(handle)) {
    return res.status(400).json({
      error:
        "Use 3-30 characters: lowercase letters, numbers, and hyphens (not at the start or end).",
    });
  }

  const resume = await Resume.findOne({ _id: req.params.id, user: req.user._id });

  if (!resume) {
    return res.status(404).json({ error: "Resume not found." });
  }

  if (resume.handle === handle) {
    return res.json({ resume: publicResume(resume) });
  }

  const existing = await Resume.findOne({ handle }).select("_id").lean();
  if (existing && existing._id.toString() !== resume._id.toString()) {
    return res.status(409).json({ error: "That portfolio link is already taken." });
  }

  resume.handle = handle;

  try {
    await resume.save();
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "That portfolio link is already taken." });
    }
    throw error;
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

  // Enforce free parse limit for users who have never published a portfolio.
  const user = req.user;
  const hasPaidAccess = (user.totalPublishedPortfolios || 0) > 0;
  if (!hasPaidAccess && (user.freeParseCount || 0) >= FREE_PARSE_LIMIT) {
    await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    return res.status(403).json({
      error: `You have reached the free parse limit of ${FREE_PARSE_LIMIT} resumes. Publish a portfolio to continue.`,
      code: "PARSE_LIMIT_REACHED",
      freeParseLimit: FREE_PARSE_LIMIT,
      freeParseCount: user.freeParseCount,
    });
  }

  try {
    const parsedData = await parseResumePdf(req.file.path);
    const savedResume = await Resume.create({
      user: user._id,
      originalFileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      parseStatus: "completed",
      parsedData,
    });

    // Increment parse count for users without a published portfolio.
    if (!hasPaidAccess) {
      await User.updateOne({ _id: user._id }, { $inc: { freeParseCount: 1 } });
    }

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

// ── Payment endpoints ──────────────────────────────────────────────────────

app.post("/api/payments/create-order", paymentLimiter, requireAuth, async (req, res) => {
  if (!razorpay) {
    return res.status(503).json({ error: "Payment service is not configured." });
  }

  const { resumeId } = req.body;
  if (!resumeId || !looksLikeObjectId(resumeId)) {
    return res.status(400).json({ error: "Valid resume id is required." });
  }

  const resume = await Resume.findOne({ _id: resumeId, user: req.user._id });
  if (!resume) {
    return res.status(404).json({ error: "Resume not found." });
  }

  if (resume.status === "active") {
    return res.status(400).json({ error: "This portfolio is already published." });
  }

  // Determine price: founding offer or regular price.
  const activeCount = await Resume.countDocuments({ status: "active" });
  const price = activeCount < FOUNDING_USER_LIMIT ? FOUNDING_PRICE : PORTFOLIO_PRICE;
  const isFoundingOffer = activeCount < FOUNDING_USER_LIMIT;

  const receipt = `rcp_${resumeId.slice(-8)}_${Date.now()}`;
  const razorpayOrder = await razorpay.orders.create({
    amount: price * 100,
    currency: "INR",
    receipt,
    notes: { resumeId, userId: req.user._id.toString() },
  });

  // Upsert payment log for this order.
  await PaymentLog.findOneAndUpdate(
    { razorpayOrderId: razorpayOrder.id },
    {
      userId: req.user._id,
      portfolioId: resume._id,
      razorpayOrderId: razorpayOrder.id,
      amount: price,
      status: "created",
    },
    { upsert: true, new: true },
  );

  resume.orderId = razorpayOrder.id;
  await resume.save();

  res.json({
    orderId: razorpayOrder.id,
    amount: price,
    currency: "INR",
    razorpayKeyId: RAZORPAY_KEY_ID,
    isFoundingOffer,
    foundingPrice: FOUNDING_PRICE,
    regularPrice: PORTFOLIO_PRICE,
  });
});

app.post("/api/payments/verify", requireAuth, async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature, resumeId } = req.body;

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !resumeId) {
    return res.status(400).json({ error: "Missing required payment verification fields." });
  }

  if (!RAZORPAY_KEY_SECRET) {
    return res.status(503).json({ error: "Payment service is not configured." });
  }

  const expectedSignature = createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (!safeCompare(razorpaySignature, expectedSignature)) {
    return res.status(400).json({ error: "Payment signature verification failed." });
  }

  // Replay protection: reject if this payment was already processed.
  const existingLog = await PaymentLog.findOne({ razorpayPaymentId });
  if (existingLog && existingLog.status === "paid") {
    return res.status(409).json({ error: "Payment already processed." });
  }

  const resume = await Resume.findOne({ _id: resumeId, user: req.user._id });
  if (!resume) {
    return res.status(404).json({ error: "Resume not found." });
  }

  const publishedAt = new Date();
  const expiresAt = new Date(publishedAt.getTime() + 365 * 24 * 60 * 60 * 1000);

  resume.status = "active";
  resume.paymentStatus = "paid";
  resume.paymentId = razorpayPaymentId;
  resume.publishedAt = publishedAt;
  resume.expiresAt = expiresAt;
  await resume.save();

  await PaymentLog.findOneAndUpdate(
    { razorpayOrderId },
    { razorpayPaymentId, status: "paid" },
  );

  await User.updateOne({ _id: req.user._id }, { $inc: { totalPublishedPortfolios: 1 } });

  const portfolioUrl = publicResume(resume).portfolioUrl;

  res.json({
    success: true,
    portfolioUrl,
    expiresAt: expiresAt.toISOString(),
    publishedAt: publishedAt.toISOString(),
  });
});

app.post("/api/payments/webhook", async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];

  if (!RAZORPAY_WEBHOOK_SECRET) {
    return res.status(200).json({ ok: true });
  }

  if (!req.rawBody) {
    return res.status(400).json({ error: "Raw body not available." });
  }

  const expectedSig = createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
    .update(req.rawBody)
    .digest("hex");

  if (!safeCompare(signature || "", expectedSig)) {
    return res.status(400).json({ error: "Invalid webhook signature." });
  }

  let event;
  try {
    event = JSON.parse(req.rawBody.toString());
  } catch {
    return res.status(400).json({ error: "Invalid webhook payload." });
  }

  if (event.event === "payment.captured") {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) {
      const log = await PaymentLog.findOne({ razorpayOrderId: payment.order_id });
      if (log && log.status !== "paid") {
        log.razorpayPaymentId = payment.id;
        log.status = "paid";
        await log.save();

        const portfolioResume = await Resume.findById(log.portfolioId);
        if (portfolioResume && portfolioResume.status !== "active") {
          const publishedAt = new Date();
          portfolioResume.status = "active";
          portfolioResume.paymentStatus = "paid";
          portfolioResume.paymentId = payment.id;
          portfolioResume.publishedAt = publishedAt;
          portfolioResume.expiresAt = new Date(publishedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
          await portfolioResume.save();
          await User.updateOne({ _id: log.userId }, { $inc: { totalPublishedPortfolios: 1 } });
        }
      }
    }
  } else if (event.event === "payment.failed") {
    const payment = event.payload?.payment?.entity;
    if (payment?.order_id) {
      await PaymentLog.findOneAndUpdate(
        { razorpayOrderId: payment.order_id },
        { razorpayPaymentId: payment.id, status: "failed" },
      );
      const log = await PaymentLog.findOne({ razorpayOrderId: payment.order_id });
      if (log) {
        await Resume.findByIdAndUpdate(log.portfolioId, { paymentStatus: "failed" });
      }
    }
  }

  res.json({ ok: true });
});

app.get("/api/payments/history", requireAuth, async (req, res) => {
  const payments = await PaymentLog.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .populate("portfolioId", "originalFileName handle parsedData")
    .lean();

  res.json({
    payments: payments.map((p) => ({
      id: p._id.toString(),
      portfolioId: p.portfolioId?._id?.toString() || null,
      portfolioName:
        p.portfolioId?.parsedData?.personalInfo?.name ||
        p.portfolioId?.originalFileName ||
        "Unknown",
      portfolioHandle: p.portfolioId?.handle || null,
      razorpayOrderId: p.razorpayOrderId,
      razorpayPaymentId: p.razorpayPaymentId || null,
      amount: p.amount,
      status: p.status,
      createdAt: p.createdAt,
    })),
  });
});

// ── End payment endpoints ──────────────────────────────────────────────────

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

async function runMigrations() {
  const resumeCollection = mongoose.connection.db.collection("resumes");

  // Fix handle uniqueness: MongoDB sparse indexes still index null values, so
  // multiple resumes with handle=null trigger a duplicate-key error. We replace
  // the old sparse unique index with a partial index that only covers real strings.
  try {
    const existingIndexes = await resumeCollection.indexes();
    const oldIndex = existingIndexes.find((idx) => idx.name === "handle_1");
    if (oldIndex) {
      await resumeCollection.dropIndex("handle_1");
      console.log("Migration: dropped legacy handle_1 index.");
    }
    // Unset explicitly-stored null handles so the partial index ignores them.
    const unsetResult = await resumeCollection.updateMany(
      { handle: null },
      { $unset: { handle: "" } },
    );
    if (unsetResult.modifiedCount > 0) {
      console.log(`Migration: cleared null handle from ${unsetResult.modifiedCount} resume(s).`);
    }
  } catch (err) {
    console.warn("Migration: handle index cleanup warning:", err.message);
  }

  // Ensure the new partial index exists.
  await Resume.createIndexes();

  // Mark all pre-monetisation resumes as active so existing portfolios stay accessible.
  const result = await Resume.updateMany(
    { status: { $exists: false }, parseStatus: "completed", parsedData: { $ne: null } },
    { $set: { status: "active", paymentStatus: "paid" } },
  );
  if (result.modifiedCount > 0) {
    console.log(`Migration: activated ${result.modifiedCount} pre-existing portfolio(s).`);
  }
}

async function startServer() {
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log("Connected to MongoDB");

  await runMigrations();

  app.listen(PORT, () => {
    console.log(`Resume parser API running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Server failed to start:", error.message || error);
  process.exit(1);
});
