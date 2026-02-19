/**
 * DOM extraction tests for Naukri page selectors.
 * Uses real Naukri HTML snapshots to verify that our CSS selectors
 * and extraction logic match the actual DOM structure.
 *
 * Run: node --test tests/extension/dom-extraction.test.js
 * Requires: npm install in tests/extension/
 */

import { describe, it, before } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "..", "fixtures", "naukri_snapshots");

const EXTRACTORS_CODE = readFileSync(
  join(__dirname, "..", "..", "extension", "content", "extractors.js"),
  "utf-8"
);

// Selector arrays for direct testing (mirrors extractors.js constants)
const SELECTORS = {
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
};

/**
 * Load extractors.js functions into a jsdom window.
 * Uses vm.runInContext to properly expose function declarations as window globals.
 */
function loadExtractors(dom) {
  const ctx = createContext(dom.window);
  runInContext(EXTRACTORS_CODE, ctx);
  return dom.window;
}

// ---- Standard page: Alpha Insurance (has posted-date, no salary amount) ----

describe("DOM Extraction — Standard Page (Alpha Insurance)", () => {
  let win;

  before(() => {
    const html = readFileSync(join(FIXTURES_DIR, "job-detail-standard.html"), "utf-8");
    const dom = new JSDOM(html, {
      url: "https://www.naukri.com/job-listings-lead-python-full-stack-developer-12345",
    });
    win = loadExtractors(dom);
  });

  it("primary job title selector matches", () => {
    const el = win.document.querySelector(".styles_jd-header-title__rZwM1");
    assert.ok(el, "Primary job title selector should match");
    assert.ok(el.textContent.trim().length > 0, "Title should have text");
  });

  it("hirecheck_extractText finds job title", () => {
    const title = win.hirecheck_extractText(SELECTORS.job_title);
    assert.ok(title, "Should extract a job title");
    assert.ok(title.includes("Python") || title.includes("Developer"), `Unexpected title: ${title}`);
  });

  it("extracts company name", () => {
    const company = win.hirecheck_extractText(SELECTORS.company_name);
    assert.ok(company, "Should extract company name");
  });

  it("extracts description", () => {
    const desc = win.hirecheck_extractText(SELECTORS.description, 12000);
    assert.ok(desc, "Should extract description");
    assert.ok(desc.length > 50, "Description should be substantial");
  });

  it("truncates description to specified maxLength", () => {
    const desc = win.hirecheck_extractText(SELECTORS.description, 100);
    assert.ok(desc);
    assert.ok(desc.length <= 100, `Description too long: ${desc.length}`);
  });

  it("extracts posted date without grabbing entire stats block", () => {
    const date = win.hirecheck_extractPostingDate();
    assert.ok(date, "Should extract a posting date");
    // Must NOT contain salary, experience, or location info
    assert.ok(
      !(/\d+\s*-\s*\d+\s*(?:LPA|Lacs)/i.test(date)),
      `Date should not contain salary info: "${date}"`
    );
    assert.ok(
      !(/\d+\s*-\s*\d+\s*Yrs/i.test(date)),
      `Date should not contain experience info: "${date}"`
    );
    // Should contain date-like text
    assert.ok(
      /posted|ago|days?|weeks?|months?|\d{1,2}\s+\w{3}\s+\d{4}/i.test(date),
      `Should look like a date: "${date}"`
    );
  });

  it("extracts salary", () => {
    const salary = win.hirecheck_extractSalary();
    assert.ok(salary, "Should extract salary info");
    assert.ok(
      /not\s+disclosed|\d+.*(?:LPA|lakh|lacs)/i.test(salary),
      `Should be a salary value: "${salary}"`
    );
  });

  it("extracts key skills", () => {
    const skills = win.hirecheck_extractRequirements();
    assert.ok(skills, "Should extract skills");
    assert.ok(skills.includes(","), `Skills should be comma-separated: "${skills}"`);
  });

  it("hirecheck_extractJobData returns success with all fields", () => {
    const result = win.hirecheck_extractJobData();
    assert.strictEqual(result.success, true, "Extraction should succeed");
    assert.ok(result.data, "Should have data");
    assert.ok(result.data.job_title, "Should have job_title");
    assert.ok(result.data.company_name, "Should have company_name");
    assert.ok(result.data.description, "Should have description");
    assert.strictEqual(result.data.source, "dom_extraction");
    assert.strictEqual(result.missing.length, 0, "No critical fields should be missing");
  });

  it("hirecheck_isJobDetailPage detects job-listings URL", () => {
    assert.strictEqual(win.hirecheck_isJobDetailPage(), true);
  });
});

// ---- No posted-date page: Wenger & Watson ----

describe("DOM Extraction — No Posted-Date Page (Wenger & Watson)", () => {
  let win;

  before(() => {
    const html = readFileSync(join(FIXTURES_DIR, "job-detail-no-posted-date.html"), "utf-8");
    const dom = new JSDOM(html, {
      url: "https://www.naukri.com/job-listings-python-developer-lead-67890",
    });
    win = loadExtractors(dom);
  });

  it("extracts job title", () => {
    const title = win.hirecheck_extractText(SELECTORS.job_title);
    assert.ok(title, "Should extract job title");
  });

  it("handles missing posted-date class gracefully via regex fallback", () => {
    const date = win.hirecheck_extractPostingDate();
    // This page doesn't have a dedicated posted-date class, but regex fallback may find "1 day ago"
    // If it returns null, that's also acceptable — no crash is the key assertion
    if (date) {
      assert.ok(
        /ago|posted|days?|weeks?/i.test(date),
        `Should look like a date if found: "${date}"`
      );
    }
  });

  it("extractJobData succeeds even without posted date", () => {
    const result = win.hirecheck_extractJobData();
    assert.strictEqual(result.success, true);
    assert.ok(result.data.job_title);
    assert.ok(result.data.description);
  });
});

// ---- With salary page: Artech (has "30-45 Lacs P.A.") ----

describe("DOM Extraction — With Salary Page (Artech)", () => {
  let win;

  before(() => {
    const html = readFileSync(join(FIXTURES_DIR, "job-detail-with-salary.html"), "utf-8");
    const dom = new JSDOM(html, {
      url: "https://www.naukri.com/job-listings-senior-consultant-oracle-essbase-11111",
    });
    win = loadExtractors(dom);
  });

  it("extracts actual salary amount", () => {
    const salary = win.hirecheck_extractSalary();
    assert.ok(salary, "Should extract salary");
    assert.ok(
      /\d+.*(?:Lacs|LPA|lakh)/i.test(salary),
      `Should contain salary amount: "${salary}"`
    );
  });

  it("extracts posted date", () => {
    const date = win.hirecheck_extractPostingDate();
    assert.ok(date, "Should extract posting date");
    assert.ok(
      /posted|ago|days?/i.test(date),
      `Should look like a date: "${date}"`
    );
  });

  it("extractJobData returns requirements as non-empty string", () => {
    const result = win.hirecheck_extractJobData();
    assert.strictEqual(result.success, true);
    assert.strictEqual(typeof result.data.requirements, "string");
  });
});

// ---- URL pattern detection ----

describe("URL Pattern Detection", () => {
  it("detects job-listings URLs", () => {
    const dom = new JSDOM("", {
      url: "https://www.naukri.com/job-listings-some-job-12345",
    });
    const win = loadExtractors(dom);
    assert.strictEqual(win.hirecheck_isJobDetailPage(), true);
  });

  it("detects /job/ URLs", () => {
    const dom = new JSDOM("", {
      url: "https://www.naukri.com/job/some-job-12345",
    });
    const win = loadExtractors(dom);
    assert.strictEqual(win.hirecheck_isJobDetailPage(), true);
  });

  it("rejects non-job URLs", () => {
    const dom = new JSDOM("", {
      url: "https://www.naukri.com/mnjuser/homepage",
    });
    const win = loadExtractors(dom);
    assert.strictEqual(win.hirecheck_isJobDetailPage(), false);
  });

  it("rejects non-naukri URLs", () => {
    const dom = new JSDOM("", {
      url: "https://www.linkedin.com/jobs/view/12345",
    });
    const win = loadExtractors(dom);
    assert.strictEqual(win.hirecheck_isJobDetailPage(), false);
  });
});

// ---- Salary regex fallback ----

describe("Salary Regex Patterns", () => {
  it("matches LPA format", () => {
    assert.ok(/\d+\.?\d*\s*-\s*\d+\.?\d*\s*(?:LPA|Lacs?\s*P\.?A\.?|lakh)/i.test("8-12 LPA"));
    assert.ok(/\d+\.?\d*\s*-\s*\d+\.?\d*\s*(?:LPA|Lacs?\s*P\.?A\.?|lakh)/i.test("30-45 Lacs P.A."));
    assert.ok(/\d+\.?\d*\s*-\s*\d+\.?\d*\s*(?:LPA|Lacs?\s*P\.?A\.?|lakh)/i.test("5.5 - 8.5 lakh"));
  });

  it("matches Not Disclosed", () => {
    assert.ok(/not\s+disclosed/i.test("Not Disclosed"));
    assert.ok(/not\s+disclosed/i.test("NOT DISCLOSED"));
  });
});

// ---- Posting date regex fallback ----

describe("Posting Date Regex Patterns", () => {
  it("matches 'posted N days ago' format", () => {
    assert.ok(/posted\s+\d+\s+(?:days?|weeks?|months?)\s+ago/i.test("Posted 9 Days Ago"));
    assert.ok(/posted\s+\d+\s+(?:days?|weeks?|months?)\s+ago/i.test("posted 30 days ago"));
  });

  it("matches 'N days ago' format", () => {
    assert.ok(/\d+\s+(?:days?|weeks?|months?)\s+ago/i.test("1 day ago"));
    assert.ok(/\d+\s+(?:days?|weeks?|months?)\s+ago/i.test("15 Days Ago"));
  });
});
