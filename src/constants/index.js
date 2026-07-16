export const RESERVED_HANDLES = new Set([
  "api", "portfolio", "admin", "login", "register", "dashboard",
  "resumes", "resume", "settings", "profile", "help", "templates",
  "preview", "edit", "new", "static", "assets", "favicon",
]);

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

export const EXTRACTION_PROMPT = `
You are a resume parser. Return ONLY valid JSON. No markdown, no explanation.

Extract resume data using this schema:
{
  "personalInfo": {
    "name": null,
    "title": null,
    "email": null,
    "phone": [],
    "location": null,
    "github": null,
    "linkedin": null,
    "portfolio": null,
    "imgUrl": null
  },
  "links": [],
  "summary": null,
  "skills": [
    {
      "skill_category_name": null,
      "skills_belongs_this_category": []
    }
  ],
  "experience": [
    {
      "company": null,
      "role": null,
      "type": null,
      "location": null,
      "startDate": null,
      "endDate": null,
      "current": false,
      "responsibilities": [],
      "imgUrl": null
    }
  ],
  "education": [
    {
      "degree": null,
      "institution": null,
      "startYear": null,
      "endYear": null,
      "score": null,
      "location": null,
      "imgUrl": null
    }
  ],
  "projects": [
    {
      "name": null,
      "technologies": [],
      "features": [],
      "liveUrl": null,
      "githubUrl": null,
      "imgUrl": null
    }
  ],
  "certificates": [
    {
      "name": null,
      "issuer": null,
      "link": null,
      "issueDate": null,
      "expiryDate": null,
      "credentialId": null,
      "imgUrl": null
    }
  ],
  "achievements": [
    {
      "title": null,
      "description": null,
      "date": null,
      "issuer": null,
      "category": null,
      "link": null
    }
  ]
}

Rules:
- Return valid JSON only.
- Missing string/number => null, missing array => [].
- Group skills dynamically from resume content; avoid fixed categories unless clearly implied.
- Do not duplicate skills across categories.
- current=true only if endDate is Present/Current/Ongoing.
- Extract all experience, projects, education, and certifications.
- Extract all available contact info; use null if missing.
- Infer name from email/linkedin if absent; otherwise null.
- Extract summary/objective if present; else null.
- Dates: use YYYY-MM or YYYY. If only year exists, use YYYY-01.
- imgUrl: try relevant logo/image from company/institute/linkedin context; else null.
- links: extract ALL social/professional URLs found in the resume (LeetCode, GitHub, LinkedIn, Instagram, Twitter, CodePen, Behance, Dribbble, portfolio site, etc.) as { "label": "<platform name>", "url": "<full URL>" }. Include github and linkedin here too if present. Keep labels short and human-readable (e.g. "LeetCode", "GitHub", "LinkedIn", "Portfolio").
- achievements: extract awards, honors, hackathon wins, competition rankings, recognitions, scholarships, notable accomplishments, or any standalone achievement mentioned in the resume. category should be one of: "Award", "Competition", "Recognition", "Scholarship", "Publication", "Other". If none found, return [].
- Always follow the schema exactly.
`;
