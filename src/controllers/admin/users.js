import User from "../../models/User.js";
import Resume from "../../models/Resume.js";
import PaymentLog from "../../models/PaymentLog.js";
import { looksLikeObjectId } from "../../utils/handle.js";
import { sendOtpEmail } from "../../services/mail.service.js";
import nodemailer from "nodemailer";
import { SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT, SMTP_SECURE, MAIL_FROM } from "../../config/env.js";

const USER_PROJECTION = "-passwordHash -googleId";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatUser(u) {
  return {
    ...u,
    plan: u.totalPublishedPortfolios > 0 ? "premium" : "free",
    status: u.suspended ? "suspended" : "active",
  };
}

export async function listUsers(req, res) {
  const { search = "", filter = "All", page = 1, limit = 20 } = req.query;
  const parsedLimit = Math.min(Number(limit) || 20, 100);
  const skip = (Math.max(Number(page), 1) - 1) * parsedLimit;

  const query = {};

  if (search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), "i");
    query.$or = [{ name: rx }, { email: rx }];
  }

  if (filter === "Premium") query.totalPublishedPortfolios = { $gt: 0 };
  else if (filter === "Free") query.totalPublishedPortfolios = 0;
  else if (filter === "Suspended") query.suspended = true;
  else if (filter === "No Portfolio") query.totalPublishedPortfolios = 0;

  // For Published/Draft/Expired: need to join with Resume — do via $in on user IDs
  if (["Published", "Draft", "Expired"].includes(filter)) {
    const statusMap = { Published: "active", Draft: "draft", Expired: "expired" };
    const userIds = await Resume.distinct("user", { status: statusMap[filter], user: { $ne: null } });
    query._id = { $in: userIds };
  }

  const [users, total] = await Promise.all([
    User.find(query)
      .select(USER_PROJECTION)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    User.countDocuments(query),
  ]);

  res.json({
    users: users.map(formatUser),
    pagination: {
      page: Number(page),
      limit: parsedLimit,
      total,
      pages: Math.ceil(total / parsedLimit),
    },
  });
}

export async function getUser(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid user id." });

  const [user, portfolios, payments] = await Promise.all([
    User.findById(id).select(USER_PROJECTION).lean(),
    Resume.find({ user: id })
      .select("originalFileName handle status paymentStatus publishedAt expiresAt portfolioTotalCount parsedData createdAt")
      .sort({ createdAt: -1 })
      .lean(),
    PaymentLog.find({ userId: id })
      .select("-__v")
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  if (!user) return res.status(404).json({ error: "User not found." });

  res.json({
    user: formatUser(user),
    portfolios: portfolios.map((p) => ({
      _id: p._id,
      name: p.parsedData?.personalInfo?.name || p.originalFileName,
      handle: p.handle,
      status: p.status,
      paymentStatus: p.paymentStatus,
      publishedAt: p.publishedAt,
      expiresAt: p.expiresAt,
      views: p.portfolioTotalCount,
      createdAt: p.createdAt,
    })),
    payments,
  });
}

export async function suspendUser(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid user id." });
  const user = await User.findByIdAndUpdate(id, { suspended: true }, { new: true })
    .select(USER_PROJECTION).lean();
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: formatUser(user) });
}

export async function unsuspendUser(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid user id." });
  const user = await User.findByIdAndUpdate(id, { suspended: false }, { new: true })
    .select(USER_PROJECTION).lean();
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: formatUser(user) });
}

export async function deleteUser(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid user id." });
  const user = await User.findById(id).lean();
  if (!user) return res.status(404).json({ error: "User not found." });

  await Promise.all([
    User.deleteOne({ _id: id }),
    Resume.deleteMany({ user: id }),
    PaymentLog.deleteMany({ userId: id }),
  ]);

  res.json({ ok: true });
}

export async function resetParseCount(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid user id." });
  const user = await User.findByIdAndUpdate(id, { freeParseCount: 0 }, { new: true })
    .select(USER_PROJECTION).lean();
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: formatUser(user) });
}

export async function extendSubscription(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid user id." });

  const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 365);
  const ms = days * 24 * 60 * 60 * 1000;

  const portfolios = await Resume.find({ user: id, status: "active" }).lean();
  const now = new Date();

  await Promise.all(
    portfolios.map((p) => {
      const base = p.expiresAt && p.expiresAt > now ? p.expiresAt : now;
      return Resume.findByIdAndUpdate(p._id, { expiresAt: new Date(base.getTime() + ms) });
    }),
  );

  res.json({ ok: true, extended: portfolios.length, days });
}

export async function sendUserEmail(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid user id." });

  const { subject, body } = req.body || {};
  if (!subject?.trim() || !body?.trim()) {
    return res.status(400).json({ error: "Subject and body are required." });
  }

  const user = await User.findById(id).select("name email").lean();
  if (!user) return res.status(404).json({ error: "User not found." });

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return res.status(503).json({ error: "Email service is not configured." });
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: MAIL_FROM,
    to: user.email,
    subject: subject.trim(),
    text: body.trim(),
    html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#111827"><p>Hi ${user.name},</p><div>${body.trim().replace(/\n/g, "<br>")}</div><p style="margin-top:24px;font-size:12px;color:#6b7280">— FolioResume Team</p></div>`,
  });

  res.json({ ok: true });
}

export async function convertToPremium(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid user id." });

  const user = await User.findById(id).lean();
  if (!user) return res.status(404).json({ error: "User not found." });

  // Find the most recent completed but unpublished resume
  const resume = await Resume.findOne({
    user: id,
    status: { $ne: "active" },
    parseStatus: "completed",
    parsedData: { $ne: null },
  }).sort({ createdAt: -1 });

  if (!resume) return res.status(404).json({ error: "No eligible portfolio found to activate." });

  const publishedAt = new Date();
  const expiresAt = new Date(publishedAt.getTime() + 365 * 24 * 60 * 60 * 1000);

  resume.status = "active";
  resume.paymentStatus = "paid";
  resume.publishedAt = publishedAt;
  resume.expiresAt = expiresAt;
  await resume.save();

  await User.updateOne({ _id: id }, { $inc: { totalPublishedPortfolios: 1 } });

  res.json({ ok: true, handle: resume.handle, expiresAt });
}
