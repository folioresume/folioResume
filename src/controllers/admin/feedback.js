import Feedback from "../../models/Feedback.js";
import { looksLikeObjectId } from "../../utils/handle.js";

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listFeedback(req, res) {
  const { type = "all", status = "all", search = "", page = 1, limit = 20 } = req.query;
  const parsedLimit = Math.min(Number(limit) || 20, 100);
  const skip = (Math.max(Number(page), 1) - 1) * parsedLimit;

  const query = {};
  if (type !== "all") query.type = type;
  if (status !== "all") query.status = status;
  if (search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), "i");
    query.$or = [{ subject: rx }, { message: rx }, { email: rx }, { name: rx }];
  }

  const [items, total] = await Promise.all([
    Feedback.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .populate("user", "name email")
      .lean(),
    Feedback.countDocuments(query),
  ]);

  res.json({
    feedback: items,
    pagination: {
      page: Number(page),
      limit: parsedLimit,
      total,
      pages: Math.ceil(total / parsedLimit),
    },
  });
}

export async function updateFeedbackStatus(req, res) {
  const { id } = req.params;
  if (!looksLikeObjectId(id)) return res.status(400).json({ error: "Invalid feedback id." });

  const VALID = ["new", "reviewing", "resolved", "closed"];
  const { status } = req.body || {};
  if (!VALID.includes(status)) return res.status(400).json({ error: "Invalid status." });

  const item = await Feedback.findByIdAndUpdate(id, { status }, { new: true }).lean();
  if (!item) return res.status(404).json({ error: "Feedback not found." });

  res.json({ feedback: item });
}
