import mongoose from "mongoose";

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
    suspended: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export default mongoose.model("User", userSchema);
