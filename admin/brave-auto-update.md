# Brave automatic updates

This file is generated with each release. A Windows administrator can import `brave-extension-policy.json` through the organization's Brave/Chromium enterprise policy. It force-installs IMPACT Companion and checks the hosted update feed for new signed releases.

The signing key is intentionally stored only in the release workstation's ignored `release` folder. Do not share or replace it: changing it creates a different extension identity and breaks automatic updates.
