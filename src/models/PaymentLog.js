import mongoose from "mongoose";

const paymentLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    portfolioId: { type: mongoose.Schema.Types.ObjectId, ref: "Resume", required: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null },
    amount: { type: Number, required: true },
    originalAmount: { type: Number, default: null },
    discountAmount: { type: Number, default: 0 },
    couponId: { type: mongoose.Schema.Types.ObjectId, ref: "Coupon", default: null },
    couponCode: { type: String, default: null },
    status: { type: String, enum: ["created", "paid", "failed"], default: "created" },
  },
  { timestamps: true },
);

// Payment history: PaymentLog.find({ userId }).sort({ createdAt: -1 }).
paymentLogSchema.index({ userId: 1, createdAt: -1 });
// Webhook/verify reconciliation looks up by razorpayPaymentId.
paymentLogSchema.index({ razorpayPaymentId: 1 });

export default mongoose.model("PaymentLog", paymentLogSchema);
