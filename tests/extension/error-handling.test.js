/**
 * Error handling tests for the service worker's API error classification.
 * Tests handleApiError() logic and fetch error mapping independently of Chrome APIs.
 *
 * Run: node --test tests/extension/error-handling.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Replica of handleApiError from service-worker.js.
 * Extracted here because the service worker uses importScripts + Chrome APIs
 * that aren't available in Node.js test environment.
 *
 * If the logic in service-worker.js changes, this must be updated to match.
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
 * Create a mock Response-like object for testing.
 */
function mockResponse(status, body = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

/**
 * Create a mock Response that fails to parse JSON.
 */
function mockResponseBadJson(status) {
  return {
    status,
    ok: false,
    json: async () => { throw new SyntaxError("Unexpected token"); },
  };
}

// ---- Error Classification Tests ----

describe("handleApiError — Status Code Classification", () => {
  it("429 → rate_limit with usage details", async () => {
    const resp = mockResponse(429, {
      analyses_today: 5,
      daily_limit: 5,
      reset_at: "2026-02-21T00:00:00+05:30",
    });
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "rate_limit");
    assert.strictEqual(result.analyses_today, 5);
    assert.strictEqual(result.daily_limit, 5);
    assert.ok(result.error.includes("Daily limit reached"));
    assert.ok(result.error.includes("5/5"));
    assert.ok(result.reset_at);
  });

  it("429 with missing usage data shows fallback values", async () => {
    const resp = mockResponse(429, {});
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "rate_limit");
    assert.ok(result.error.includes("?/5"), `Expected fallback values in: "${result.error}"`);
  });

  it("400 → validation", async () => {
    const resp = mockResponse(400, { error: "Validation failed" });
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "validation");
    assert.ok(result.error.includes("Invalid request"));
  });

  it("401 → auth", async () => {
    const resp = mockResponse(401, {});
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "auth");
    assert.ok(result.error.includes("Authentication error"));
  });

  it("403 → auth (same as 401)", async () => {
    const resp = mockResponse(403, {});
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "auth");
    assert.ok(result.error.includes("reinstall"));
  });

  it("503 → unavailable", async () => {
    const resp = mockResponse(503, {});
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "unavailable");
    assert.ok(result.error.includes("temporarily unavailable"));
  });

  it("500 → unknown with server message", async () => {
    const resp = mockResponse(500, { message: "Internal server error" });
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "unknown");
    assert.strictEqual(result.error, "Internal server error");
  });

  it("502 → unknown with status code fallback", async () => {
    const resp = mockResponse(502, {});
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "unknown");
    assert.ok(result.error.includes("502"), `Should include status code: "${result.error}"`);
  });
});

describe("handleApiError — Malformed Response Bodies", () => {
  it("429 with unparseable JSON uses fallback values", async () => {
    const resp = mockResponseBadJson(429);
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "rate_limit");
    assert.ok(result.error.includes("?/5"), `Expected fallback: "${result.error}"`);
  });

  it("500 with unparseable JSON shows status code", async () => {
    const resp = mockResponseBadJson(500);
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "unknown");
    assert.ok(result.error.includes("500"));
  });

  it("400 with unparseable JSON still returns validation type", async () => {
    const resp = mockResponseBadJson(400);
    const result = await handleApiError(resp);
    assert.strictEqual(result.errorType, "validation");
  });
});

// ---- Fetch Error Classification (mirrors service-worker.js catch blocks) ----

describe("Fetch Error Classification", () => {
  it("AbortError maps to timeout", () => {
    const error = new DOMException("The operation was aborted", "AbortError");
    assert.strictEqual(error.name, "AbortError");
    // Service worker checks: if (fetchError.name === "AbortError")
    // and returns { errorType: "timeout" }
    const result = error.name === "AbortError"
      ? { error: "Request timed out. Please try again.", errorType: "timeout" }
      : { error: "Unable to connect.", errorType: "network" };
    assert.strictEqual(result.errorType, "timeout");
  });

  it("TypeError (network failure) maps to network", () => {
    const error = new TypeError("Failed to fetch");
    assert.notStrictEqual(error.name, "AbortError");
    const result = error.name === "AbortError"
      ? { error: "Request timed out.", errorType: "timeout" }
      : { error: "Unable to connect. Check your internet connection.", errorType: "network" };
    assert.strictEqual(result.errorType, "network");
  });
});
