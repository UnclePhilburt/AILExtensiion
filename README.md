# IMPACT Companion Prototype

Read-only diagnostic prototype for a personal Chrome extension that can inspect the IMPACT CRM pages you are already authorized to access.

This repository starts with a Manifest V3 Chrome extension. It does not collect IMPACT credentials, does not call IMPACT endpoints, and does not write changes back to IMPACT.

## Current Stage

- Load-unpacked Chrome extension in `extension/`
- Read-only popup diagnostics
- Element picker for identifying page fields
- Selector configuration stored separately from app logic
- Rolling local diagnostic/audit log in Chrome extension storage
- Placeholder `phone-web/` folder for the future phone interface

## Install Locally

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select `/Users/codywilliams/Documents/ImpactExtension/extension`.
6. Pin **IMPACT Companion Diagnostic** to the toolbar.

## First Use

1. Log into IMPACT normally in Chrome.
2. Navigate to a lead page you are authorized to view.
3. Click the extension icon.
4. Click **Run Diagnostic**.
5. Confirm **Options** shows the exact IMPACT origin. The dev default is `https://mobile.impact.ailife.com`.
6. Use **Pick Element** on the popup to identify fields without changing IMPACT.

The diagnostic defaults currently include `https://mobile.impact.ailife.com` and `/Lead/Inbox` for local development. Change these in Options if the work PC uses a different IMPACT origin.

See [DevTools Workflow](docs/devtools-workflow.md) for how to collect safe, non-sensitive element information.

## Safety Boundaries

- No username or password collection.
- No automated writes to IMPACT.
- No private endpoint calls.
- No third-party/cloud data transfer.
- Customer/lead values stay in local Chrome extension storage during this diagnostic stage.
- Logs are visible and can be exported or cleared.
