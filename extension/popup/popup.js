/**
 * Popup UI logic for HireCheck extension.
 */

document.addEventListener("DOMContentLoaded", () => {
  const togglePasteBtn = document.getElementById("toggle-paste");
  const pasteArea = document.getElementById("paste-area");
  const analyzePasteBtn = document.getElementById("analyze-paste");
  const retryBtn = document.getElementById("retry-btn");
  const analyzePageBtn = document.getElementById("analyze-page-btn");

  // Toggle manual paste area
  togglePasteBtn.addEventListener("click", () => {
    pasteArea.classList.toggle("hidden");
    togglePasteBtn.textContent = pasteArea.classList.contains("hidden")
      ? "Paste Job Description"
      : "Hide Paste Area";
  });

  // Analyze pasted job description
  analyzePasteBtn.addEventListener("click", () => {
    const description = document.getElementById("job-description").value.trim();
    const jobTitle = document.getElementById("job-title-input").value.trim();
    const company = document.getElementById("company-input").value.trim();

    if (!description) {
      showError("Please paste a job description.");
      return;
    }
    if (!jobTitle) {
      showError("Please enter a job title.");
      return;
    }
    if (!company) {
      showError("Please enter the company name.");
      return;
    }

    const jobData = {
      url: "",
      job_title: jobTitle,
      company_name: company,
      description: description.substring(0, 12000),
      requirements: "",
      salary_text: null,
      posting_date: null,
      source: "manual_paste",
    };

    runAnalysis(jobData);
  });

  // Analyze current Naukri page — extracts data from content script
  analyzePageBtn.addEventListener("click", async () => {
    analyzePageBtn.disabled = true;
    analyzePageBtn.textContent = "Extracting...";

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab) {
        showError("Cannot find the active tab.");
        analyzePageBtn.disabled = false;
        analyzePageBtn.textContent = "Analyze This Job";
        return;
      }

      let extraction;
      try {
        extraction = await chrome.tabs.sendMessage(tab.id, { action: "extractData" });
      } catch (e) {
        showError("Cannot read this page. Try reloading it, then click 'Analyze This Job' again, or paste the description below.");
        analyzePageBtn.disabled = false;
        analyzePageBtn.textContent = "Analyze This Job";
        return;
      }

      if (!extraction || !extraction.success) {
        showError("Could not extract job data from this page. Use the paste option below.");
        analyzePageBtn.disabled = false;
        analyzePageBtn.textContent = "Analyze This Job";
        return;
      }

      // Hand off to runAnalysis — loading state will hide this button
      runAnalysis(extraction.data);
    } catch (error) {
      showError("Something went wrong. Please try again.");
      analyzePageBtn.disabled = false;
      analyzePageBtn.textContent = "Analyze This Job";
    }
  });

  // Retry button — reset and re-check current page
  retryBtn.addEventListener("click", () => {
    hideAllSections();
    document.getElementById("manual-paste").classList.remove("hidden");
    initPopup();
  });

  // Detect current tab and show appropriate UI
  initPopup();
});

/**
 * Detect the active tab on popup open.
 * If on a Naukri job page: check for a recent stored result or show "Analyze This Job" button.
 * Falls back silently — default state is just manual paste.
 */
async function initPopup() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.url) return;

    const isNaukriJob = /naukri\.com\/job-listings-|naukri\.com\/job\//.test(tab.url);
    if (!isNaukriJob) return;

    // Check for a recent cached result for this URL (< 24h)
    const urlNorm = tab.url.toLowerCase().replace(/\/+$/, "");
    const urlHash = await sha256Hex(urlNorm);
    const storageKey = `last_result_${urlHash}`;
    const stored = await chrome.storage.local.get(storageKey);
    const entry = stored[storageKey];

    if (entry && entry.result && Date.now() - entry.timestamp < 86400000) {
      showResults(entry.result);
      return;
    }

    // No recent result — show the analyze button
    document.getElementById("analyze-page-section").classList.remove("hidden");
  } catch (e) {
    // Tab detection failed — default state (manual paste only) is fine
    console.warn("HireCheck initPopup:", e);
  }
}

/**
 * Compute SHA-256 hex digest of a string using Web Crypto API.
 * Used to build the storage key for last_result lookup.
 * @param {string} message
 * @returns {Promise<string>}
 */
async function sha256Hex(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Send analysis request via background service worker.
 * Routes rate_limit errors to showRateLimit(), others to showError().
 */
async function runAnalysis(jobData) {
  const analyzePasteBtn = document.getElementById("analyze-paste");
  if (analyzePasteBtn) {
    analyzePasteBtn.disabled = true;
    analyzePasteBtn.textContent = "Analyzing...";
  }
  showLoading();

  try {
    const response = await chrome.runtime.sendMessage({
      action: "analyze",
      data: jobData,
    });

    if (response && response.errorType === "rate_limit") {
      showRateLimit(response);
    } else if (response && response.error) {
      showError(response.error);
    } else if (response) {
      showResults(response);
    } else {
      showError("Failed to connect. Please try again.");
    }
  } catch (error) {
    showError("Failed to connect. Please try again.");
  } finally {
    if (analyzePasteBtn) {
      analyzePasteBtn.disabled = false;
      analyzePasteBtn.textContent = "Analyze";
    }
  }
}

/**
 * Display analysis results in the popup.
 * @param {Object} data - API response from /api/v1/analyze/
 */
function showResults(data) {
  hideAllSections();

  const resultsSection = document.getElementById("results");
  resultsSection.classList.remove("hidden");

  // Score value with color coding
  const scoreEl = document.getElementById("score-value");
  scoreEl.textContent = data.ghost_score;
  if (data.ghost_score <= 30) {
    scoreEl.style.color = "#16a34a";
  } else if (data.ghost_score <= 60) {
    scoreEl.style.color = "#ca8a04";
  } else {
    scoreEl.style.color = "#dc2626";
  }

  // Cached badge
  const cachedBadge = document.getElementById("cached-badge");
  if (data.was_cached) {
    cachedBadge.classList.remove("hidden");
  } else {
    cachedBadge.classList.add("hidden");
  }

  // Recommendation badge
  const recEl = document.getElementById("recommendation");
  const recMap = {
    apply_confidently: { text: "Apply Confidently", cls: "green" },
    apply_with_caution: { text: "Apply with Caution", cls: "yellow" },
    likely_fake: { text: "Likely Fake / Suspicious", cls: "red" },
  };
  const rec = recMap[data.recommendation] || recMap.apply_with_caution;
  recEl.textContent = rec.text;
  recEl.className = `recommendation ${rec.cls}`;

  // Signals checked count
  const signalsMeta = document.getElementById("signals-meta");
  if (data.signals_checked) {
    signalsMeta.textContent = `${data.signals_checked} signals checked`;
    signalsMeta.classList.remove("hidden");
  } else {
    signalsMeta.classList.add("hidden");
  }

  // Red flags
  const flagsEl = document.getElementById("red-flags");
  flagsEl.innerHTML = "";
  if (data.red_flags) {
    data.red_flags.forEach((flag) => {
      const div = document.createElement("div");
      div.className = `red-flag-item ${flag.severity}`;
      const strong = document.createElement("strong");
      strong.textContent = flag.signal;
      div.appendChild(strong);
      div.appendChild(document.createElement("br"));
      const small = document.createElement("small");
      small.textContent = flag.explanation;
      div.appendChild(small);
      flagsEl.appendChild(div);
    });
  }

  // Category score bars
  const catEl = document.getElementById("category-scores");
  catEl.innerHTML = "";
  if (data.category_scores) {
    const labels = {
      ghost_signals: "Ghost Signals",
      scam_signals: "Scam Signals",
      toxic_culture: "Toxic Culture",
      market_reality: "Market Reality",
    };
    Object.entries(data.category_scores).forEach(([key, value]) => {
      const safeValue = Math.max(0, Math.min(100, parseInt(value, 10) || 0));

      const item = document.createElement("div");
      item.className = "category-item";

      const labelEl = document.createElement("div");
      labelEl.className = "cat-label";
      labelEl.textContent = labels[key] || key;

      const barWrap = document.createElement("div");
      barWrap.className = "cat-bar-wrap";

      const bar = document.createElement("div");
      bar.className = "cat-bar";
      bar.style.width = `${safeValue}%`;
      if (safeValue < 40) {
        bar.style.background = "#16a34a";
      } else if (safeValue < 70) {
        bar.style.background = "#ca8a04";
      } else {
        bar.style.background = "#dc2626";
      }
      barWrap.appendChild(bar);

      const valueEl = document.createElement("div");
      valueEl.className = "cat-value";
      valueEl.textContent = safeValue;

      item.appendChild(labelEl);
      item.appendChild(barWrap);
      item.appendChild(valueEl);
      catEl.appendChild(item);
    });
  }

  // Usage info — remaining analyses today
  const usageEl = document.getElementById("usage-info");
  if (data.analyses_today !== undefined && data.daily_limit !== undefined) {
    const remaining = data.daily_limit - data.analyses_today;
    usageEl.textContent = `${remaining} of ${data.daily_limit} free analyses remaining today`;
    usageEl.classList.remove("hidden");
  } else {
    usageEl.classList.add("hidden");
  }

  // Keep manual paste visible for additional analyses
  document.getElementById("manual-paste").classList.remove("hidden");
}

/**
 * Display rate limit reached UI (429 response).
 * @param {Object} data - Error response with daily_limit, reset_at
 */
function showRateLimit(data) {
  hideAllSections();

  document.getElementById("rate-limit").classList.remove("hidden");

  const msg = document.getElementById("rate-limit-msg");
  msg.textContent = `You've used all ${data.daily_limit || 5} free analyses today.`;

  const resetEl = document.getElementById("rate-limit-reset");
  if (data.reset_at) {
    try {
      const resetTime = new Date(data.reset_at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      resetEl.textContent = `Resets at ${resetTime}`;
    } catch (e) {
      resetEl.textContent = "Resets at midnight";
    }
  } else {
    resetEl.textContent = "Resets at midnight";
  }

  // Keep manual paste available — paste mode works even at rate limit
  // (same content hash hit will return cached result)
  document.getElementById("manual-paste").classList.remove("hidden");
}

function showLoading() {
  hideAllSections();
  document.getElementById("loading").classList.remove("hidden");
}

function showError(message) {
  hideAllSections();
  document.getElementById("error").classList.remove("hidden");
  document.getElementById("error-message").textContent = message;
}

function hideAllSections() {
  [
    "results",
    "loading",
    "error",
    "manual-paste",
    "analyze-page-section",
    "rate-limit",
  ].forEach((id) => {
    document.getElementById(id).classList.add("hidden");
  });
}
