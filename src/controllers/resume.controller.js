import fs from "fs";
import Resume from "../models/Resume.js";
import User from "../models/User.js";
import { parseResumePdf, getUploadErrorMessage } from "../services/ai.service.js";
import { publicResume } from "../utils/formatters.js";
import { normalizeHandle, isValidHandle, looksLikeObjectId, generateUniqueHandle } from "../utils/handle.js";
import { FREE_PARSE_LIMIT, GEMINI_MODEL } from "../config/env.js";

export async function getResumes(req, res) {
  const resumes = await Resume.find({ user: req.user._id, parseStatus: "completed" })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ count: resumes.length, resumes: resumes.map(publicResume) });
}

export async function getResume(req, res) {
  const resume = await Resume.findOne({ _id: req.params.id, user: req.user._id }).lean();
  if (!resume) return res.status(404).json({ error: "Resume not found." });
  res.json({ resume: publicResume(resume) });
}

export async function parseResume(req, res) {
  if (!req.file) return res.status(400).json({ error: "Please choose a PDF resume before submitting." });

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

    // Auto-generate a unique handle from the parsed name so the portfolio
    // URL is available immediately without any manual setup.
    const parsedName = parsedData?.personalInfo?.name || user.name || "";
    const autoHandle = await generateUniqueHandle(parsedName);

    const savedResume = await Resume.create({
      user: user._id,
      originalFileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      parseStatus: "completed",
      parsedData,
      ...(autoHandle ? { handle: autoHandle } : {}),
    });

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
    res.status(502).json({ error: getUploadErrorMessage(error) });
  } finally {
    fs.promises.rm(req.file.path, { force: true }).catch(() => {});
  }
}

export async function updateResume(req, res) {
  const resume = await Resume.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { parsedData: req.body.parsedData, parseStatus: "completed", parseError: null },
    { new: true },
  );
  if (!resume) return res.status(404).json({ error: "Resume not found." });
  res.json({ resume: publicResume(resume) });
}

export async function deleteResume(req, res) {
  const resume = await Resume.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!resume) return res.status(404).json({ error: "Resume not found." });
  res.json({ ok: true });
}

export async function updateHandle(req, res) {
  const handle = normalizeHandle(req.body.handle);

  if (!handle) return res.status(400).json({ error: "Please choose a portfolio link." });
  if (!isValidHandle(handle)) {
    return res.status(400).json({
      error: "Use 3-30 characters: lowercase letters, numbers, and hyphens (not at the start or end).",
    });
  }

  const resume = await Resume.findOne({ _id: req.params.id, user: req.user._id });
  if (!resume) return res.status(404).json({ error: "Resume not found." });
  if (resume.handle === handle) return res.json({ resume: publicResume(resume) });

  const existing = await Resume.findOne({ handle }).select("_id").lean();
  if (existing && existing._id.toString() !== resume._id.toString()) {
    return res.status(409).json({ error: "That portfolio link is already taken." });
  }

  resume.handle = handle;
  try {
    await resume.save();
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: "That portfolio link is already taken." });
    throw error;
  }

  res.json({ resume: publicResume(resume) });
}
