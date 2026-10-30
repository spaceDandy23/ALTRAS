# Student streaks

## Product rules

A day qualifies when Supabase commits a **fully completed lesson attempt**, even if
its score is below the unchanged passing threshold. Finishing a retry or replay also
counts. Starting, answering part of, abandoning, or failing to submit a lesson does
not count. Pre/post-tests are excluded: these one-off research measurements should
not become a daily engagement incentive. No assessment scoring/sync logic changes.

There is currently no per-user timezone field. All students use the **Asia/Manila**
calendar (Philippine time, UTC+08:00). The database determines the day using
`statement_timestamp()`, independent of device time, timezone or supplied dates.
The qualifying day is when completion reaches the server, not when offline work
was done. A transaction crossing midnight belongs to the day its completion
statement began. Midnight, month/year changes and leap days use PostgreSQL dates.

First day = 1; same day = unchanged; next day = +1. After a missed day, Home shows
0 until another completion starts a new run of 1. Longest streak never decreases
through inactivity. No pre-migration activity is backfilled, because past lessons
were completed before this streak policy was introduced.

## Database and security

Apply `202609120001_student_streaks.sql` after the current migrations:

```powershell
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Review the dry run first; `db push` applies **all** pending migrations. Apply the
migration before deploying this client. Without it, Home reports “Streak
unavailable” with Retry; the existing lesson result still renders normally.

`student_activity_days` is the only source of streak state. Its `(user_id,
activity_day)` primary key permits one record per day, with a unique qualifying
attempt id. No stored current/longest counters can drift out of sync. An AFTER
UPDATE trigger on the active-to-completed lesson transition validates the current
student and full answer count, then inserts with `ON CONFLICT DO NOTHING`. The
existing `complete_lesson_attempt` transaction, scoring, XP, stars and progression
are unchanged. Streak insertion rolls back if that transaction fails. Concurrent
completions serialize at the unique key; repeat completion RPCs already return
the completed attempt without a new status transition.

`get_student_streak(p_attempt_id uuid default null)` authenticates `auth.uid()` and
rejects researchers. It derives consecutive date runs from the caller's ledger,
returning current/longest, last date, earned-today status, timezone and seconds to
the next server-calendar midnight. The optional attempt id can only claim a
feedback marker; it cannot create an activity day. No caller date, timezone, user
id or streak count is accepted. Both functions use `SECURITY DEFINER` with an empty
search path and fully qualified table names. The trigger function is not callable
by API roles. The reader RPC is executable only by authenticated users.

RLS permits students to SELECT their own days only. Anonymous users have no table
or RPC access; neither students nor researchers can INSERT/UPDATE/DELETE streak
data. Researcher identity remains exclusively in `researcher_users`. Promoting a
student to researcher hides their streak and prevents new accrual; existing
records are retained. No raw streak data is added to researcher reporting RPCs.

## UI and feedback

`StudentStreak` mounts on Home and in the final lesson-result branch. It waits for
authenticated, confirmed student experience and matching account identity. Home
shows a compact current/longest summary, guidance and calendar disclosure using
existing theme tokens. No new icon library, motion or sound is added. The result
shows “Streak started!” or “N day streak!” only for the day's first qualifying
attempt, after result readiness. Completion/reward audio retains its existing owner.

Feedback is claimed atomically in the database by updating a nullable marker;
concurrent claims return `celebrate: true` to at most one caller. Extra completions,
result remounts and refreshes do not re-celebrate. In-flight requests are coalesced
for Strict Mode, with no persistent browser streak cache. Requests and responses
are scoped to the authenticated user; unmounted/stale effects cannot publish data.

Home fetches on mount, focus, visibility return, reconnect and server-specified
midnight. Returning from a completion immediately fetches committed data. A second
device refresh/re-login reads the same database. An already visible idle tab is
not a live realtime subscription; it refreshes on those events. A failed streak
read never becomes a fake zero or blocks a lesson result.

## Verification and limitations

The PostgreSQL integration suite uses a dev-only PGlite engine and applies the
historical migrations plus the new migration. It substitutes the minimal Supabase
Auth schema/roles and omits only pgcrypto extension installation (not exercised by
streak tests). It calls the real completion RPCs, and tests rollback, RLS, forbidden
mutations, researchers, anonymous users, replay/retry, date runs and timezone
boundaries. Historical dates are privileged test fixtures, never a client API.
PGlite queues parallel requests on one database connection; true overlapping
multi-connection lock contention requires staging Supabase QA. Database unique
constraints and atomic conditional UPDATE provide the cross-connection guarantee.

UI tests cover Home/results, experience gates, stale accounts, Strict Mode,
reconnect, remount, errors and server-midnight refresh. PGlite is test-only and
is not shipped in the app bundle.

Manual QA on staging (desktop and 320px/mobile, both themes and Large/Largest text):

1. Sign in as a student; Home shows the current streak and documented timezone.
2. Finish a lesson (including a low score): result confirmation once, Home updated.
3. Replay today: no increment or repeated confirmation. Reload/revisit the result.
4. Repeat completion from two devices/tabs simultaneously: one day and one claim.
5. Test just before/after Philippine midnight; device timezone must not affect it.
6. Verify next-day increase, missed-day reset and retained longest on test accounts.
7. Lose connectivity before completion: no award until the server commits. Retry.
8. Finish pre/post-test: streak unchanged. Existing result audio still behaves normally.
9. Researcher/guest routes: no streak UI/data; researcher completion remains denied.
10. Switch accounts, background/return to Home, and retry a failed streak read.

No badges, freezes, social features, recovery purchases or researcher analytics.
Feedback is at-most-once: if the claim commits but its response is lost, the streak
remains correct but its small celebration may be missed. Historical streak queries
scan the user's daily ledger (one row/day); consider aggregation only if measured
load warrants it. No Supabase deployment or live-account testing is performed by
the automated suite.
