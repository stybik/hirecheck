/**
 * HMAC-SHA256 signing module for API request authentication (PRD R20).
 * Uses the Web Crypto API available in Manifest V3 service workers.
 */

const HMAC_SECRET = "change-me-to-match-backend-hmac-secret";

/**
 * Compute SHA-256 hash of a string.
 * @param {string} message
 * @returns {Promise<string>} Hex-encoded hash
 */
async function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute HMAC-SHA256 signature.
 * @param {string} secret - The shared secret key
 * @param {string} message - The message to sign
 * @returns {Promise<string>} Hex-encoded HMAC signature
 */
async function hmacSha256(secret, message) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, msgData);
  const sigArray = Array.from(new Uint8Array(signature));
  return sigArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Sign an API request body for authentication.
 * @param {Object} body - The request body object
 * @returns {Promise<{signature: string, timestamp: number}>}
 */
async function signRequest(body) {
  const timestamp = Math.floor(Date.now() / 1000);
  const bodyString = JSON.stringify(body);
  const bodyHash = await sha256(bodyString);
  const message = `${timestamp}${bodyHash}`;
  const signature = await hmacSha256(HMAC_SECRET, message);

  return { signature, timestamp };
}
