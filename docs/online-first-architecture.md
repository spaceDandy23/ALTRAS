# Online-first data architecture

Supabase is authoritative for authentication, profiles, student settings, lesson progress,
lesson attempts and history, assessments, and researcher results. Failed online writes are
reported to the interface and are never replaced with a browser-only success path.

Researcher authorization has one source of truth: membership in `public.researcher_users`.
The secured `public.is_researcher()` function is shared by RLS and researcher RPCs, while the
frontend resolves the same authority before selecting the student or researcher experience.
Profiles contain identity/display data only and do not carry an authorization role.

Research outcomes are database-derived. Students submit only validated lesson identities and raw
answers through RPCs; private server-side lesson definitions determine activity type, correctness,
passing thresholds, scores, stars, XP, and unlock targets. Authenticated clients have no direct
write privilege on lesson attempts, answers, or progress. Assessment resume data is exposed through
a safe projection containing selected choices but no correctness or answer keys, and answer updates
serialize with final scoring by locking the same assessment-attempt row.

Browser storage has two non-authoritative roles:

- Dexie database `altras-content` caches validated bundled sections, units, lessons, lesson items,
  and the packaged-content version. It also keeps resumable assessment drafts keyed by the
  authenticated user ID, assessment type, and server attempt ID. Draft answers remain local only
  while a server write is pending; Supabase remains authoritative for scoring and completion.
- `localStorage` caches only theme, readability scale, and animation preference. Entries and the
  active cache identity are keyed by the authenticated Supabase user ID. Login and session restore
  apply that user's cache before loading settings; Supabase then reconciles it. Logout removes the
  active identity.

The previous `altras-local` database is no longer opened by the application. Existing browser data
is left untouched rather than being destructively deleted at startup, but it cannot authenticate a
user or affect application state.

After session restoration, the experience remains neutral until researcher access is resolved.
Student shell preferences and audio are enabled only for a confirmed student experience; the
researcher workspace stays view-only and silent. Session loss or account switching clears the
previous user's scoped stores before the next account hydrates.

The PWA manifest, service worker, Workbox app-shell caching, and installability remain enabled.
PWA caching does not provide offline authoritative writes. Assessment choice changes are written
to the local draft immediately and synchronized in the background with bounded retry delays, so
moving between questions is not blocked by network latency. The UI identifies pending sync, flushes
before final submission, and preserves a pending-submission draft when submission fails. A later
server response cannot overwrite a newer local draft revision.

## Preview QA checklist

- Register a new student and confirm the Supabase Auth user, profile, settings, and initial progress rows.
- Log out and back in; confirm the same profile and progress return.
- Switch between two accounts; confirm profile, theme, text size, progress, and active attempts never cross accounts.
- Refresh on light/dark theme and each text size; confirm the cached appearance applies immediately and then matches Supabase.
- Change settings, wait for Saved, refresh, and confirm the values persist. Disconnect and confirm failed saves show an error.
- Complete Lesson 1, confirm score/stars/XP and Lesson 2 unlock, then refresh and sign in on another device to confirm persistence.
- Start and partially complete a lesson, refresh/re-login, and confirm Resume restores the same Supabase attempt without duplicates.
- Restart a lesson and confirm the prior attempt is abandoned rather than deleted; finish and verify attempt history/result stability.
- Complete pre-test and post-test; verify question navigation stays responsive while answers sync,
  pending state is visible, final submission waits for pending answers, retry recovers, and no
  correct-answer feedback appears mid-test.
- Sign in as an authorized researcher and confirm anonymized, view-only results; confirm a student cannot access that route.
- Disconnect the network; confirm the offline notice appears, cached shell/reference content may render, and authoritative actions fail visibly without a local-success fallback.
- Repeat the primary flows at 1366x768, 1920x1080, and a supported mobile viewport.

Migration `202609040001_assessment_answer_draft_upsert.sql` is required. It allows an active
assessment attempt to revise an answer through the existing validated RPC while preserving user
ownership, hidden correctness, and server-authoritative scoring.

Migration `202609050001_research_data_integrity.sql` must follow it and must be applied before the
matching frontend is deployed. It replaces client-authoritative lesson writes, makes progress
initialization insert-only/forward-only, removes direct assessment-correctness reads, and changes
the lesson completion and assessment-resume RPC contracts.

Migration `202609050002_assessment_answer_conflict_fix.sql` follows the integrity migration and
names the assessment answer uniqueness constraint explicitly so the safe table-returning RPC does
not encounter a PL/pgSQL output-column ambiguity during answer upserts.
