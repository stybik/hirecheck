/**
 * Content script for HireCheck extension.
 * Injects the "Analyze This Job" floating button on Naukri job detail pages.
 * Handles SPA navigation (Naukri is a React app — URL changes without page reload).
 *
 * Depends on: extractors.js (loaded first via manifest content_scripts array).
 */

(function () {
  "use strict";

  const BUTTON_ID = "hirecheck-analyze-btn";
  const NAV_POLL_INTERVAL_MS = 1000;
  const DOM_SETTLE_TIMEOUT_MS = 5000;

  let currentUrl = "";
  let analysisInFlight = false;

  // --- Initialization ---
  init();
  registerMessageListener();

  function init() {
    onUrlChange();
    startNavigationWatcher();
  }

  /**
   * Listen for messages from the popup.
   * Responds to extractData requests with the current page's job data.
   */
  function registerMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "extractData") {
        sendResponse(hirecheck_extractJobData());
        return false; // synchronous response
      }
    });
  }

  /**
   * Poll for URL changes every second to detect SPA navigation.
   * pushState/replaceState don't fire any events we can listen to,
   * so polling is the simplest reliable approach.
   */
  function startNavigationWatcher() {
    setInterval(() => {
      if (window.location.href !== currentUrl) {
        onUrlChange();
      }
    }, NAV_POLL_INTERVAL_MS);
  }

  /**
   * Called on initial load and every SPA navigation.
   * Cleans up stale elements, checks if this is a job page, waits for DOM, then injects.
   */
  function onUrlChange() {
    currentUrl = window.location.href;
    removeExistingButton();

    if (!hirecheck_isJobDetailPage()) return;

    // Wait for the job title element to appear (React may still be rendering)
    waitForElement(HIRECHECK_SELECTORS.job_title[0], DOM_SETTLE_TIMEOUT_MS)
      .then(() => injectButton())
      .catch(() => {
        // Primary selector didn't appear — inject anyway (fallback selectors may work)
        injectButton();
      });
  }

  /**
   * Wait for a CSS selector to match an element in the DOM.
   * Uses MutationObserver for efficiency (no polling).
   * @param {string} selector
   * @param {number} timeout
   * @returns {Promise<Element>}
   */
  function waitForElement(selector, timeout) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error("Timeout waiting for element"));
      }, timeout);
    });
  }

  function removeExistingButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (existing) existing.remove();
  }

  function injectButton() {
    // Don't inject twice (race condition guard)
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.textContent = "Analyze This Job";
    button.addEventListener("click", handleAnalyzeClick);
    document.body.appendChild(button);
  }

  /**
   * Handle analyze button click.
   * Extracts job data, validates critical fields, sends to background worker.
   */
  async function handleAnalyzeClick() {
    if (analysisInFlight) return;
    analysisInFlight = true;

    const button = document.getElementById(BUTTON_ID);
    if (!button) {
      analysisInFlight = false;
      return;
    }

    button.textContent = "Analyzing...";
    button.disabled = true;
    button.style.backgroundColor = ""; // Reset to default CSS

    try {
      const extraction = hirecheck_extractJobData();

      if (!extraction.success) {
        button.textContent = "Can't read page — Use Popup";
        button.style.backgroundColor = "#94a3b8";
        button.disabled = false;
        analysisInFlight = false;
        return;
      }

      const response = await chrome.runtime.sendMessage({
        action: "analyze",
        data: extraction.data,
      });

      if (response && response.error) {
        button.textContent = "Error — Try Again";
        button.style.backgroundColor = "#94a3b8";
        console.error("HireCheck:", response.error);
      } else if (response) {
        updateButtonWithResult(button, response.ghost_score);
      } else {
        button.textContent = "Error — Try Again";
        button.style.backgroundColor = "#94a3b8";
      }
    } catch (error) {
      button.textContent = "Error — Try Again";
      button.style.backgroundColor = "#94a3b8";
      console.error("HireCheck error:", error);
    }

    button.disabled = false;
    analysisInFlight = false;
  }

  /**
   * Update button text and color based on ghost score.
   * Green (0-30), amber (31-60), red (61-100).
   */
  function updateButtonWithResult(button, score) {
    button.textContent = `Ghost Score: ${score}/100`;
    if (score <= 30) {
      button.style.backgroundColor = "#16a34a"; // green
    } else if (score <= 60) {
      button.style.backgroundColor = "#ca8a04"; // amber
    } else {
      button.style.backgroundColor = "#dc2626"; // red
    }
  }
})();
