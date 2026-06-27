import { publicUser } from "../utils/formatters.js";

export function getProfile(req, res) {
  res.json({ user: publicUser(req.user) });
}

export async function updateProfile(req, res) {
  const { name, profile = {} } = req.body;

  if (typeof name === "string" && name.trim()) {
    req.user.name = name.trim();
  }

  req.user.profile = {
    ...req.user.profile,
    ...profile,
    competencies: Array.isArray(profile.competencies)
      ? profile.competencies.map(String).filter(Boolean)
      : req.user.profile.competencies,
  };

  await req.user.save();
  res.json({ user: publicUser(req.user) });
}
