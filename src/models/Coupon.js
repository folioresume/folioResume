import mongoose from "mongoose";

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 32 },
    discountType: { type: String, enum: ["percent", "fixed"], default: "fixed" },
    discountValue: { type: Number, required: true, min: 1 },
    maxUsage: { type: Number, default: 0 }, // 0 = unlimited
    usedCount: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    description: { type: String, default: "", trim: true, maxlength: 200 },
    minAmount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

couponSchema.index({ code: 1 });
couponSchema.index({ active: 1, expiresAt: 1 });

export default mongoose.model("Coupon", couponSchema);
