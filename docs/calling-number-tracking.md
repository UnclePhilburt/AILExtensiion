# Calling-number tracking

Apply `supabase/migrations/018_calling_numbers.sql` after migrations 001–017 before publishing the updated phone files. It adds account-owned numbers and call history, plus tracking inside the existing command transaction. It does not relabel historical activity. No new extension build is needed for this feature.

In Settings → Phone number health, save a number and choose **Set active**. The active choice belongs to the signed-in account, across devices. It records the caller's selection; it cannot change the phone's actual outgoing line. Saving the same normalized number updates its label or restores an archived number. Archiving preserves history. Resetting phone preferences does not change account numbers.

Each new registered call receives a unique ID retained with the pending call across reloads. The database snapshots the active number when accepting the call. Results use that call ID, even after the active number changes. Repeated call IDs and repeated results do not inflate totals. The first recorded result wins. No Answer and Refused count as results; an appointment counts at the time-slot action, not when opening its picker. Calls without an active number remain unattributed.

Cloud commands and number tracking are committed together. Local bridge commands log through the same tracking function after command acceptance; a failed statistics write is reported without retrying the phone action. Offline or interrupted local-bridge writes can be missing. Calls made outside Companion are not captured.

Statistics use rolling 30-day periods and the call-start timestamp. Rates divide by calls with a recorded result, not all calls. The comparison requires 20 recorded results in both periods; this is a display threshold, not a statistical confidence claim. Calls represent registered actions, not carrier-confirmed connections. The dashboard does not diagnose spam reputation or fabricate a health score. Carrier checks and spam-removal sites are future work.

Verification: `node --test src/calling-numbers.test.cjs src/pending-call.test.cjs src/phone-settings.test.cjs`. Database tests use an isolated PostgreSQL-compatible test database and cover owner-only access, duplicate numbers, activation, archiving, attribution, retries, and cloud-command integration.
