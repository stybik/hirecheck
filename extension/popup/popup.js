/**
 * Popup UI logic for HireCheck extension.
 */

document.addEventListener("DOMContentLoaded", () => {
  const togglePasteBtn = document.getElementById("toggle-paste");
  const pasteArea = document.getElementById("paste-area");
  const analyzePasteBtn = document.getElementById("analyze-paste");
  const retryBtn = document.getElementById("retry-btn");

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

  // Retry button
  retryBtn.addEventListener("click", () => {
    hideAllSections();
    document.getElementById("manual-paste").classList.remove("hidden");
  });
});

/**
 * Send analysis request via background service worker.
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

    if (response && response.error) {
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
 */
function showResults(data) {
  hideAllSections();

  const resultsSection = document.getElementById("results");
  resultsSection.classList.remove("hidden");

  // Score value with color
  const scoreEl = document.getElementById("score-value");
  scoreEl.textContent = data.ghost_score;
  if (data.ghost_score <= 30) {
    scoreEl.style.color = "#16a34a";
  } else if (data.ghost_score <= 60) {
    scoreEl.style.color = "#ca8a04";
  } else {
    scoreEl.style.color = "#dc2626";
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

  // Category scores
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
      const div = document.createElement("div");
      div.className = "category-item";
      const labelDiv = document.createElement("div");
      labelDiv.className = "label";
      labelDiv.textContent = labels[key] || key;
      div.appendChild(labelDiv);
      const valueDiv = document.createElement("div");
      valueDiv.className = "value";
      valueDiv.textContent = value;
      div.appendChild(valueDiv);
      catEl.appendChild(div);
    });
  }

  // Show remaining analyses
  const usageEl = document.getElementById("usage-info");
  if (usageEl && data.analyses_today !== undefined && data.daily_limit !== undefined) {
    const remaining = data.daily_limit - data.analyses_today;
    usageEl.textContent = `${remaining} of ${data.daily_limit} free analyses remaining today`;
    usageEl.classList.remove("hidden");
  }

  // Show manual paste toggle again
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
  document.getElementById("results").classList.add("hidden");
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("error").classList.add("hidden");
  document.getElementById("manual-paste").classList.add("hidden");
}
