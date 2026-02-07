/**
 * Background service worker for HireCheck extension.
 * Handles message passing, HMAC signing, and API communication.
 */

importScripts("../lib/hmac.js");

const API_BASE_URL = "http://localhost:8000/api/v1";

/**
 * Listen for messages from content script or popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyze") {
    handleAnalyze(message.data)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true; // Keep message channel open for async response
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
 * @param {Object} jobData - Extracted job listing data
 * @returns {Promise<Object>} Analysis result
 */
async function handleAnalyze(jobData) {
  const body = {
    ...jobData,
    device_fingerprint: await getDeviceFingerprint(),
  };

  const { signature, timestamp } = await signRequest(body);

  const response = await fetch(`${API_BASE_URL}/analyze/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Extension-Signature": signature,
      "X-Timestamp": timestamp.toString(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API error: ${response.status}`);
  }

  const result = await response.json();

  // Save to local history
  await saveToHistory(result, jobData);

  return result;
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
 * Retrieve analysis history from local storage.
 * @returns {Promise<Array>}
 */
async function getHistory() {
  const { history = [] } = await chrome.storage.local.get("history");
  return history;
}
