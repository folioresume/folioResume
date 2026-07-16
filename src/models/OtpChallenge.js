import mongoose from "mongoose";

const otpChallengeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    purpose: { type: String, enum: ["registration", "password_reset"], required: true },
    otpHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true },
);

export default mongoose.model("OtpChallenge", otpChallengeSchema);
