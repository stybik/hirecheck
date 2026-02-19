/**
 * Pure DOM extraction functions for Naukri.com job listing pages.
 * Separated from content.js for testability (loaded via manifest content_scripts array).
 *
 * All functions are globals (no ES modules — classic content script).
 */

/* eslint-disable no-unused-vars */
/* globals used by content.js */

const HIRECHECK_MAX_DESCRIPTION_CHARS = 12000; // ~3000 tokens at ~4 chars/token

/**
 * Get visible text from an element.
 * Prefers innerText (respects CSS visibility) but falls back to textContent
 * for environments like jsdom where innerText is not available.
 * @param {Element} element
 * @returns {string}
 */
function hirecheck_getVisibleText(element) {
  return (element.innerText !== undefined ? element.innerText : element.textContent) || "";
}

const HIRECHECK_JOB_URL_PATTERNS = [
  /naukri\.com\/job-listings-/,
  /naukri\.com\/job\//,
];

const HIRECHECK_SELECTORS = {
  job_title: [
    ".styles_jd-header-title__rZwM1",
    ".jd-header-title",
    '[class*="jd-header-title"]',
    "h1",
  ],
  company_name: [
    ".styles_jd-header-comp-name__MvqAI a",
    ".styles_jd-header-comp-name__MvqAI",
    ".jd-header-comp-name",
    '[class*="comp-name"]',
  ],
  description: [
    ".styles_JDC__dang-inner-html__h0K4t",
    ".job-desc",
    '[class*="job-desc"]',
    '[class*="dang-inner-html"]',
  ],
  salary: [
    ".styles_jhc__salary__jdfEC",
    '[class*="jhc__salary"]',
    ".salary",
  ],
};

/**
 * Try multiple CSS selectors in order, return first match's visible text.
 * @param {string[]} selectors - CSS selectors to try in priority order
 * @param {number|null} maxLength - Optional max character length for truncation
 * @returns {string|null}
 */
function hirecheck_extractText(selectors, maxLength) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      let text = hirecheck_getVisibleText(element).trim();
      if (maxLength && text.length > maxLength) {
        text = text.substring(0, maxLength);
      }
      return text || null;
    }
  }
  return null;
}

/**
 * Extract posting date from Naukri page.
 * Strategy 1: Dedicated posted-date class elements, filtered by date text pattern.
 * Strategy 2: Stats container children, filtered by date text.
 * Strategy 3: Regex scan of page text.
 * @returns {string|null}
 */
function hirecheck_extractPostingDate() {
  // Strategy 1: Dedicated posted-date elements
  const dateSelectors = [
    '[class*="posted-date"]',
    '[class*="posted_date"]',
  ];
  for (const selector of dateSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const text = hirecheck_getVisibleText(el).trim();
      if (/posted|days?\s+ago|weeks?\s+ago|months?\s+ago|just\s+now|today/i.test(text)) {
        return text;
      }
      // Some elements have just the date like "22 Jul 2025"
      if (/\d{1,2}\s+\w{3}\s+\d{4}/.test(text)) {
        return text;
      }
    }
  }

  // Strategy 2: Look inside jd-stats container children
  const statsContainer = document.querySelector(
    '[class*="jhc__jd-stats"], [class*="jd-stats"]'
  );
  if (statsContainer) {
    const children = statsContainer.querySelectorAll("div, span, li, label");
    for (const child of children) {
      const text = hirecheck_getVisibleText(child).trim();
      if (/posted|days?\s+ago|weeks?\s+ago|months?\s+ago/i.test(text)) {
        return text;
      }
    }
  }

  // Strategy 3: Regex fallback on page text (PRD Section 8)
  const bodyText = hirecheck_getVisibleText(document.body);
  const match = bodyText.match(/posted\s+\d+\s+(?:days?|weeks?|months?)\s+ago/i);
  if (match) return match[0];

  const match2 = bodyText.match(/\d+\s+(?:days?|weeks?|months?)\s+ago/i);
  if (match2) return match2[0];

  return null;
}

/**
 * Extract salary information from Naukri page.
 * Strategy 1: CSS selectors for dedicated salary element.
 * Strategy 2: Regex fallback for LPA/lakh format (PRD Section 8).
 * @returns {string|null}
 */
function hirecheck_extractSalary() {
  // Strategy 1: CSS selectors
  const result = hirecheck_extractText(HIRECHECK_SELECTORS.salary);
  if (result) return result;

  // Strategy 2: Regex fallback (PRD Section 8)
  const bodyText = hirecheck_getVisibleText(document.body);
  const match = bodyText.match(
    /\d+\.?\d*\s*-\s*\d+\.?\d*\s*(?:LPA|Lacs?\s*P\.?A\.?|lakh)/i
  );
  if (match) return match[0];

  // "Not Disclosed" is also useful
  const ndMatch = bodyText.match(/not\s+disclosed/i);
  if (ndMatch) return ndMatch[0];

  return null;
}

/**
 * Extract requirements/key skills from Naukri page.
 * Naukri renders skills as individual <a> chip tags inside a key-skill container.
 * @returns {string|null}
 */
function hirecheck_extractRequirements() {
  const containers = [
    ".styles_key-skill__GIPn_",
    '[class*="key-skill"]',
    '[class*="skills"]',
  ];

  for (const selector of containers) {
    const container = document.querySelector(selector);
    if (!container) continue;

    // Skills are typically <a class="styles_chip__..."><span>SkillName</span></a>
    const chips = container.querySelectorAll('[class*="chip"] span');
    if (chips.length > 0) {
      return Array.from(chips)
        .map((t) => hirecheck_getVisibleText(t).trim())
        .filter(Boolean)
        .join(", ");
    }

    // Fallback: <a> tags directly
    const links = container.querySelectorAll("a");
    if (links.length > 0) {
      return Array.from(links)
        .map((a) => hirecheck_getVisibleText(a).trim())
        .filter(Boolean)
        .join(", ");
    }

    // Last resort: container text
    const text = hirecheck_getVisibleText(container).trim();
    if (text) return text;
  }

  return null;
}

/**
 * Extract all job data from the current Naukri page.
 * Returns { success, data, missing } where missing lists critical fields that couldn't be extracted.
 * @returns {{ success: boolean, data: Object|null, missing: string[] }}
 */
function hirecheck_extractJobData() {
  const data = {
    url: window.location.href,
    job_title: hirecheck_extractText(HIRECHECK_SELECTORS.job_title),
    company_name: hirecheck_extractText(HIRECHECK_SELECTORS.company_name),
    description: hirecheck_extractText(
      HIRECHECK_SELECTORS.description,
      HIRECHECK_MAX_DESCRIPTION_CHARS
    ),
    requirements: hirecheck_extractRequirements() || "",
    salary_text: hirecheck_extractSalary(),
    posting_date: hirecheck_extractPostingDate(),
    source: "dom_extraction",
  };

  // Check critical fields
  const critical = ["job_title", "company_name", "description"];
  const missing = critical.filter((f) => !data[f]);

  if (missing.length === critical.length) {
    // Total extraction failure — all 3 critical fields missing
    return { success: false, data: null, missing: critical };
  }

  // Partial failure: fill missing required fields with fallbacks
  if (!data.job_title) {
    const titlePart = document.title.split("-")[0];
    data.job_title = titlePart ? titlePart.trim() : "Unknown";
  }
  if (!data.company_name) {
    data.company_name = "Unknown";
  }
  if (!data.description) {
    // Last resort: grab main content area text
    const main = document.querySelector("main, #root, [class*='job-desc']");
    data.description = main
      ? hirecheck_getVisibleText(main).substring(0, HIRECHECK_MAX_DESCRIPTION_CHARS)
      : "";
  }

  return { success: true, data, missing };
}

/**
 * Check if the current URL is a Naukri job detail page.
 * @returns {boolean}
 */
function hirecheck_isJobDetailPage() {
  return HIRECHECK_JOB_URL_PATTERNS.some((p) => p.test(window.location.href));
}
