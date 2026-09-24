# One-time administrator setup

Coworkers will use https://unclephilburt.github.io/AILExtensiion/start.html.
They download a ZIP, load the extension once, and sign in on both devices.
There is no store publication or automatic extension update service.

Deployment on September 24, 2026: schema, Realtime publication and retention
job are installed in the configured project. The existing owner's account is
enabled. Hosted SQL command checks passed with rolled-back fictional data;
anonymous REST access was denied, and the cleanup job completed successfully.
Real phone/Brave call handoff still needs the user's end-to-end check.

## Activate Supabase

1. Open https://supabase.com/dashboard/project/uawladqdbbbgddqtdjoi/sql/new.
2. Paste and run `supabase/migrations/001_cloud_sync.sql` once.
3. Paste and run `supabase/migrations/002_retention.sql` once. Verify the
   `companion-retention` job succeeds in Supabase Cron. This clears live
   snapshots after 30 minutes (plus up to one minute until the next run).
4. Invite each account under Authentication > Users. Disable public signup.
   Set the Site URL and allowed redirect to
   `https://unclephilburt.github.io/AILExtensiion/account.html`.
5. Approve the specific invited email with this SQL, replacing the sample email:

```sql
insert into public.companion_members (user_id)
select id from auth.users where lower(email) = lower('coworker@example.com')
on conflict (user_id) do update set enabled = true;
```

Do this for your own account too. Membership is an independent access gate:
creating an authentication account alone does not grant access to lead data.
No admin/service-role key is needed in the extension or website.

## Verify before inviting the team

- Reload the extension, refresh IMPACT and open the hosted phone page. Both
  default to Cloud, including installations with an old bridge token. Only an
  explicitly saved Local choice overrides the extension default.
- Sign in on the hosted phone page using the same approved account.
- First test with a sample lead/workflow in an authorized test environment.
  Verify live lead delivery, navigation, phone call registration and results.
- Verify that a different account sees only its own workspace. The local SQL
  test covers RLS isolation, but live Supabase Realtime still needs verification.
- Close the active IMPACT tab: the phone should clear its lead within 45–50 seconds.
- Confirm the cleanup job runs before enabling a new deployment.

## Team operations

- One active computer per account. A 45-second lease prevents another computer
  accidentally controlling the same workspace. The active IMPACT tab handles
  commands; hidden/background tabs cannot consume them.
- Realtime events trigger immediate checks. Fallback command polling runs every
  three seconds when Realtime is unavailable. Database and network latency still
  apply. This cannot guarantee instantaneous delivery.
- Commands expire after 15 seconds. IDs prevent duplicate submissions, and
  atomic consumption prevents two consumers executing the same queued action.
  Delivery is at most once: a browser closing just after claim can lose the
  action. Do not blindly retry a disposition; check IMPACT first.
- To revoke access, set `companion_members.enabled=false` for the user and
  delete their `companion_sync` row using the SQL editor. The website rechecks
  membership at least every five seconds. Also remove/revoke Auth access as needed.
- To update, build and send the same Get Started URL; users replace the existing
  extension folder contents and click Reload. Keep the folder path the same.
- Local mode remains available explicitly: choose Local in extension Options
  and use the computer bridge URL with `?mode=local` on the phone.
- Customer data is stored in Supabase in Cloud mode. Review project backups,
  retention and organization requirements before team rollout.

## Development

`npm ci`, `npm run build:auth`, `npm test`, then
`powershell -File scripts/package-extension.ps1`.
Deploy all of `phone-web/public` (including downloads and cloud-sync.js) to Pages.
The ZIP contains only extension files, no local tokens, logs, or database keys.

SQL is tested with embedded PostgreSQL (PGlite). It does not simulate the hosted
Auth service, WebSocket transport, Cron extension, or browser telephone handoff.
