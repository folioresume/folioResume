import mongoose from "mongoose";

const siteSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    value: { type: mongoose.Schema.Types.Mixed },
    category: { type: String, default: "general", trim: true, index: true },
  },
  { timestamps: true },
);

export default mongoose.model("SiteSettings", siteSettingsSchema);
