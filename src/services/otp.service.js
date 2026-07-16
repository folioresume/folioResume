import { createHash } from "node:crypto";
import OtpChallenge from "../models/OtpChallenge.js";
import { sendOtpEmail } from "./mail.service.js";
import { OTP_TTL_MINUTES } from "../config/env.js";
import { safeCompare } from "../utils/helpers.js";

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOtp(otp) {
  return createHash("sha256").update(String(otp)).digest("hex");
}

export async function createOtpChallenge({ user, email, purpose }) {
  const otp = generateOtp();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  await OtpChallenge.updateMany(
    { email: normalizedEmail, purpose, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  const challenge = await OtpChallenge.create({
    user: user?._id || null,
    email: normalizedEmail,
    purpose,
    otpHash: hashOtp(otp),
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
  });

  await sendOtpEmail({ email: normalizedEmail, name: user?.name || "", otp, purpose });
  return challenge;
}

export async function verifyOtpChallenge({ challengeId, email, otp, purpose }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const challenge = await OtpChallenge.findOne({
    _id: challengeId,
    email: normalizedEmail,
    purpose,
    consumedAt: null,
  });

  if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
    throw new Error("Invalid or expired OTP.");
  }

  if (challenge.attempts >= 5) {
    throw new Error("Too many OTP attempts. Please request a new code.");
  }

  if (!safeCompare(hashOtp(otp), challenge.otpHash)) {
    challenge.attempts += 1;
    await challenge.save();
    throw new Error("Invalid OTP.");
  }

  challenge.consumedAt = new Date();
  await challenge.save();
  return challenge;
}
