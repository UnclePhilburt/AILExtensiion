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

## Local mode

Both the phone and extension require sign-in. Every bridge API request must
include an account bearer token, which the bridge verifies with Supabase Auth
(verification cached for up to five seconds). Leads, commands, and event streams
are partitioned by the verified user ID. The bridge token alone grants no lead
access. Signing out through a local account page revokes that access token on
the bridge, clears the account's cached lead/commands, and closes its streams.

The phone and extension must use the same account. Signing in to GitHub Pages
does not sign in to the separate local phone URL; browser sessions are scoped
to each origin. The local bridge needs internet access for verification and
fails closed when it cannot verify a session. In Local mode no lead data is
uploaded to Supabase. Cloud mode uses authenticated storage, row-level security,
and administrator-approved membership. See [cloud setup](cloud-setup.md).

## Build and publish

Run `npm ci` followed by `npm run build:auth`. The official Supabase SDK is
bundled locally (no CDN scripts) for both the phone site and Manifest V3
extension. Publish all files in `phone-web/public` to the Pages branch, including
the three account files. Reload the extension after updating it.
