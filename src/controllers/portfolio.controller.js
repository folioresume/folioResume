import jwt from "jsonwebtoken";
import Resume from "../models/Resume.js";
import User from "../models/User.js";
import { visitorInfoFromRequest } from "../utils/visitor.js";
import { publicResume, publicUser, publicPortfolioData, publicVisit } from "../utils/formatters.js";
import { looksLikeObjectId, isValidHandle, normalizeHandle, portfolioFilter } from "../utils/handle.js";
import { JWT_SECRET } from "../config/env.js";

async function recordPortfolioVisit(idOrHandle, req) {
  const visit = visitorInfoFromRequest(req);
  const resume = await Resume.findOneAndUpdate(
    portfolioFilter(idOrHandle),
    {
      $inc: { portfolioTotalCount: 1 },
      $set: { portfolioLastVisit: visit },
      $push: { portfolioVisits: { $each: [visit], $slice: -100 } },
    },
    { new: true },
  ).lean();

  if (!resume) return null;

  await Resume.updateOne(
    { _id: resume._id, portfolioVisitorKeys: { $ne: visit.ipHash } },
    { $inc: { portfolioUniqueCount: 1 }, $addToSet: { portfolioVisitorKeys: visit.ipHash } },
  );

  return Resume.findById(resume._id).lean();
}

export async function issuePreviewToken(req, res) {
  const { resumeId } = req.params;
  if (!looksLikeObjectId(resumeId)) return res.status(400).json({ error: "Invalid resume ID." });

  const resume = await Resume.findOne({ _id: resumeId, user: req.user._id }).lean();
  if (!resume) return res.status(404).json({ error: "Resume not found or access denied." });

  const token = jwt.sign({ resumeId, type: "portfolio-preview" }, JWT_SECRET, { expiresIn: "30m" });
  res.json({ token, expiresIn: 1800 });
}

export async function getPortfolio(req, res) {
  const idOrHandle = req.params.resumeId;

  if (!looksLikeObjectId(idOrHandle) && !isValidHandle(normalizeHandle(idOrHandle))) {
    return res.status(400).json({ error: "Invalid portfolio id." });
  }

  const accessedByHandle = !looksLikeObjectId(idOrHandle);

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

  const baseFilter = { parseStatus: "completed", parsedData: { $ne: null } };
  const idFilter = accessedByHandle
    ? { ...baseFilter, handle: normalizeHandle(idOrHandle) }
    : { ...baseFilter, _id: idOrHandle };

  let resume = await Resume.findOne(idFilter).lean();
  if (!resume) return res.status(404).json({ error: "Portfolio resume not found." });

  if (resume.status === "active" && resume.expiresAt && new Date(resume.expiresAt) < new Date()) {
    await Resume.updateOne({ _id: resume._id }, { $set: { status: "expired" } });
    resume = { ...resume, status: "expired" };
  }

  const portfolioStatus = resume.status || "draft";

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

  if (req.query.trackVisit === "1" && accessedByHandle) {
    resume = (await recordPortfolioVisit(idOrHandle, req)) || resume;
  }

  const user = resume.user ? await User.findById(resume.user).lean() : null;

  res.json({
    user: user ? publicUser(user) : null,
    resume: publicResume(resume),
    data: publicPortfolioData(user || { _id: null, name: "", email: "", profile: {} }, resume),
  });
}

export async function visitPortfolio(req, res) {
  const idOrHandle = req.params.resumeId;

  if (!looksLikeObjectId(idOrHandle) && !isValidHandle(normalizeHandle(idOrHandle))) {
    return res.status(400).json({ error: "Invalid portfolio id." });
  }

  const updatedResume = await recordPortfolioVisit(idOrHandle, req);
  if (!updatedResume) return res.status(404).json({ error: "Portfolio resume not found." });

  res.json({
    ok: true,
    stats: {
      totalCount: updatedResume.portfolioTotalCount || 0,
      uniqueCount: updatedResume.portfolioUniqueCount || 0,
      lastVisit: updatedResume.portfolioLastVisit ? publicVisit(updatedResume.portfolioLastVisit) : null,
    },
  });
}
