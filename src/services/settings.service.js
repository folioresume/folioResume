import SiteSettings from "../models/SiteSettings.js";
import {
  PORTFOLIO_PRICE,
  FOUNDING_PRICE,
  FOUNDING_USER_LIMIT,
} from "../config/env.js";

const DEFAULTS = {
  "pricing.portfolioPrice": PORTFOLIO_PRICE,
  "pricing.foundingPrice": FOUNDING_PRICE,
  "pricing.foundingUserLimit": FOUNDING_USER_LIMIT,
  "pricing.pricingEnabled": true,
  "general.siteName": "FolioResume",
  "general.maintenance": false,
  "general.logoUrl": "",
  "general.faviconUrl": "",
  "seo.title": "FolioResume — Build Your Portfolio",
  "seo.description": "AI-powered resume parsing and portfolio builder.",
  "seo.ogImage": "",
  "seo.robots": "index, follow",
  "seo.sitemapEnabled": true,
  "seo.gaId": "",
  "seo.searchConsoleVerification": "",
  "cms.privacyPolicy": "",
  "cms.terms": "",
  "cms.about": "",
  "cms.faq": "",
  "cms.contact": "",
  "notifications.bannerEnabled": false,
  "notifications.bannerMessage": "",
  "notifications.bannerCtaLabel": "",
  "notifications.bannerCtaUrl": "",
  "notifications.popupEnabled": false,
  "notifications.popupMessage": "",
  "notifications.maintenanceEnabled": false,
  "notifications.maintenanceMessage": "Site is under maintenance. Back soon!",
};

// Simple in-process cache (5-min TTL)
const cache = new Map();
const TTL = 5 * 60 * 1000;

function fromCache(key) {
  const entry = cache.get(key);
  if (entry && entry.exp > Date.now()) return { hit: true, value: entry.value };
  return { hit: false };
}

function toCache(key, value) {
  cache.set(key, { value, exp: Date.now() + TTL });
}

export function invalidateCache(...keys) {
  if (keys.length === 0) cache.clear();
  else keys.forEach((k) => cache.delete(k));
}

export async function getSetting(key) {
  const cached = fromCache(key);
  if (cached.hit) return cached.value;

  const doc = await SiteSettings.findOne({ key }).select("value").lean();
  const value = doc != null ? doc.value : (DEFAULTS[key] ?? null);
  toCache(key, value);
  return value;
}

export async function setSetting(key, value, category = "general") {
  await SiteSettings.findOneAndUpdate(
    { key },
    { $set: { key, value, category } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  cache.delete(key);
}

export async function getSettingsByCategory(category) {
  const docs = await SiteSettings.find({ category }).select("key value").lean();
  const result = {};
  for (const doc of docs) result[doc.key] = doc.value;

  // Fill defaults for keys not yet saved
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (k.startsWith(`${category}.`) && !(k in result)) result[k] = def;
  }
  return result;
}

export async function setBulkSettings(settings, category) {
  const ops = Object.entries(settings).map(([key, value]) => ({
    updateOne: {
      filter: { key },
      update: { $set: { key, value, category } },
      upsert: true,
    },
  }));
  if (ops.length) await SiteSettings.bulkWrite(ops);
  Object.keys(settings).forEach((k) => cache.delete(k));
}

export async function getPricingConfig() {
  const [portfolioPrice, foundingPrice, foundingUserLimit, pricingEnabled] = await Promise.all([
    getSetting("pricing.portfolioPrice"),
    getSetting("pricing.foundingPrice"),
    getSetting("pricing.foundingUserLimit"),
    getSetting("pricing.pricingEnabled"),
  ]);
  return {
    portfolioPrice: Number(portfolioPrice) || PORTFOLIO_PRICE,
    foundingPrice: Number(foundingPrice) || FOUNDING_PRICE,
    foundingUserLimit: Number(foundingUserLimit) || FOUNDING_USER_LIMIT,
    pricingEnabled: Boolean(pricingEnabled),
  };
}
