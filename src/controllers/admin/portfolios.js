import Resume from "../../models/Resume.js";
import User from "../../models/User.js";
import { looksLikeObjectId } from "../../utils/handle.js";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PORTFOLIO_SELECT =
  "originalFileName handle status paymentStatus publishedAt expiresAt portfolioTotalCount portfolioUniqueCount parsedData user createdAt";

export async function listPortfolios(req, res) {
  const { search = "", filter = "all", page = 1, limit = 20 } = req.query;
  const parsedLimit = Math.min(Number(limit) || 20, 100);
  const skip = (Math.max(Number(page), 1) - 1) * parsedLimit;

  const query = { user: { $ne: null } };

  if (search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), "i");
    query.$or = [{ handle: rx }, { "parsedData.personalInfo.name": rx }];
  }

  if (filter === "active") query.status = "active";
  else if (filter === "draft") query.status = "draft";
  else if (filter === "expired") query.status = "expired";

  const [portfolios, total] = await Promise.all([
    Resume.find(query)
      .select(PORTFOLIO_SELECT)
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    Resume.countDocuments(query),
  ]);

  res.json({
    portfolios: portfolios.map((p) => ({
      _id: p._id,
      name: p.parsedData?.personalInfo?.name || p.originalFileName,
      handle: p.handle,
      status: p.status,
      paymentStatus: p.paymentStatus,
      publishedAt: p.publishedAt,
      expiresAt: p.expiresAt,
      views: p.portfolioTotalCount,
      uniqueVisitors: p.portfolioUniqueCount,
      user: p.user,
      createdAt: p.createdAt,
    })),
    pagination: {
      page: Number(page),
      limit: parsedLimit,
      total,
      pages: Math.ceil(total / parsedLimit),
    },
  });
}

export async function unpublishPortfolio(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid portfolio id." });

  const portfolio = await Resume.findById(id);
  if (!portfolio) return res.status(404).json({ error: "Portfolio not found." });

  const wasActive = portfolio.status === "active";
  portfolio.status = "draft";
  await portfolio.save();

  if (wasActive && portfolio.user) {
    await User.updateOne({ _id: portfolio.user }, { $inc: { totalPublishedPortfolios: -1 } });
  }

  res.json({ ok: true });
}

export async function republishPortfolio(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid portfolio id." });

  const portfolio = await Resume.findById(id);
  if (!portfolio) return res.status(404).json({ error: "Portfolio not found." });

  const wasDraft = portfolio.status !== "active";
  portfolio.status = "active";

  // Restore expiry if it had expired
  if (!portfolio.expiresAt || portfolio.expiresAt < new Date()) {
    portfolio.expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  }
  if (!portfolio.publishedAt) portfolio.publishedAt = new Date();
  await portfolio.save();

  if (wasDraft && portfolio.user) {
    await User.updateOne({ _id: portfolio.user }, { $inc: { totalPublishedPortfolios: 1 } });
  }

  res.json({ ok: true, expiresAt: portfolio.expiresAt });
}

export async function extendPortfolioExpiry(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid portfolio id." });

  const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 365);
  const ms = days * 24 * 60 * 60 * 1000;

  const portfolio = await Resume.findById(id);
  if (!portfolio) return res.status(404).json({ error: "Portfolio not found." });

  const now = new Date();
  const base = portfolio.expiresAt && portfolio.expiresAt > now ? portfolio.expiresAt : now;
  portfolio.expiresAt = new Date(base.getTime() + ms);
  await portfolio.save();

  res.json({ ok: true, expiresAt: portfolio.expiresAt });
}

export async function deletePortfolio(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid portfolio id." });

  const portfolio = await Resume.findById(id);
  if (!portfolio) return res.status(404).json({ error: "Portfolio not found." });

  const wasActive = portfolio.status === "active";
  await portfolio.deleteOne();

  if (wasActive && portfolio.user) {
    await User.updateOne(
      { _id: portfolio.user, totalPublishedPortfolios: { $gt: 0 } },
      { $inc: { totalPublishedPortfolios: -1 } },
    );
  }

  res.json({ ok: true });
}
