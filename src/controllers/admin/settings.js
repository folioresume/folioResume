import { getSettingsByCategory, setBulkSettings, getSetting, setSetting } from "../../services/settings.service.js";
import Resume from "../../models/Resume.js";

// ── Pricing ─────────────────────────────────────────────────────────────────

export async function getPricingSettings(req, res) {
  const [settings, activeCount] = await Promise.all([
    getSettingsByCategory("pricing"),
    Resume.countDocuments({ status: "active" }),
  ]);
  const limit = Number(settings["pricing.foundingUserLimit"]) || 100;
  res.json({ settings, activeCount, slotsRemaining: Math.max(0, limit - activeCount) });
}

export async function updatePricingSettings(req, res) {
  const { portfolioPrice, foundingPrice, foundingUserLimit, pricingEnabled } = req.body || {};
  const bulk = {};

  if (portfolioPrice !== undefined) bulk["pricing.portfolioPrice"] = Number(portfolioPrice) || 99;
  if (foundingPrice !== undefined) bulk["pricing.foundingPrice"] = Number(foundingPrice) || 49;
  if (foundingUserLimit !== undefined) bulk["pricing.foundingUserLimit"] = Number(foundingUserLimit) || 100;
  if (pricingEnabled !== undefined) bulk["pricing.pricingEnabled"] = Boolean(pricingEnabled);

  if (!Object.keys(bulk).length) return res.status(400).json({ error: "No fields to update." });

  await setBulkSettings(bulk, "pricing");
  res.json({ ok: true, settings: bulk });
}

// ── General ──────────────────────────────────────────────────────────────────

export async function getGeneralSettings(req, res) {
  const settings = await getSettingsByCategory("general");
  res.json({ settings });
}

export async function updateGeneralSettings(req, res) {
  const { siteName, maintenance, logoUrl, faviconUrl } = req.body || {};
  const bulk = {};
  if (siteName !== undefined) bulk["general.siteName"] = String(siteName).trim().slice(0, 100);
  if (maintenance !== undefined) bulk["general.maintenance"] = Boolean(maintenance);
  if (logoUrl !== undefined) bulk["general.logoUrl"] = String(logoUrl).trim().slice(0, 500);
  if (faviconUrl !== undefined) bulk["general.faviconUrl"] = String(faviconUrl).trim().slice(0, 500);
  await setBulkSettings(bulk, "general");
  res.json({ ok: true });
}

// ── SEO ──────────────────────────────────────────────────────────────────────

export async function getSeoSettings(req, res) {
  const settings = await getSettingsByCategory("seo");
  res.json({ settings });
}

export async function updateSeoSettings(req, res) {
  const { title, description, ogImage, robots, sitemapEnabled, gaId, searchConsoleVerification } = req.body || {};
  const bulk = {};
  if (title !== undefined) bulk["seo.title"] = String(title).trim().slice(0, 200);
  if (description !== undefined) bulk["seo.description"] = String(description).trim().slice(0, 500);
  if (ogImage !== undefined) bulk["seo.ogImage"] = String(ogImage).trim().slice(0, 500);
  if (robots !== undefined) bulk["seo.robots"] = String(robots).trim().slice(0, 100);
  if (sitemapEnabled !== undefined) bulk["seo.sitemapEnabled"] = Boolean(sitemapEnabled);
  if (gaId !== undefined) bulk["seo.gaId"] = String(gaId).trim().slice(0, 50);
  if (searchConsoleVerification !== undefined) bulk["seo.searchConsoleVerification"] = String(searchConsoleVerification).trim().slice(0, 200);
  await setBulkSettings(bulk, "seo");
  res.json({ ok: true });
}

// ── CMS ──────────────────────────────────────────────────────────────────────

const VALID_CMS_PAGES = ["privacyPolicy", "terms", "about", "faq", "contact"];

export async function getCmsPage(req, res) {
  const { page } = req.params;
  if (!VALID_CMS_PAGES.includes(page)) return res.status(400).json({ error: "Invalid page." });
  const content = await getSetting(`cms.${page}`);
  res.json({ page, content: content || "" });
}

export async function updateCmsPage(req, res) {
  const { page } = req.params;
  if (!VALID_CMS_PAGES.includes(page)) return res.status(400).json({ error: "Invalid page." });
  const { content } = req.body || {};
  if (content === undefined) return res.status(400).json({ error: "content is required." });
  await setSetting(`cms.${page}`, String(content).slice(0, 50000), "cms");
  res.json({ ok: true });
}

export async function getAllCmsPages(req, res) {
  const settings = await getSettingsByCategory("cms");
  const pages = {};
  for (const p of VALID_CMS_PAGES) pages[p] = settings[`cms.${p}`] || "";
  res.json({ pages });
}

// ── Notifications ────────────────────────────────────────────────────────────

export async function getNotificationSettings(req, res) {
  const settings = await getSettingsByCategory("notifications");
  res.json({ settings });
}

export async function updateNotificationSettings(req, res) {
  const {
    bannerEnabled, bannerMessage, bannerCtaLabel, bannerCtaUrl,
    popupEnabled, popupMessage,
    maintenanceEnabled, maintenanceMessage,
  } = req.body || {};
  const bulk = {};
  if (bannerEnabled !== undefined) bulk["notifications.bannerEnabled"] = Boolean(bannerEnabled);
  if (bannerMessage !== undefined) bulk["notifications.bannerMessage"] = String(bannerMessage).trim().slice(0, 500);
  if (bannerCtaLabel !== undefined) bulk["notifications.bannerCtaLabel"] = String(bannerCtaLabel).trim().slice(0, 100);
  if (bannerCtaUrl !== undefined) bulk["notifications.bannerCtaUrl"] = String(bannerCtaUrl).trim().slice(0, 500);
  if (popupEnabled !== undefined) bulk["notifications.popupEnabled"] = Boolean(popupEnabled);
  if (popupMessage !== undefined) bulk["notifications.popupMessage"] = String(popupMessage).trim().slice(0, 1000);
  if (maintenanceEnabled !== undefined) bulk["notifications.maintenanceEnabled"] = Boolean(maintenanceEnabled);
  if (maintenanceMessage !== undefined) bulk["notifications.maintenanceMessage"] = String(maintenanceMessage).trim().slice(0, 500);
  await setBulkSettings(bulk, "notifications");
  res.json({ ok: true });
}
