import mongoose from "mongoose";

const visitSchema = {
  city: { type: String, default: "" },
  region: { type: String, default: "" },
  country: { type: String, default: "" },
  timezone: { type: String, default: "" },
  ipHash: { type: String, default: "" },
  userAgent: { type: String, default: "" },
  referrer: { type: String, default: "" },
  visitedAt: { type: Date, default: null },
};

const resumeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    handle: { type: String, lowercase: true, trim: true, default: undefined },
    originalFileName: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    mimeType: { type: String, default: "application/pdf" },
    parseStatus: { type: String, enum: ["completed", "failed"], default: "completed" },
    parseError: { type: String, default: null },
    parsedData: { type: mongoose.Schema.Types.Mixed, default: null },
    portfolioTotalCount: { type: Number, default: 0 },
    portfolioUniqueCount: { type: Number, default: 0 },
    portfolioVisitorKeys: { type: [String], default: [] },
    portfolioLastVisit: visitSchema,
    portfolioVisits: { type: [visitSchema], default: [] },
    status: { type: String, enum: ["draft", "active", "expired"], default: "draft" },
    publishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    paymentStatus: { type: String, enum: ["unpaid", "paid", "failed"], default: "unpaid" },
    paymentId: { type: String, default: null },
    orderId: { type: String, default: null },
  },
  { timestamps: true },
);

// Partial index: only indexes documents where handle is a non-null string so
// multiple resumes with no handle (undefined/null) coexist without conflict.
resumeSchema.index(
  { handle: 1 },
  {
    unique: true,
    partialFilterExpression: { handle: { $type: "string" } },
    name: "handle_unique_partial",
  },
);

// Dashboard / owner lookups: Resume.find({ user, parseStatus }).sort({ createdAt: -1 }).
resumeSchema.index({ user: 1, createdAt: -1 });
// Founding-offer/pricing math runs Resume.countDocuments({ status: "active" }) on
// every pricing, coupon, and order request — plus admin status filters and the
// expiry sweep. A status index keeps that off a full collection scan.
resumeSchema.index({ status: 1 });

export default mongoose.model("Resume", resumeSchema);
