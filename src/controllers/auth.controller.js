import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import { createOtpChallenge, verifyOtpChallenge } from "../services/otp.service.js";
import { signToken } from "../utils/helpers.js";
import { publicUser } from "../utils/formatters.js";
import { GOOGLE_CLIENT_ID, OTP_TTL_MINUTES } from "../config/env.js";

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

export async function register(req, res) {
  const { name, email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!name || !normalizedEmail || !password) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  try {
    const challenge = await createOtpChallenge({ user: null, email: normalizedEmail, purpose: "registration" });
    res.json({
      challengeId: challenge._id.toString(),
      email: normalizedEmail,
      expiresInMinutes: OTP_TTL_MINUTES,
      requiresOtp: true,
    });
  } catch (err) {
    console.error("Registration OTP email failed:", err);
    res.status(503).json({ error: "Unable to send registration OTP. Please check email configuration." });
  }
}

export async function registerVerifyOtp(req, res) {
  const { challengeId, name, email, password, otp } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!challengeId || !name || !normalizedEmail || !password || !otp) {
    return res.status(400).json({ error: "Name, email, password, challenge, and OTP are required." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const existingUser = await User.findOne({ email: normalizedEmail });
  if (existingUser) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  try {
    await verifyOtpChallenge({ challengeId, email: normalizedEmail, otp, purpose: "registration" });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email: normalizedEmail, passwordHash });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Invalid OTP." });
  }
}

export async function login(req, res) {
  const { email, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const user = await User.findOne({ email: normalizedEmail });
  const validPassword = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !validPassword) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
}

export async function forgotPassword(req, res) {
  const normalizedEmail = String(req.body.email || "").trim().toLowerCase();
  if (!normalizedEmail) return res.status(400).json({ error: "Email is required." });

  const user = await User.findOne({ email: normalizedEmail });
  if (!user || !user.passwordHash) {
    return res.json({ ok: true, message: "If an account exists, a password reset OTP has been sent." });
  }

  try {
    const challenge = await createOtpChallenge({ user, email: normalizedEmail, purpose: "password_reset" });
    res.json({
      challengeId: challenge._id.toString(),
      email: normalizedEmail,
      expiresInMinutes: OTP_TTL_MINUTES,
      message: "Password reset OTP sent.",
      ok: true,
    });
  } catch (err) {
    console.error("Password reset OTP email failed:", err);
    res.status(503).json({ error: "Unable to send password reset OTP. Please check email configuration." });
  }
}

export async function resetPassword(req, res) {
  const { challengeId, email, otp, password } = req.body;
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!challengeId || !normalizedEmail || !otp || !password) {
    return res.status(400).json({ error: "Email, challenge, OTP, and new password are required." });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  try {
    const challenge = await verifyOtpChallenge({ challengeId, email: normalizedEmail, otp, purpose: "password_reset" });
    const user = await User.findById(challenge.user);
    if (!user) return res.status(401).json({ error: "User was not found." });

    user.passwordHash = await bcrypt.hash(password, 12);
    await user.save();
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Invalid OTP." });
  }
}

export async function googleAuth(req, res) {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: "Google ID Token is required." });
  if (!GOOGLE_CLIENT_ID || !googleClient) return res.status(503).json({ error: "Google sign-in is not configured." });
  if (String(idToken).startsWith("mock_")) return res.status(401).json({ error: "Invalid Google token." });

  let email, name, googleId, imageUrl = "";
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload) return res.status(400).json({ error: "Invalid Google token payload." });
    ({ email, name, sub: googleId, picture: imageUrl = "" } = payload);
  } catch (err) {
    console.error("Google token verification failed:", err);
    return res.status(401).json({ error: "Failed to verify Google token." });
  }

  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return res.status(400).json({ error: "Could not retrieve email from Google." });

  try {
    let user = await User.findOne({ email: normalizedEmail });
    if (user) {
      if (!user.googleId) user.googleId = googleId;
      if (imageUrl && !user.profile?.imageUrl) user.profile = { ...user.profile, imageUrl };
      await user.save();
    } else {
      user = await User.create({ name: name || "Google User", email: normalizedEmail, googleId, profile: { imageUrl } });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    console.error("Database error during Google auth:", err);
    res.status(500).json({ error: "Failed to authenticate with Google." });
  }
}

export function logout(req, res) {
  res.json({ ok: true });
}

export function getMe(req, res) {
  res.json({ user: publicUser(req.user) });
}
