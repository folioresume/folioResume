import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { timingSafeEqual, webcrypto } from "node:crypto";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";
import apiLogger from "./utils/logger.js";



if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || CLIENT_ORIGIN)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const API_KEY = process.env.API_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_env";
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/resume_parser";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

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

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    profile: {
      title: { type: String, default: "" },
      phone: { type: String, default: "" },
      company: { type: String, default: "" },
      location: { type: String, default: "" },
      linkedin: { type: String, default: "" },
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
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Resume = mongoose.model("Resume", resumeSchema);

const app = express();

if (process.env.NODE_ENV === "production" && JWT_SECRET === "change_this_secret_in_env") {
  throw new Error("JWT_SECRET must be configured in production.");
}

function allowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin);
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

function requireApiKey(req, res, next) {
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

function publicResume(resume) {
  return {
    id: resume._id.toString(),
    user: resume.user?.toString?.() || null,
    originalFileName: resume.originalFileName,
    fileSize: resume.fileSize,
    mimeType: resume.mimeType,
    parseStatus: resume.parseStatus,
    parseError: resume.parseError,
    parsedData: resume.parsedData,
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
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

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({ name, email: normalizedEmail, passwordHash });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = await User.findOne({ email: normalizedEmail });
  const validPassword = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !validPassword) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
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

app.get("/api/resumes", requireAuth, async (req, res) => {
  const resumes = await Resume.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();
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
    const savedResume = await Resume.create({
      user: req.user._id,
      originalFileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      parseStatus: "failed",
      parseError: uploadError,
      parsedData: null,
    });

    res.status(502).json({
      error: uploadError,
      resumeId: savedResume._id.toString(),
      record: publicResume(savedResume),
    });
  } finally {
    fs.promises.rm(req.file.path, { force: true }).catch(() => {});
  }
});

app.use((error, req, res, next) => {
  if (error.message === "Origin is not allowed by CORS.") {
    return res.status(403).json({ error: "Origin is not allowed." });
  }

  if (error instanceof multer.MulterError || error.message?.includes("PDF")) {
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
