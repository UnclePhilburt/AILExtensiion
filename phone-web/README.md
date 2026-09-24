# IMPACT Phone Bridge

Local-only phone companion prototype.

The bridge keeps the current lead in memory and serves a phone-friendly page on your local network. It does not call IMPACT, does not write dispositions, and does not send data to a cloud service.

The same static phone UI can also be deployed to GitHub Pages from `phone-web/public`. GitHub Pages is only the UI shell. Live lead data still needs the local bridge or a future approved backend such as Supabase.

Important: a GitHub Pages HTTPS page may be blocked by the browser from fetching an HTTP local-network bridge. If that happens, use the bridge-served phone URL printed by `server.js` for live calling.

## Start

On Windows, double-click **Start Phone Companion.cmd** in the project folder.
Keep its window open and open the printed local Phone URL on your phone using
the same Wi-Fi. The local page connects automatically; no phone token entry is
needed. Bookmark that page or add it to your home screen. The computer must stay
awake, and its network address may change when you switch networks.

The extension token is saved locally in `phone-web/.bridge-token` (excluded from
Git), so the extension only needs to be configured once. Anyone able to reach
the bridge on your local network can open the phone page and pair automatically.
The hosted GitHub Pages version still requires manual connection settings.

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

## GitHub Pages

This repo can publish `phone-web/public` to a `gh-pages` branch.

In GitHub:

1. Open the repo settings.
2. Go to **Pages**.
3. Set **Source** to **Deploy from a branch**.
4. Select the `gh-pages` branch and `/ (root)`.
