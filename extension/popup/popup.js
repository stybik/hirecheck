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

    const jobData = {
      url: null,
      job_title: jobTitle || "Unknown",
      company_name: company || "Unknown",
      description: description.substring(0, 3000),
      requirements: null,
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
  showLoading();

  try {
    const response = await chrome.runtime.sendMessage({
      action: "analyze",
      data: jobData,
    });

    if (response.error) {
      showError(response.error);
    } else {
      showResults(response);
    }
  } catch (error) {
    showError("Failed to connect. Please try again.");
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
      div.innerHTML = `<strong>${flag.signal}</strong><br><small>${flag.explanation}</small>`;
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
      div.innerHTML = `<div class="label">${labels[key] || key}</div><div class="value">${value}</div>`;
      catEl.appendChild(div);
    });
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
