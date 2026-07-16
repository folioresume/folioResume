import { PORTFOLIO_BASE_URL } from "../config/env.js";

export function publicUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    profile: user.profile,
    freeParseCount: user.freeParseCount || 0,
    totalPublishedPortfolios: user.totalPublishedPortfolios || 0,
    createdAt: user.createdAt,
  };
}

export function publicVisit(visit = {}) {
  return {
    city: visit.city || "",
    region: visit.region || "",
    country: visit.country || "",
    timezone: visit.timezone || "",
    userAgent: visit.userAgent || "",
    referrer: visit.referrer || "",
    visitedAt: visit.visitedAt || null,
  };
}

export function publicResume(resume) {
  const id = resume._id.toString();
  const handle = resume.handle || null;
  const base = PORTFOLIO_BASE_URL.replace(/\/+$/, "");
  const portfolioUrl = handle
    ? `${base}/${handle}`
    : (() => {
        const u = new URL(PORTFOLIO_BASE_URL);
        u.searchParams.set("resumeId", id);
        return u.toString();
      })();

  return {
    id,
    handle,
    user: resume.user?.toString?.() || null,
    originalFileName: resume.originalFileName,
    fileSize: resume.fileSize,
    mimeType: resume.mimeType,
    parseStatus: resume.parseStatus,
    parseError: resume.parseError,
    parsedData: resume.parsedData,
    theme: resume.theme === "light" ? "light" : "dark",
    portfolioTotalCount: resume.portfolioTotalCount || 0,
    portfolioUniqueCount: resume.portfolioUniqueCount || 0,
    portfolioUrl: portfolioUrl.toString(),
    portfolioLastVisit: resume.portfolioLastVisit ? publicVisit(resume.portfolioLastVisit) : null,
    portfolioVisits: Array.isArray(resume.portfolioVisits)
      ? resume.portfolioVisits.map(publicVisit).reverse()
      : [],
    status: resume.status || "draft",
    publishedAt: resume.publishedAt || null,
    expiresAt: resume.expiresAt || null,
    paymentStatus: resume.paymentStatus || "unpaid",
    paymentId: resume.paymentId || null,
    orderId: resume.orderId || null,
    createdAt: resume.createdAt,
    updatedAt: resume.updatedAt,
  };
}

export function publicPortfolioData(user, resume) {
  const parsedData =
    resume?.parsedData && typeof resume.parsedData === "object" ? resume.parsedData : {};

  const personalInfo = {
    ...(parsedData.personalInfo || {}),
    name: parsedData.personalInfo?.name || user.name,
    email: parsedData.personalInfo?.email || user.email,
    title: parsedData.personalInfo?.title || user.profile?.title || null,
    phone: parsedData.personalInfo?.phone?.length
      ? parsedData.personalInfo.phone
      : user.profile?.phone
        ? [user.profile.phone]
        : [],
    location: parsedData.personalInfo?.location || user.profile?.location || null,
    linkedin: parsedData.personalInfo?.linkedin || user.profile?.linkedin || null,
    imgUrl: parsedData.personalInfo?.imgUrl || user.profile?.imageUrl || null,
  };

  const parsedLinks = Array.isArray(parsedData.links)
    ? parsedData.links.filter((l) => l && typeof l === "object" && (l.url || "").trim())
    : [];

  // All known social fields from personalInfo — used as fallbacks if AI didn't put them in links[]
  const pi = parsedData.personalInfo || {};
  const personalInfoLinks = [
    { label: "GitHub",    url: pi.github },
    { label: "LinkedIn",  url: pi.linkedin },
    { label: "Portfolio", url: pi.portfolio },
    { label: "Twitter",   url: pi.twitter },
    { label: "Instagram", url: pi.instagram },
    { label: "LeetCode",  url: pi.leetcode },
  ].filter((l) => (l.url || "").trim());

  // Deduplicate by label (case-insensitive): parsed links take priority
  const seenLabels = new Set(parsedLinks.map((l) => (l.label || "").toLowerCase().trim()).filter(Boolean));
  const mergedLinks = [
    ...parsedLinks,
    ...personalInfoLinks.filter((l) => !seenLabels.has(l.label.toLowerCase())),
  ];

  return {
    personalInfo,
    theme: resume?.theme === "light" ? "light" : "dark",
    links: mergedLinks,
    summary: parsedData.summary || user.profile?.summary || null,
    skills: parsedData.skills || [
      {
        skill_category_name: "Competencies",
        skills_belongs_this_category: user.profile?.competencies || [],
      },
    ],
    experience: parsedData.experience || [],
    education: parsedData.education || [],
    projects: parsedData.projects || [],
    certificates: parsedData.certificates || [],
    achievements: parsedData.achievements || [],
  };
}
