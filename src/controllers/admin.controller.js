import jwt from "jsonwebtoken";
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_JWT_SECRET } from "../config/env.js";
import { safeCompare } from "../utils/helpers.js";

export async function adminLogin(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const emailMatch = safeCompare(email.trim().toLowerCase(), ADMIN_EMAIL.toLowerCase());
  const passwordMatch = safeCompare(password, ADMIN_PASSWORD);

  if (!emailMatch || !passwordMatch) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign(
    { role: "admin", email: ADMIN_EMAIL },
    ADMIN_JWT_SECRET,
    { expiresIn: "7d" }
  );

  return res.json({
    token,
    admin: { email: ADMIN_EMAIL, role: "admin", name: "Super Admin" },
  });
}

export function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET);
    if (payload.role !== "admin") throw new Error("Not admin");
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired admin token" });
  }
}
