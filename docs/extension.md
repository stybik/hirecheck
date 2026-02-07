# Chrome Extension

## Overview

Manifest V3 Chrome extension that injects an "Analyze This Job" button on Naukri.com job listing pages.

## Installation (Development)

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension/` directory

## File Structure

| File | Purpose |
|------|---------|
| `manifest.json` | Extension config — permissions, content scripts, service worker |
| `content/content.js` | Injects floating button, extracts job data from Naukri DOM |
| `content/content.css` | Button and result overlay styling |
| `background/service-worker.js` | HMAC signing, API calls, history management |
| `popup/popup.html` | Manual paste UI + analysis history |
| `lib/hmac.js` | HMAC-SHA256 signing via Web Crypto API |

## DOM Extraction

Content script uses a 3-tier CSS selector fallback strategy to extract job data:

```javascript
extractText(selectors, maxLength)
```

Each field has multiple selectors ordered by specificity, falling back gracefully if Naukri changes their DOM.

## HMAC Signing

Every API request is signed with HMAC-SHA256:

1. Extension reads `HMAC_SECRET_KEY` from config
2. Signs `timestamp + JSON.stringify(body)` using Web Crypto API
3. Sends `X-Extension-Signature` and `X-Timestamp` headers
4. Backend validates signature and rejects requests older than 5 minutes

## Device Fingerprinting

Uses `crypto.randomUUID()` stored in `chrome.storage.local` as an anonymous device identifier for rate limiting. No personally identifiable information is collected.
