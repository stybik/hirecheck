/**
 * Background service worker for HireCheck extension.
 * Handles message passing, HMAC signing, and API communication.
 */

importScripts("../lib/hmac.js");

const API_BASE_URL = "http://localhost:8000/api/v1";
const FETCH_TIMEOUT_MS = 10000;

/**
 * Listen for messages from content script or popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyze") {
    handleAnalyze(message.data)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: "Something went wrong. Please try again.", errorType: "unknown" }));
    return true; // Keep message channel open for async response
  }

  if (message.action === "submitFeedback") {
    handleSubmitFeedback(message.data)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: "Failed to submit feedback.", errorType: "unknown" }));
    return true;
  }

  if (message.action === "getHistory") {
    getHistory()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }
});

/**
 * Send analysis request to backend API.
 * Returns result object on success, or { error, errorType } on failure.
 * Never throws — all errors are returned as structured objects.
 * @param {Object} jobData - Extracted job listing data
 * @returns {Promise<Object>}
 */
async function handleAnalyze(jobData) {
  try {
    const body = {
      ...jobData,
      device_fingerprint: await getDeviceFingerprint(),
    };

    const { signature, timestamp } = await signRequest(body);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/analyze/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Extension-Signature": signature,
          "X-Timestamp": timestamp.toString(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError.name === "AbortError") {
        return { error: "Request timed out. Please try again.", errorType: "timeout" };
      }
      return {
        error: "Unable to connect. Check your internet connection.",
        errorType: "network",
      };
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      return await handleApiError(response);
    }

    const result = await response.json();
    await saveToHistory(result, jobData);
    await storeLastResult(result, jobData);
    return result;
  } catch (error) {
    console.error("HireCheck handleAnalyze error:", error);
    return { error: "Something went wrong. Please try again.", errorType: "unknown" };
  }
}

/**
 * Submit user feedback on analysis accuracy.
 * @param {Object} feedbackData - { analysis_id, feedback_type }
 * @returns {Promise<Object>}
 */
async function handleSubmitFeedback(feedbackData) {
  try {
    const body = {
      analysis_id: feedbackData.analysis_id,
      feedback_type: feedbackData.feedback_type,
      device_fingerprint: await getDeviceFingerprint(),
    };

    const { signature, timestamp } = await signRequest(body);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`${API_BASE_URL}/feedback/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Extension-Signature": signature,
          "X-Timestamp": timestamp.toString(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      return { error: "Unable to submit feedback. Check your connection.", errorType: "network" };
    }

    clearTimeout(timeoutId);

    const result = await response.json().catch(() => ({}));

    if (response.status === 409) {
      return { success: true, message: "Feedback already recorded." };
    }

    if (!response.ok) {
      return { error: result.message || "Failed to submit feedback.", errorType: "unknown" };
    }

    return { success: true, ...result };
  } catch (error) {
    console.error("HireCheck handleSubmitFeedback error:", error);
    return { error: "Failed to submit feedback.", errorType: "unknown" };
  }
}

/**
 * Map HTTP error responses to user-friendly messages with error type.
 * @param {Response} response
 * @returns {Promise<Object>}
 */
async function handleApiError(response) {
  const errorData = await response.json().catch(() => ({}));

  switch (response.status) {
    case 429:
      return {
        error: `Daily limit reached (${errorData.analyses_today || "?"}/${errorData.daily_limit || 5}). Resets at midnight.`,
        errorType: "rate_limit",
        analyses_today: errorData.analyses_today,
        daily_limit: errorData.daily_limit,
        reset_at: errorData.reset_at,
      };
    case 400:
      return {
        error: "Invalid request. Please try again or use manual paste.",
        errorType: "validation",
      };
    case 401:
    case 403:
      return {
        error: "Authentication error. Please reinstall the extension.",
        errorType: "auth",
      };
    case 503:
      return {
        error: "Analysis temporarily unavailable. Please try again in a few minutes.",
        errorType: "unavailable",
      };
    default:
      return {
        error: errorData.message || `Unexpected error (${response.status}).`,
        errorType: "unknown",
      };
  }
}

/**
 * Get or create a persistent device fingerprint (localStorage UUID).
 * @returns {Promise<string>}
 */
async function getDeviceFingerprint() {
  const result = await chrome.storage.local.get("device_fingerprint");
  if (result.device_fingerprint) {
    return result.device_fingerprint;
  }

  const fingerprint = crypto.randomUUID();
  await chrome.storage.local.set({ device_fingerprint: fingerprint });
  return fingerprint;
}

/**
 * Save analysis result to local history (last 50).
 */
async function saveToHistory(result, jobData) {
  const { history = [] } = await chrome.storage.local.get("history");

  history.unshift({
    analysis_id: result.analysis_id,
    job_title: jobData.job_title,
    company_name: jobData.company_name,
    url: jobData.url || null,
    ghost_score: result.ghost_score,
    recommendation: result.recommendation,
    analyzed_at: result.analyzed_at,
  });

  // Keep only last 50
  if (history.length > 50) {
    history.length = 50;
  }

  await chrome.storage.local.set({ history });
}

/**
 * Store the most recent analysis result keyed by URL hash.
 * Enables the popup to display a fresh result immediately on open.
 * Skips storage when URL is empty (manual paste with no URL).
 * @param {Object} result - API response
 * @param {Object} jobData - Submitted job data (must have .url)
 */
async function storeLastResult(result, jobData) {
  if (!jobData.url) return;
  const urlNorm = jobData.url.toLowerCase().replace(/\/+$/, "");
  const urlHash = await sha256(urlNorm);
  await chrome.storage.local.set({
    [`last_result_${urlHash}`]: { result, timestamp: Date.now() },
  });
}

/**
 * Retrieve analysis history from local storage.
 * @returns {Promise<Array>}
 */
async function getHistory() {
  const { history = [] } = await chrome.storage.local.get("history");
  return history;
}
