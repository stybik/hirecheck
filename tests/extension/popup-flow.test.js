/**
 * Popup UI rendering and flow tests.
 * Tests showResults(), showRateLimit(), showError(), showLoading(), hideAllSections(),
 * runAnalysis() response routing, and the content.js extractData message listener.
 *
 * Run: node --test tests/extension/popup-flow.test.js
 * Requires: npm install in tests/extension/
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const POPUP_HTML = readFileSync(join(ROOT, "extension/popup/popup.html"), "utf-8");
const POPUP_JS = readFileSync(join(ROOT, "extension/popup/popup.js"), "utf-8");
const EXTRACTORS_CODE = readFileSync(join(ROOT, "extension/content/extractors.js"), "utf-8");
const CONTENT_CODE = readFileSync(join(ROOT, "extension/content/content.js"), "utf-8");

const MOCK_RESULT = {
  ghost_score: 72,
  recommendation: "likely_fake",
  red_flags: [
    { signal: "Vague description", severity: "high", explanation: "Too generic." },
    { signal: "No salary range", severity: "medium", explanation: "Common ghost job signal." },
  ],
  category_scores: {
    ghost_signals: 85,
    scam_signals: 40,
    toxic_culture: 90,
    market_reality: 55,
  },
  signals_checked: 12,
  was_cached: false,
  analyses_today: 3,
  daily_limit: 5,
  analyzed_at: "2026-02-20T10:30:00Z",
};

const MOCK_RESULT_WITH_ID = {
  ...MOCK_RESULT,
  analysis_id: "test-uuid-1234",
};

const MOCK_JOB_DATA = {
  url: "",
  job_title: "Test Job",
  company_name: "Test Co",
  description: "Some description",
  requirements: "",
  salary_text: null,
  posting_date: null,
  source: "manual_paste",
};

/**
 * Create a fresh jsdom + popup.js context for each test.
 * DOMContentLoaded is NOT fired — tests call rendering functions directly.
 *
 * Uses an explicit sandbox so `document` and other DOM globals are available
 * at the top level of popup.js (which calls document.addEventListener immediately).
 * jsdom exposes `document` via prototype, not as an own property, so
 * createContext(dom.window) alone would not expose it as a VM global.
 *
 * @param {Object} chromeRuntime - Overrides for chrome.runtime properties
 */
function buildPopupContext(chromeRuntime = {}) {
  const dom = new JSDOM(POPUP_HTML, { runScripts: "outside-only" });
  const win = dom.window;

  const chromeMock = {
    runtime: {
      sendMessage: async () => MOCK_RESULT,
      ...chromeRuntime,
    },
    tabs: {
      query: async () => [{ url: "https://www.google.com", id: 1 }],
      sendMessage: async () => null,
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
  };

  // Build explicit sandbox. document must be an own property for it to
  // be accessible as a global in the VM context at script load time.
  const sandbox = createContext({
    document: win.document,
    console,
    chrome: chromeMock,
    // Web Crypto needed by sha256Hex in initPopup
    crypto: win.crypto || globalThis.crypto,
    TextEncoder: win.TextEncoder || TextEncoder,
    // JS builtins popup.js uses
    parseInt,
    Math,
    Object,
    Array,
    Date,
    JSON,
    Promise,
    setTimeout: (...args) => win.setTimeout(...args),
    clearTimeout: (...args) => win.clearTimeout(...args),
  });

  runInContext(POPUP_JS, sandbox);

  // Return sandbox as `window` — function declarations land on sandbox, not win.
  // Return win.document for DOM assertions (same object as sandbox.document).
  return { window: sandbox, document: win.document };
}

// ---------------------------------------------------------------------------
// showResults()
// ---------------------------------------------------------------------------

describe("showResults() — section visibility", () => {
  it("shows results section", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    assert.ok(!document.getElementById("results").classList.contains("hidden"));
  });

  it("hides loading, error, and rate-limit sections", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    assert.ok(document.getElementById("loading").classList.contains("hidden"));
    assert.ok(document.getElementById("error").classList.contains("hidden"));
    assert.ok(document.getElementById("rate-limit").classList.contains("hidden"));
  });

  it("keeps manual-paste visible after showing results", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    assert.ok(!document.getElementById("manual-paste").classList.contains("hidden"));
  });
});

describe("showResults() — score display", () => {
  it("sets score value text", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    assert.strictEqual(document.getElementById("score-value").textContent, "72");
  });

  it("colors score red for ghost_score > 60", () => {
    const { window, document } = buildPopupContext();
    window.showResults({ ...MOCK_RESULT, ghost_score: 75 });
    // jsdom normalizes inline hex colors to rgb(r,g,b) format
    assert.ok(
      ["#dc2626", "rgb(220, 38, 38)"].includes(document.getElementById("score-value").style.color),
      "Score should be red"
    );
  });

  it("colors score amber for ghost_score 31–60", () => {
    const { window, document } = buildPopupContext();
    window.showResults({ ...MOCK_RESULT, ghost_score: 50 });
    assert.ok(
      ["#ca8a04", "rgb(202, 138, 4)"].includes(document.getElementById("score-value").style.color),
      "Score should be amber"
    );
  });

  it("colors score green for ghost_score <= 30", () => {
    const { window, document } = buildPopupContext();
    window.showResults({ ...MOCK_RESULT, ghost_score: 20 });
    assert.ok(
      ["#16a34a", "rgb(22, 163, 74)"].includes(document.getElementById("score-value").style.color),
      "Score should be green"
    );
  });

  it("shows cached badge when was_cached is true", () => {
    const { window, document } = buildPopupContext();
    window.showResults({ ...MOCK_RESULT, was_cached: true });
    assert.ok(!document.getElementById("cached-badge").classList.contains("hidden"));
  });

  it("hides cached badge when was_cached is false", () => {
    const { window, document } = buildPopupContext();
    window.showResults({ ...MOCK_RESULT, was_cached: false });
    assert.ok(document.getElementById("cached-badge").classList.contains("hidden"));
  });
});

describe("showResults() — recommendation badge", () => {
  it("shows 'Likely Fake' with red class for likely_fake", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    const recEl = document.getElementById("recommendation");
    assert.ok(recEl.classList.contains("red"));
    assert.ok(recEl.textContent.includes("Likely Fake"));
  });

  it("shows green class for apply_confidently", () => {
    const { window, document } = buildPopupContext();
    window.showResults({ ...MOCK_RESULT, ghost_score: 15, recommendation: "apply_confidently" });
    assert.ok(document.getElementById("recommendation").classList.contains("green"));
  });

  it("shows yellow class for apply_with_caution", () => {
    const { window, document } = buildPopupContext();
    window.showResults({ ...MOCK_RESULT, ghost_score: 45, recommendation: "apply_with_caution" });
    assert.ok(document.getElementById("recommendation").classList.contains("yellow"));
  });
});

describe("showResults() — signals, red flags, category bars", () => {
  it("shows signals_checked count in signals-meta", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    const meta = document.getElementById("signals-meta");
    assert.ok(!meta.classList.contains("hidden"));
    assert.ok(meta.textContent.includes("12"));
  });

  it("renders correct number of red flag items", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    const items = document.querySelectorAll(".red-flag-item");
    assert.strictEqual(items.length, 2);
  });

  it("applies correct severity class to red flag items", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    const items = document.querySelectorAll(".red-flag-item");
    assert.ok(items[0].classList.contains("high"));
    assert.ok(items[1].classList.contains("medium"));
  });

  it("renders 4 category score bars", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    assert.strictEqual(document.querySelectorAll(".category-item").length, 4);
  });

  it("sets bar width as percentage matching the category score", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT);
    // ghost_signals: 85 → first bar should be "85%"
    const bars = document.querySelectorAll(".cat-bar");
    assert.strictEqual(bars[0].style.width, "85%");
  });

  it("shows remaining analyses count in usage info", () => {
    const { window, document } = buildPopupContext();
    window.showResults({ ...MOCK_RESULT, analyses_today: 3, daily_limit: 5 });
    const usage = document.getElementById("usage-info");
    assert.ok(!usage.classList.contains("hidden"));
    assert.ok(usage.textContent.includes("2 of 5"));
  });
});

// ---------------------------------------------------------------------------
// showRateLimit()
// ---------------------------------------------------------------------------

describe("showRateLimit()", () => {
  it("shows rate-limit section and hides results and error", () => {
    const { window, document } = buildPopupContext();
    window.showRateLimit({ daily_limit: 5, reset_at: null });
    assert.ok(!document.getElementById("rate-limit").classList.contains("hidden"));
    assert.ok(document.getElementById("results").classList.contains("hidden"));
    assert.ok(document.getElementById("error").classList.contains("hidden"));
  });

  it("shows correct daily limit count in message", () => {
    const { window, document } = buildPopupContext();
    window.showRateLimit({ daily_limit: 5, reset_at: null });
    assert.ok(document.getElementById("rate-limit-msg").textContent.includes("5"));
  });

  it("shows midnight fallback when reset_at is null", () => {
    const { window, document } = buildPopupContext();
    window.showRateLimit({ daily_limit: 5, reset_at: null });
    assert.ok(document.getElementById("rate-limit-reset").textContent.includes("midnight"));
  });

  it("formats reset time from ISO string when reset_at is provided", () => {
    const { window, document } = buildPopupContext();
    window.showRateLimit({ daily_limit: 5, reset_at: "2026-02-21T00:00:00Z" });
    const resetText = document.getElementById("rate-limit-reset").textContent;
    assert.ok(resetText.length > 0);
    assert.ok(!resetText.includes("undefined"));
    assert.ok(!resetText.includes("midnight")); // Should show actual time
  });

  it("keeps manual-paste visible after rate limit", () => {
    const { window, document } = buildPopupContext();
    window.showRateLimit({ daily_limit: 5, reset_at: null });
    assert.ok(!document.getElementById("manual-paste").classList.contains("hidden"));
  });
});

// ---------------------------------------------------------------------------
// showError() / showLoading() / hideAllSections()
// ---------------------------------------------------------------------------

describe("showError()", () => {
  it("shows error section with correct message text", () => {
    const { window, document } = buildPopupContext();
    window.showError("Network failure — check your connection.");
    assert.ok(!document.getElementById("error").classList.contains("hidden"));
    assert.strictEqual(
      document.getElementById("error-message").textContent,
      "Network failure — check your connection."
    );
  });

  it("hides results, loading, and rate-limit when showing error", () => {
    const { window, document } = buildPopupContext();
    window.showError("Something failed");
    assert.ok(document.getElementById("results").classList.contains("hidden"));
    assert.ok(document.getElementById("loading").classList.contains("hidden"));
    assert.ok(document.getElementById("rate-limit").classList.contains("hidden"));
  });
});

describe("showLoading()", () => {
  it("shows loading section and hides results and error", () => {
    const { window, document } = buildPopupContext();
    window.showLoading();
    assert.ok(!document.getElementById("loading").classList.contains("hidden"));
    assert.ok(document.getElementById("results").classList.contains("hidden"));
    assert.ok(document.getElementById("error").classList.contains("hidden"));
  });
});

describe("hideAllSections()", () => {
  it("hides all sections including rate-limit, analyze-page-section, and history-section", () => {
    const { window, document } = buildPopupContext();
    // Show several sections first
    document.getElementById("results").classList.remove("hidden");
    document.getElementById("rate-limit").classList.remove("hidden");
    document.getElementById("analyze-page-section").classList.remove("hidden");
    document.getElementById("history-section").classList.remove("hidden");

    window.hideAllSections();

    for (const id of ["results", "loading", "error", "manual-paste", "analyze-page-section", "rate-limit", "history-section"]) {
      assert.ok(document.getElementById(id).classList.contains("hidden"), `${id} should be hidden`);
    }
  });
});

// ---------------------------------------------------------------------------
// runAnalysis() — response routing
// ---------------------------------------------------------------------------

describe("runAnalysis() response routing", () => {
  it("routes rate_limit errorType to showRateLimit (rate-limit section shown)", async () => {
    const { window, document } = buildPopupContext({
      sendMessage: async () => ({
        error: "Daily limit reached",
        errorType: "rate_limit",
        daily_limit: 5,
        reset_at: "2026-02-21T00:00:00Z",
      }),
    });

    await window.runAnalysis(MOCK_JOB_DATA);

    assert.ok(!document.getElementById("rate-limit").classList.contains("hidden"), "rate-limit section should be visible");
    assert.ok(document.getElementById("results").classList.contains("hidden"), "results should be hidden");
  });

  it("calls showResults on successful API response", async () => {
    const { window, document } = buildPopupContext({
      sendMessage: async () => MOCK_RESULT,
    });

    await window.runAnalysis(MOCK_JOB_DATA);

    assert.ok(!document.getElementById("results").classList.contains("hidden"), "results section should be visible");
    assert.strictEqual(document.getElementById("score-value").textContent, "72");
  });

  it("calls showError on non-rate-limit error response", async () => {
    const { window, document } = buildPopupContext({
      sendMessage: async () => ({
        error: "Analysis temporarily unavailable.",
        errorType: "unavailable",
      }),
    });

    await window.runAnalysis(MOCK_JOB_DATA);

    assert.ok(!document.getElementById("error").classList.contains("hidden"), "error section should be visible");
  });
});

// ---------------------------------------------------------------------------
// showError() — retry button
// ---------------------------------------------------------------------------

describe("showError() — retry button", () => {
  it("keeps retry button visible inside the error section", () => {
    const { window, document } = buildPopupContext();
    window.showError("Oops");
    // retry-btn lives inside #error; hideAllSections only hides the section,
    // not child elements directly.
    assert.ok(!document.getElementById("error").classList.contains("hidden"), "error section should be visible");
    assert.ok(!document.getElementById("retry-btn").classList.contains("hidden"), "retry button should be accessible");
  });
});

// ---------------------------------------------------------------------------
// initPopup() — tab detection
// ---------------------------------------------------------------------------

/**
 * Build a popup context with configurable tabs and storage mocks.
 * Used by initPopup() tests that need to simulate specific tab URLs.
 */
function buildPopupContextWithTabs({ tabUrl = "https://www.google.com", storageEntry = {} } = {}) {
  const dom = new JSDOM(POPUP_HTML, { runScripts: "outside-only" });
  const win = dom.window;

  const chromeMock = {
    runtime: {
      sendMessage: async () => MOCK_RESULT,
    },
    tabs: {
      query: async () => [{ url: tabUrl, id: 1 }],
      sendMessage: async () => null,
    },
    storage: {
      local: {
        get: async () => storageEntry,
        set: async () => {},
      },
    },
  };

  const sandbox = createContext({
    document: win.document,
    console,
    chrome: chromeMock,
    // Use Node.js globalThis.crypto — win.crypto exists in jsdom but its
    // subtle.digest fails when called from a VM context. globalThis.crypto
    // (Node.js 19+) has a fully working subtle API.
    crypto: globalThis.crypto,
    TextEncoder: win.TextEncoder || TextEncoder,
    parseInt,
    Math,
    Object,
    Array,
    Date,
    JSON,
    Promise,
    setTimeout: (...args) => win.setTimeout(...args),
    clearTimeout: (...args) => win.clearTimeout(...args),
  });

  runInContext(POPUP_JS, sandbox);
  return { window: sandbox, document: win.document };
}

describe("initPopup() — tab detection", () => {
  it("shows analyze-page-section on Naukri job-listings URL with no cached result", async () => {
    const { window, document } = buildPopupContextWithTabs({
      tabUrl: "https://www.naukri.com/job-listings-software-engineer-12345",
    });
    await window.initPopup();
    assert.ok(
      !document.getElementById("analyze-page-section").classList.contains("hidden"),
      "analyze-page-section should be visible on a Naukri job page"
    );
  });

  it("does not show analyze-page-section on a non-Naukri URL", async () => {
    const { window, document } = buildPopupContextWithTabs({
      tabUrl: "https://www.linkedin.com/jobs/view/12345",
    });
    await window.initPopup();
    assert.ok(
      document.getElementById("analyze-page-section").classList.contains("hidden"),
      "analyze-page-section should stay hidden on non-Naukri pages"
    );
  });
});

// ---------------------------------------------------------------------------
// analyzePageBtn — click flow
// ---------------------------------------------------------------------------

describe("analyzePageBtn — click sends extractData to content script", () => {
  it("calls chrome.tabs.sendMessage with extractData action on button click", async () => {
    const dom = new JSDOM(POPUP_HTML, { runScripts: "outside-only" });
    const win = dom.window;

    let capturedTabMessage = null;
    const chromeMock = {
      runtime: {
        sendMessage: async () => MOCK_RESULT,
      },
      tabs: {
        query: async () => [{ url: "https://www.naukri.com/job-listings-engineer", id: 42 }],
        sendMessage: async (tabId, msg) => {
          capturedTabMessage = { tabId, msg };
          return { success: true, data: MOCK_JOB_DATA };
        },
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {},
        },
      },
    };

    const sandbox = createContext({
      document: win.document,
      console,
      chrome: chromeMock,
      crypto: win.crypto || globalThis.crypto,
      TextEncoder: win.TextEncoder || TextEncoder,
      parseInt,
      Math,
      Object,
      Array,
      Date,
      JSON,
      Promise,
      setTimeout: (...args) => win.setTimeout(...args),
      clearTimeout: (...args) => win.clearTimeout(...args),
    });

    runInContext(POPUP_JS, sandbox);

    // Fire DOMContentLoaded so the click handler is registered
    win.document.dispatchEvent(new win.Event("DOMContentLoaded"));

    // Manually show the analyze-page-section (as initPopup would on a Naukri page)
    win.document.getElementById("analyze-page-section").classList.remove("hidden");

    // Click the analyze page button
    win.document.getElementById("analyze-page-btn").dispatchEvent(new win.Event("click"));

    // Allow async click handler to run
    await new Promise((r) => win.setTimeout(r, 50));

    assert.ok(capturedTabMessage !== null, "sendMessage to tab should have been called");
    assert.strictEqual(capturedTabMessage.tabId, 42, "should target the correct tab");
    assert.strictEqual(capturedTabMessage.msg.action, "extractData", "message action should be extractData");
  });
});

// ---------------------------------------------------------------------------
// content.js extractData message listener
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Feedback UI
// ---------------------------------------------------------------------------

describe("showResults() — feedback section", () => {
  it("shows feedback-section when showResults has analysis_id", () => {
    const { window, document } = buildPopupContext();
    window.showResults(MOCK_RESULT_WITH_ID);
    assert.ok(
      !document.getElementById("feedback-section").classList.contains("hidden"),
      "feedback-section should be visible"
    );
  });

  it("hides feedback-section when showResults has no analysis_id", () => {
    const { window, document } = buildPopupContext();
    window.showResults({ ...MOCK_RESULT }); // no analysis_id
    assert.ok(
      document.getElementById("feedback-section").classList.contains("hidden"),
      "feedback-section should be hidden"
    );
  });

  it("disables both buttons on feedback click", async () => {
    const { window, document } = buildPopupContext({
      sendMessage: async (msg) => {
        if (msg.action === "submitFeedback") return { success: true };
        return MOCK_RESULT_WITH_ID;
      },
    });

    window.showResults(MOCK_RESULT_WITH_ID);

    // Fire DOMContentLoaded to register click handlers
    document.dispatchEvent(new (document.defaultView.Event)("DOMContentLoaded"));

    const realBtn = document.getElementById("feedback-real");
    realBtn.dispatchEvent(new (document.defaultView.Event)("click"));

    // Allow async handler to run
    await new Promise((r) => setTimeout(r, 50));

    assert.ok(realBtn.disabled, "clicked button should be disabled");
    assert.ok(document.getElementById("feedback-fake").disabled, "other button should be disabled");
  });

  it("adds selected class to clicked button", async () => {
    const { window, document } = buildPopupContext({
      sendMessage: async (msg) => {
        if (msg.action === "submitFeedback") return { success: true };
        return MOCK_RESULT_WITH_ID;
      },
    });

    window.showResults(MOCK_RESULT_WITH_ID);
    document.dispatchEvent(new (document.defaultView.Event)("DOMContentLoaded"));

    const fakeBtn = document.getElementById("feedback-fake");
    fakeBtn.dispatchEvent(new (document.defaultView.Event)("click"));

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(fakeBtn.classList.contains("selected"), "clicked button should have selected class");
  });

  it("sends submitFeedback message with correct data", async () => {
    let capturedMessage = null;
    const { window, document } = buildPopupContext({
      sendMessage: async (msg) => {
        capturedMessage = msg;
        if (msg.action === "submitFeedback") return { success: true };
        return MOCK_RESULT_WITH_ID;
      },
    });

    window.showResults(MOCK_RESULT_WITH_ID);
    document.dispatchEvent(new (document.defaultView.Event)("DOMContentLoaded"));

    const realBtn = document.getElementById("feedback-real");
    realBtn.dispatchEvent(new (document.defaultView.Event)("click"));

    await new Promise((r) => setTimeout(r, 50));

    assert.ok(capturedMessage !== null, "sendMessage should have been called");
    assert.strictEqual(capturedMessage.action, "submitFeedback");
    assert.strictEqual(capturedMessage.data.analysis_id, "test-uuid-1234");
    assert.strictEqual(capturedMessage.data.feedback_type, "confirmed_real");
  });

  it("shows success toast on successful feedback", async () => {
    const { window, document } = buildPopupContext({
      sendMessage: async (msg) => {
        if (msg.action === "submitFeedback") return { success: true };
        return MOCK_RESULT_WITH_ID;
      },
    });

    window.showResults(MOCK_RESULT_WITH_ID);
    document.dispatchEvent(new (document.defaultView.Event)("DOMContentLoaded"));

    const realBtn = document.getElementById("feedback-real");
    realBtn.dispatchEvent(new (document.defaultView.Event)("click"));

    await new Promise((r) => setTimeout(r, 50));

    const toast = document.getElementById("feedback-toast");
    assert.ok(!toast.classList.contains("hidden"), "toast should be visible");
    assert.ok(toast.classList.contains("success"), "toast should have success class");
    assert.ok(toast.textContent.includes("Thank you"), "toast should contain thank you message");
  });
});

// ---------------------------------------------------------------------------
// History UI
// ---------------------------------------------------------------------------

const MOCK_HISTORY = [
  {
    analysis_id: "id-1",
    job_title: "Software Engineer",
    company_name: "Acme Corp",
    url: "https://www.naukri.com/job/1",
    ghost_score: 25,
    recommendation: "apply_confidently",
    analyzed_at: "2026-02-20T10:00:00Z",
  },
  {
    analysis_id: "id-2",
    job_title: "Data Scientist",
    company_name: "BigCo",
    url: "",
    ghost_score: 75,
    recommendation: "likely_fake",
    analyzed_at: "2026-02-19T14:00:00Z",
  },
];

/**
 * Build a popup context with custom history for showHistory() tests.
 */
function buildPopupContextWithHistory(history = []) {
  const dom = new JSDOM(POPUP_HTML, { runScripts: "outside-only" });
  const win = dom.window;

  const chromeMock = {
    runtime: {
      sendMessage: async (msg) => {
        if (msg.action === "getHistory") return history;
        return MOCK_RESULT;
      },
    },
    tabs: {
      query: async () => [{ url: "https://www.google.com", id: 1 }],
      sendMessage: async () => null,
      create: () => {},
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
  };

  const sandbox = createContext({
    document: win.document,
    console,
    chrome: chromeMock,
    crypto: globalThis.crypto,
    TextEncoder: win.TextEncoder || TextEncoder,
    parseInt,
    Math,
    Object,
    Array,
    Date,
    JSON,
    Promise,
    setTimeout: (...args) => win.setTimeout(...args),
    clearTimeout: (...args) => win.clearTimeout(...args),
  });

  runInContext(POPUP_JS, sandbox);
  return { window: sandbox, document: win.document };
}

describe("showHistory()", () => {
  it("shows history-section and hides others", async () => {
    const { window, document } = buildPopupContextWithHistory(MOCK_HISTORY);
    await window.showHistory();
    assert.ok(!document.getElementById("history-section").classList.contains("hidden"));
    assert.ok(document.getElementById("results").classList.contains("hidden"));
    assert.ok(document.getElementById("manual-paste").classList.contains("hidden"));
  });

  it("renders empty-state message when history is empty", async () => {
    const { window, document } = buildPopupContextWithHistory([]);
    await window.showHistory();
    const empty = document.querySelector(".empty-state");
    assert.ok(empty !== null, "empty-state element should exist");
    assert.ok(empty.textContent.includes("No analyses yet"));
  });

  it("renders history items with score, title, company, date", async () => {
    const { window, document } = buildPopupContextWithHistory(MOCK_HISTORY);
    await window.showHistory();
    const items = document.querySelectorAll(".history-item");
    assert.strictEqual(items.length, 2);

    // First item
    assert.ok(items[0].querySelector(".history-score-circle").textContent === "25");
    assert.ok(items[0].querySelector(".history-title").textContent === "Software Engineer");
    assert.ok(items[0].querySelector(".history-company").textContent === "Acme Corp");
  });

  it("colors score circle green for score <= 30", async () => {
    const { window, document } = buildPopupContextWithHistory(MOCK_HISTORY);
    await window.showHistory();
    const circles = document.querySelectorAll(".history-score-circle");
    // Score 25 → green
    const bg = circles[0].style.background;
    assert.ok(
      ["#16a34a", "rgb(22, 163, 74)"].includes(bg),
      `Expected green, got ${bg}`
    );
  });

  it("colors score circle red for score > 60", async () => {
    const { window, document } = buildPopupContextWithHistory(MOCK_HISTORY);
    await window.showHistory();
    const circles = document.querySelectorAll(".history-score-circle");
    // Score 75 → red
    const bg = circles[1].style.background;
    assert.ok(
      ["#dc2626", "rgb(220, 38, 38)"].includes(bg),
      `Expected red, got ${bg}`
    );
  });
});

describe("clearHistory()", () => {
  it("sets empty array in storage and renders empty-state", async () => {
    let storedHistory = null;
    const dom = new JSDOM(POPUP_HTML, { runScripts: "outside-only" });
    const win = dom.window;

    const chromeMock = {
      runtime: {
        sendMessage: async (msg) => {
          if (msg.action === "getHistory") return MOCK_HISTORY;
          return MOCK_RESULT;
        },
      },
      tabs: {
        query: async () => [{ url: "https://www.google.com", id: 1 }],
        sendMessage: async () => null,
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async (data) => { storedHistory = data; },
        },
      },
    };

    const sandbox = createContext({
      document: win.document,
      console,
      chrome: chromeMock,
      crypto: globalThis.crypto,
      TextEncoder: win.TextEncoder || TextEncoder,
      parseInt,
      Math,
      Object,
      Array,
      Date,
      JSON,
      Promise,
      setTimeout: (...args) => win.setTimeout(...args),
      clearTimeout: (...args) => win.clearTimeout(...args),
    });

    runInContext(POPUP_JS, sandbox);
    await sandbox.clearHistory();

    assert.ok(storedHistory !== null, "storage.set should have been called");
    assert.ok(Array.isArray(storedHistory.history), "history should be an array");
    assert.strictEqual(storedHistory.history.length, 0, "history should be empty");
    const empty = win.document.querySelector(".empty-state");
    assert.ok(empty !== null, "empty-state element should exist after clearing");
  });
});

// ---------------------------------------------------------------------------
// content.js extractData message listener
// ---------------------------------------------------------------------------

describe("content.js extractData message listener", () => {
  it("responds to extractData with hirecheck_extractJobData() result", () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><body>
        <h1 class="jd-header-title">Software Engineer</h1>
        <div class="jd-header-comp-name">Acme Corp</div>
        <div class="job-desc">We are looking for a senior engineer.</div>
      </body></html>`,
      { runScripts: "outside-only", url: "https://www.google.com" }
    );
    const window = dom.window;

    // Disable SPA polling timer to avoid open handle in tests
    window.setInterval = () => 0;

    let capturedListener = null;
    window.chrome = {
      runtime: {
        onMessage: {
          addListener: (handler) => {
            capturedListener = handler;
          },
        },
      },
    };

    // Load extractors + content.js into an explicit context.
    // `window` must be present in the sandbox because content.js accesses
    // window.location.href inside hirecheck_isJobDetailPage().
    const ctx = createContext({
      window: window,
      document: window.document,
      console,
      chrome: window.chrome,
      setInterval: () => 0,
      clearInterval: () => {},
      MutationObserver: window.MutationObserver,
      setTimeout: (...args) => window.setTimeout(...args),
    });
    runInContext(EXTRACTORS_CODE, ctx);
    runInContext(CONTENT_CODE, ctx);

    assert.ok(capturedListener !== null, "onMessage listener should be registered");

    let responseData = null;
    capturedListener({ action: "extractData" }, {}, (data) => {
      responseData = data;
    });

    assert.ok(responseData !== null, "sendResponse should be called");
    assert.ok("success" in responseData, "response should have a success field");
    assert.ok("data" in responseData, "response should have a data field");
  });
});
