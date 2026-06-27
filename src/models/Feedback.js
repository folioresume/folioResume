import mongoose from "mongoose";

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
  { timestamps: true },
);

export default mongoose.model("Feedback", feedbackSchema);
