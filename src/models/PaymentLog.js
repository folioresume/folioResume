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

export default mongoose.model("PaymentLog", paymentLogSchema);
