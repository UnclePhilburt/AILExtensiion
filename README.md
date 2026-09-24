# IMPACT Companion

Connect a computer's IMPACT workflow to a phone. The phone displays the current
lead, contact numbers, request type and previous activity. Phone controls can
navigate leads, register calls and submit supported No Answer / Refused
Appointment results using IMPACT's existing page controls.

## Coworker installation

Share https://unclephilburt.github.io/AILExtensiion/start.html.

1. Download the extension ZIP and extract it to a permanent folder.
2. In Brave open `brave://extensions` (Chrome: `chrome://extensions`).
3. Enable Developer mode, choose Load unpacked, and select `extension`.
4. Sign in with an administrator-approved account and open an IMPACT lead.
5. Scan the popup's QR code or open the hosted phone page and sign in using the
   same email. In Cloud mode there is no bridge or same-network requirement.

Cloud mode requires the one-time [Supabase setup](docs/cloud-setup.md).
No Chrome Web Store listing is used. Extension updates require replacing the
files in the same folder and clicking Reload in the browser's extensions page.

## Existing local installation

Cloud is the default on both devices. To deliberately use Local mode, select it
in extension Options, run `Start Phone Companion.cmd` on Windows with Node.js
installed, and open the printed local phone URL on the same network. Sign in
on both devices. Old bridge tokens alone do not switch the app back to Local.
For debugging, use Options > Debug tools.

## Data and access

Cloud mode stores the current snapshot and short-lived commands in Supabase,
protected by account ownership and an invitation-managed membership gate.
One active computer is supported per account. A scheduled cleanup clears old
live snapshots; Supabase backups have separate project retention settings.
Local mode sends leads through the local bridge instead. Supabase authenticates
accounts in both modes. No admin keys belong in this repository or download.
See [data use](phone-web/public/privacy.html) and [cloud setup](docs/cloud-setup.md).

## Development

Run `npm ci`, `npm run build:auth`, and `npm test`.
Create the download with `powershell -File scripts/package-extension.ps1`.
The extension is in `extension/`; hosted files are in `phone-web/public/`.
Authentication uses the bundled official Supabase SDK, with no remote scripts.
Database security and queue behavior are tested with embedded PostgreSQL.
Live Supabase/WebSocket and real IMPACT validation are separate rollout checks.
