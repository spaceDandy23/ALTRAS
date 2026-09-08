# ALTRAS online setup

The production app uses Vercel for the React frontend and Supabase for accounts and student data.
Lesson content stays packaged in the application; a lesson-editing CMS is outside the agreed scope.

## Create the Supabase project

1. Create a project owned by the client group or the agreed turnover account.
2. In **Authentication > Providers > Email**, keep email/password enabled and disable email confirmation.
   ALTRAS converts participant usernames into internal, non-deliverable account identifiers, so it does
   not send account emails.
3. Open the SQL editor and run `supabase/migrations/202608300001_online_foundation.sql`.
4. Run `supabase/migrations/202608300002_transactional_lesson_attempts.sql` to add atomic
   scoring, XP/unlocking updates, restart handling, and active completion-time tracking.
5. Run `supabase/migrations/202608300003_assessment_flow.sql`.
6. Run `supabase/migrations/202608310001_researcher_results.sql`.
7. Run `supabase/migrations/202608310002_researcher_student_separation.sql`.
8. Run `supabase/migrations/202609040001_assessment_answer_draft_upsert.sql` to support
   resumable pre-test and post-test drafts whose answers synchronize in the background.
9. Run `supabase/migrations/202609050001_research_data_integrity.sql` to install private lesson
   answer keys, server-authoritative lesson operations, safe assessment-resume reads, serialized
   assessment answer mutation, and non-destructive progress initialization.
10. Run `supabase/migrations/202609050002_assessment_answer_conflict_fix.sql` to apply the
    PostgreSQL-safe assessment answer upsert conflict target.
11. Run `supabase/migrations/202609060001_assessment_revision_sync.sql` together with the
    revision-aware frontend. This disables legacy unversioned mutation access and installs
    revision-based draft synchronization and completion.
12. Run `supabase/migrations/202609080001_researcher_role_cleanup.sql` to remove the obsolete
    profile role after researcher authorization has moved to `researcher_users`.
13. Copy the project URL and publishable key from **Project Settings > API Keys**.
14. Create `.env.local` from `.env.example` and add those two public values.

Never place the `service_role` key in the Vite app, Git repository, or Vercel browser environment.

## Vercel

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the Vercel project environment variables.
Apply every migration, including the assessment answer upsert, research-data integrity,
assessment conflict-fix, revision-sync, and researcher-role cleanup migrations, before deploying
this frontend. The integrity migration changes
RPC signatures and removes the old direct-write grants, so the new frontend and migrations must be
released together, database first. Redeploy only after the database migrations and application tests
pass.

## Researcher access

New accounts are always students. Copy the approved account UUID from
**Authentication > Users**, then grant researcher access in the Supabase SQL Editor:

```sql
insert into public.researcher_users (user_id)
values ('PASTE-USER-UUID-HERE');
```

Revoke access with:

```sql
delete from public.researcher_users
where user_id = 'PASTE-USER-UUID-HERE';
```

Researcher access is view-only and research-only. Editing lessons, managing users,
exports, and advanced analytics require a separately scoped admin system.

## Batch 2 assessment revision sync

`supabase/migrations/202609060001_assessment_revision_sync.sql` must be validated in a
disposable/local database before a coordinated release. It revokes the legacy unversioned answer/completion
RPC grants, so old cached clients must refresh/update; do not deploy it independently
of the revision-aware frontend. Apply the database migration before releasing the
new frontend during the coordinated rollout. The new client deliberately fails
closed if the revision columns/RPCs are unavailable.

## Researcher authorization cleanup

`supabase/migrations/202609080001_researcher_role_cleanup.sql` removes `profiles.role`
and the now-unused `app_role` enum. Researcher access is granted and revoked only through
`researcher_users`; the migration deliberately fails if that authoritative table is missing.

### Revision and recovery contract

- Each answer mutation advances the local integer `revision` and receives a UUID
  `mutationId`. Question navigation and submission intent do not advance an answer
  revision, except a legacy revision-zero submission gets its first snapshot revision.
- `syncedRevision` is the acknowledged server base, not a timestamp. A snapshot RPC
  sends that base, its revision/token, and all selected choices. Under the owning
  attempt-row lock, the server accepts only the exact current base and a strictly
  newer revision. An exact revision/token/answer retry is idempotent. Conflicting
  tabs are rejected even if their local counter is larger. Server time never chooses
  the winning answer.
- `pendingSnapshot` records the last sent revision/token before transmission. It is
  retained by newer edits. After a lost response, an authoritative match advances
  only `syncedRevision`; newer in-memory answers remain pending and are sent next.
- One coordinator owns autosync, retry, online/focus/visibility events, manual Submit,
  and pending-submission recovery. It reads server status before writes, drains the
  latest memory snapshot, and finalizes only its acknowledged revision. Answer editing
  is frozen while submission is unresolved. Retry backoff has one timer and a bounded
  automatic burst; a meaningful user/connectivity trigger starts a new burst.
- Completion uses server scoring and records `submitted_revision`. Ambiguous responses
  are recovered through authoritative status, without replaying answers into a submitted
  attempt. IndexedDB deletion is conditional on the submitted revision/token still
  matching the stored draft. A different/newer draft is retained and reported.
- Local-write failure does not block immediate navigation or replace current memory
  with an older disk draft. The UI distinguishes local failure, local-save pending,
  saved locally/account pending, syncing, and account acknowledgement. Keep the tab
  open when local saving fails; a refresh cannot recover unsaved memory.
- A conflict preserves local answers and offers an explicit, confirmed replacement
  with the account copy. There is no automatic merge/discard across independent tabs.
  Previously queued writes from older clients cannot bypass the new revision RPC.

### Verification boundaries and manual QA

The automated tests exercise the coordinator, real fake-IndexedDB persistence,
service requests, React bootstrap/player behavior, and static migration contracts.
Static SQL tests are not a substitute for PostgreSQL execution or live concurrency
testing. The API timeout cannot cancel an already-running database transaction;
the shared row lock, revision checks and idempotent completion protect that boundary.

Before rollout, test both pre-test and post-test: answer/Next on a throttled network;
offline answer and refresh; offline Submit then reconnect; lost sync response followed
by another edit; lost completion response; two conflicting tabs; IndexedDB quota
failure; bootstrap Retry; account/route changes during loading. Confirm no correctness
feedback appears, local warnings are honest, only the confirmed revision is cleared,
and submitted server scores are unchanged. Test old cached-client update behavior as
part of the coordinated database/frontend release.
