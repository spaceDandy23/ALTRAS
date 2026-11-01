# Lesson chapters Phase 3

Phase 3 keeps the Phase 2 lesson sequence reliable when connectivity is interrupted. The lesson
remains the only progression and reward unit.

## Local recovery

The existing Dexie lesson draft now stores ordered pending stage transitions beside activity
answers and active-time segments. The draft remains scoped by user, lesson, and attempt. Assessment
drafts keep their existing attempt-scoped question snapshot, answers, revision, and pending-submit
state. A retry uses a new attempt ID, so an older attempt draft is not restored into it.

Cached lesson content supports offline chapter teaching and activities. Pre-test and post-test work
can be restored from an existing assessment draft. A final assessment or lesson result stays pending
until Supabase confirms it.

## Reconnect rules

Pending lesson work replays in its original sequence. Activity answers and active-time segments keep
their existing idempotency keys. Stage changes call `sync_lesson_attempt_stage` with the stage and
chapter the client expected before the change. If Supabase already accepted that change but its
response was lost, the RPC returns the current attempt instead of advancing twice.

Server progression wins during reconciliation. Local transitions beyond the server position remain
queued, while transitions and answers already accepted by Supabase are removed from the draft.
Lesson completion remains server-authoritative and the existing completion RPC remains idempotent,
so reconnect retries cannot duplicate attempt counts, XP, stars, or unlocks.

## Deployment

Apply the forward-only migration before deploying the Phase 3 client:

```powershell
npx supabase db push --linked
```

## Local-first repair batch

An already-started attempt now opens its validated, pinned Dexie lesson draft before any network
read. Chapter teaching, activity answers, and activity positions save locally before navigation.
Background acknowledgements merge into the latest stored draft; they do not reset the visible
chapter or activity. Supabase still owns official results and rewards.

Starting a lesson pins safe assessment question snapshots alongside the lesson content. The
Pre-test can start locally with a stable assessment ID, save answers, and finish without a server
response. Submitting it atomically saves submission intent and the local transition into Chapter 1.
The pending view offers Continue Lesson and does not invent an official score. No assessment keys
are cached. New Post-test completion/results UX is deferred to Batch 2.

The shared authenticated scheduler runs the existing lesson and assessment synchronizers in
dependency order, including while the student is on Home or Lessons. Both use per-attempt worker
locks and existing server idempotency. Failed drafts remain pending, corrupt records are retained
and isolated, and retries continue at 60-second intervals after the fast retry burst. Offline or
hidden tabs pause retry work and resume on connectivity, visibility, or focus.

Apply `202610310001_offline_assessment_start.sql` after the existing Phase 3 migrations. It extends
the assessment-start RPC with an optional client ID; ownership, student access, pinned versions,
and creation-stage checks remain server-enforced. An already-created assessment can be recovered
idempotently even after its stage has advanced.

### Manual QA

1. Sign in as a student online and start a chapter lesson. Wait for the Pre-test introduction.
2. Disconnect during the Pre-test. Answer all questions using Previous/Next and submit.
3. Check that the saved notice appears without an official score. Click Continue Lesson and
   confirm Chapter 1 opens immediately.
4. Start chapter activities, answer several offline, and continue. Confirm each answer and the
   current position are stored before continuing.
5. Reconnect while an answer/transition is pending. Confirm background sync finishes without
   moving the visible activity backwards or replaying old feedback sounds.
6. Repeat with a request interrupted in flight and with navigation away to Lessons before
   reconnecting. Reopen the same attempt and confirm the position and answers remain intact.

Lesson/assessment remount recovery is covered by tests. A full browser restart additionally needs
the existing authentication and researcher/admin access bootstrap to succeed. Those checks have
not been bypassed with a cached identity; offline cold-start account verification remains a
separate limitation to resolve securely before promising unrestricted offline reload.
The user selected a separate secure-access batch; see
[Secure offline access scope](secure-offline-access-scope.md). No cached-identity authentication
fallback is part of this batch.
