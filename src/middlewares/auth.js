import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { JWT_SECRET } from "../config/env.js";

export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Authentication required." });

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) return res.status(401).json({ error: "Session user was not found." });

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session." });
  }
}

export async function optionalAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(payload.sub);
      if (user) req.user = user;
    }
  } catch {
    // Proceed without auth — optional.
  }
  next();
}
