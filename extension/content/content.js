/**
 * Content script for HireCheck extension.
 * Injects the "Analyze This Job" floating button on Naukri job detail pages.
 */

(function () {
  // Guard: only run on job detail pages
  if (!window.location.href.includes("naukri.com/job-listings")) {
    return;
  }

  // Guard: don't inject twice
  if (document.getElementById("hirecheck-analyze-btn")) {
    return;
  }

  // Create floating analyze button
  const button = document.createElement("button");
  button.id = "hirecheck-analyze-btn";
  button.textContent = "Analyze This Job";
  button.addEventListener("click", handleAnalyzeClick);

  document.body.appendChild(button);

  /**
   * Handle analyze button click.
   * Extracts job data from the page and sends to background worker.
   */
  async function handleAnalyzeClick() {
    button.textContent = "Analyzing...";
    button.disabled = true;

    try {
      const jobData = extractJobData();

      const response = await chrome.runtime.sendMessage({
        action: "analyze",
        data: jobData,
      });

      if (response.error) {
        button.textContent = "Error - Try Again";
        console.error("HireCheck analysis error:", response.error);
      } else {
        button.textContent = `Score: ${response.ghost_score}/100`;
        // Popup will show detailed results
      }
    } catch (error) {
      button.textContent = "Error - Try Again";
      console.error("HireCheck error:", error);
    }

    button.disabled = false;
  }

  /**
   * Extract job listing data from the Naukri page DOM.
   * Uses 3-tier selector strategy from PRD Section 8.
   */
  function extractJobData() {
    return {
      url: window.location.href,
      job_title: extractText([
        ".styles_jd-header-title__rZwM1",
        ".jd-header-title",
        '[class*="jd-header-title"]',
        "h1",
      ]),
      company_name: extractText([
        ".styles_jd-header-comp-name__MvqAI",
        ".jd-header-comp-name",
        '[class*="comp-name"]',
      ]),
      description: extractText(
        [
          ".styles_JDC__dang-inner-html__h0K4t",
          ".job-desc",
          '[class*="job-desc"]',
        ],
        3000
      ),
      requirements: extractText([
        '[class*="key-skill"]',
        '[class*="skills"]',
      ]),
      salary_text: extractText([
        ".styles_jhc__salary__jdfEC",
        '[class*="salary"]',
        ".salary",
      ]),
      posting_date: extractText([
        ".styles_jhc__jd-stats__KrNRZ",
        '[class*="jd-stats"]',
      ]),
      source: "dom_extraction",
    };
  }

  /**
   * Try multiple selectors in order, return first match text content.
   * @param {string[]} selectors - CSS selectors to try in priority order
   * @param {number} maxLength - Optional max character length for truncation
   * @returns {string|null}
   */
  function extractText(selectors, maxLength = null) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        let text = element.textContent.trim();
        if (maxLength && text.length > maxLength) {
          text = text.substring(0, maxLength);
        }
        return text || null;
      }
    }
    return null;
  }
})();
