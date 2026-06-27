import nodemailer from "nodemailer";
import {
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS,
  MAIL_FROM, OTP_TTL_MINUTES,
} from "../config/env.js";

let mailTransporter = null;

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("Email service is not configured.");
  }
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return mailTransporter;
}

export async function sendOtpEmail({ email, name, otp, purpose }) {
  const isPasswordReset = purpose === "password_reset";
  const subject = isPasswordReset
    ? "Reset your FolioResume password"
    : "Verify your FolioResume account";
  const intro = isPasswordReset
    ? "Use this OTP to reset your FolioResume password."
    : "Use this OTP to verify your email and finish creating your FolioResume account.";

  await getTransporter().sendMail({
    from: MAIL_FROM,
    to: email,
    subject,
    text: `${intro}\n\nYour OTP is ${otp}.\n\nThis code expires in ${OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#111827">
        <h2 style="margin:0 0 12px;color:#3525cd">FolioResume</h2>
        <p>Hi ${name || "there"},</p>
        <p>${intro}</p>
        <div style="margin:24px 0;padding:18px 20px;border-radius:12px;background:#f3f4f6;text-align:center">
          <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#111827">${otp}</div>
        </div>
        <p style="font-size:14px;color:#4b5563">This code expires in ${OTP_TTL_MINUTES} minutes.</p>
        <p style="font-size:14px;color:#4b5563">If you did not request this, you can ignore this email.</p>
      </div>
    `,
  });
}
