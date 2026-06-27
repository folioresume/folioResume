import Feedback from "../models/Feedback.js";

const ALLOWED_TYPES = new Set(["feedback", "issue", "suggestion", "bug"]);

export async function submitFeedback(req, res) {
  const type = ALLOWED_TYPES.has(req.body.type) ? req.body.type : "feedback";
  const subject = String(req.body.subject || "").trim();
  const message = String(req.body.message || "").trim();

  if (subject.length < 3) return res.status(400).json({ error: "Please add a short subject." });
  if (message.length < 10) return res.status(400).json({ error: "Please describe the feedback or issue." });

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
}
