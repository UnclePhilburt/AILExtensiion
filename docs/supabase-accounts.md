# Supabase accounts

The phone and extension account pages use Supabase email/password authentication.
The public project URL and publishable key are bundled into both apps. No secret
or service-role key belongs in this repository, browser code, or GitHub Pages.

## Dashboard setup

1. In Supabase Authentication settings, keep Email enabled and turn off **Allow
   new users to sign up** for invitation-only access. This server setting is
   required: the absence of a signup button is not an access restriction.
2. In Authentication URL Configuration, set the Site URL to
   `https://unclephilburt.github.io/AILExtensiion/account.html` and add that exact
   URL to the allowed Redirect URLs. Invitations and password recovery return
   to this account page.
3. Under Authentication > Users, invite the first user. Open the invitation,
   set a password, then sign in on each device. Do not share passwords in chat.
4. Configure a production email provider before inviting coworkers at scale.

## Use

- Phone: open **Your account** on the current lead page.
- Extension: Options > **Sign in / Manage your account**.
- Session tokens are remembered in browser storage on the phone and extension
  local storage on the computer. The SDK refreshes sessions while the account
  page is open. Passwords are never saved by our code.
- Forgot password sends a recovery link to the hosted account page.
- Sign out affects this device only.

## Current scope

This is the account foundation, not the cloud bridge. Existing local calling
still works without signing in, and no lead details or phone commands are sent
to Supabase. Accounts do not yet protect or partition the local bridge. Before
multi-user cloud use, add authenticated lead/command storage and enforce owner
access through database row-level security, then test two independent users.

## Build and publish

Run `npm ci` followed by `npm run build:auth`. The official Supabase SDK is
bundled locally (no CDN scripts) for both the phone site and Manifest V3
extension. Publish all files in `phone-web/public` to the Pages branch, including
the three account files. Reload the extension after updating it.
