# IMPACT Phone Bridge

Local-only phone companion prototype.

The bridge keeps the current lead in memory and serves a phone-friendly page on your local network. It does not call IMPACT, does not write dispositions, and does not send data to a cloud service.

## Start

From `/Users/codywilliams/Documents/ImpactExtension`:

```bash
node phone-web/server.js
```

The server prints:

- a local bridge URL for the Brave extension
- a token to paste into extension Options
- phone URLs for devices on the same Wi-Fi

## Extension Setup

1. Open the extension Options page.
2. Set **Phone bridge URL** to `http://127.0.0.1:8787`.
3. Paste the printed token into **Phone bridge token**.
4. Save.

Then open a lead detail page, run the diagnostic, and click **Send to Phone**.

