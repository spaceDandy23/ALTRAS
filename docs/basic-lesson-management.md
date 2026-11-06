# Basic Lesson Management

## Access and deployment

Apply migrations in order, database first, then deploy this frontend. From the ALTRAS repository:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Review the linked project and dry-run output before approving the remote write. These commands were not run against a hosted project during implementation.

`202609120002_basic_lesson_management.sql` follows `202609120001_student_streaks.sql` and the earlier integrity/auth migrations. The catalog migration relies on the private definitions/keys and scoring contracts installed by `202609050001_research_data_integrity.sql`. It preserves, rather than reinstalls, the streak completion trigger. Apply the full pending chain, including streaks if still pending. No historical migration is edited.

Provision an Auth account normally or manually, then explicitly grant access in the trusted Supabase SQL editor:

```sql
insert into public.admin_users (user_id)
values ('REPLACE-WITH-APPROVED-AUTH-USER-UUID')
on conflict do nothing;
```

Open `/admin/lessons` after login. To revoke access:

```sql
delete from public.admin_users
where user_id = 'REPLACE-WITH-APPROVED-AUTH-USER-UUID';
```

Admin authorization is independent of `researcher_users`: neither students nor researchers can self-promote. A researcher needs a separate explicit admin grant. Researchers still log in to their researcher workspace; an explicitly approved researcher/admin can then open `/admin/lessons` directly. No researcher navigation or reporting UI is changed. Admin pages use neutral typography/audio scope, not the student shell.

## Data flow and snapshots

- `lesson_catalog` contains private editable drafts and a current publication pointer.
- Publishing validates the draft and creates a new immutable `(lesson_id, content_version)` in the existing private `lesson_definitions`/`lesson_activity_keys` system. This is not a second scoring engine.
- Lessons 1–2 are seeded using their original lesson/activity IDs and existing versions 1 and 2. Seeding adds presentation/feedback without rewriting original scoring rules, attempts, progress, XP, stars, or streak history.
- Each attempt uses its pinned version for content, answers, thresholds, completion and results. Editing a draft never changes a published version.
- Unpublish hides a lesson from the student catalog and rejects new starts. Owners can still load/finish an existing attempt and view its historical result by attempt ID. A published dependent must be unpublished first; unpublishing does not erase history.
- The authenticated public catalog and content RPCs return allowlisted presentation fields. Private keys and authored feedback are unavailable before submission. After an answer is recorded, only that attempt owner's submitted activity receives its explanation and, for find-word, its correct-choice highlight. Other students' attempts cannot be used to read feedback.
- `initialize_lesson_progress` and completion unlocking operate only on current published snapshots. Removing/adding a prerequisite recalculates untouched lock states; started lesson prerequisites cannot be changed. Scores and rewards remain server-authoritative.

The student runtime no longer imports `packaged-content.ts`. That file and the explicit `initializePackagedContent`/`getCachedLesson` helpers remain test/legacy-cache compatibility fixtures only. `catalog-shell.ts` bundles section/unit framing, not lesson keys. Startup clears old lesson/item caches without touching assessment drafts. Already downloaded old builds cannot be made to forget their bundled keys; update old installed PWAs during rollout.

## Authoring and validation

The dedicated page lists title, order, publication state, activity count, prerequisite and Edit. The form supports title, short description, order, passing score, prerequisite, save draft, publish, unpublish and preview. Reordering activities is explicit up/down, not drag/drop.

Only existing `find-word` and `organize-translate` renderers are supported. Configure choice labels/correct choice or token labels/correct token order, prompt, expression, optional hint and feedback. Activity add/delete/reorder never reuses a removed activity ID.

At most 10 activities are enforced by the editor, service, save/publish RPCs and table CHECK. Publication requires 1–10, unique activity/content and option IDs, valid scoring keys, required text, valid metadata, a unique positive published order and a 0–100 passing score. Prerequisites must exist, be published, precede the lesson and be acyclic. Self references are rejected. Drafts may be incomplete; publication is the strict validation boundary. Revision checks reject stale editor writes; authoring changes are serialized transactionally.

Direct browser table writes are revoked. Admin RPCs are SECURITY DEFINER with an empty search path and an explicit `is_admin()` check. Anonymous users cannot execute them. Private compiler/validator functions are not executable by app roles. Preview uses the existing activity renderers with in-memory answer evaluation only: no student attempt, progress, XP, stars, streak, completion record or analytics writes; no completion/reward audio.

## Verification and manual QA

Automated coverage includes executable PostgreSQL migrations/RLS in PGlite, pre-migration progress/attempt/streak preservation, both original lessons, publishing/version pinning, old/new attempts, archive reads, public projection, prerequisite validation, preview isolation, editor limits, service validation, and route authorization. Existing Home, unlock announcement, result audio, auth, progression and streak suites remain part of the full run.

PGlite emulates Supabase identities/roles and omits its unavailable pgcrypto extension; hosted auth/PostgREST and real concurrent requests still need a staging smoke test.

Local headless Edge QA rendered the real list/editor/preview with isolated RPC fixtures at 320, 390, 768 and 1366 pixels in both themes (24 combinations). No whole-page horizontal overflow; the editor switches from one column on phones to two on larger screens, and the experience stays neutral. This validates layout, not live Supabase authorization.

Manual checklist:

1. Student/researcher without explicit admin membership and logged-out users cannot open or call authoring APIs. Explicit admin can open `/admin/lessons`; revoke membership and confirm a subsequent write fails.
2. Create an ephemeral QA draft, add/edit/reorder/delete both activity types, try an 11th, save/reload and preview. Verify preview adds no learning/analytics rows and plays no completion/reward sound.
3. Publish a valid QA lesson after Lesson 2; confirm it appears locked, clears/unlocks normally and records XP/stars/streak on a real completion. Do not publish test content to production.
4. Start an attempt, edit/re-publish its lesson, then resume: old activity IDs/content/threshold remain. A subsequent new attempt uses the new snapshot.
5. Unpublish and verify no new start; saved attempt/result still opens. Try missing, circular, self and unpublished prerequisites.
6. Verify Lessons 1–2 retry/resume, Home active-attempt priority, status wording, unlock announcement once, result audio and researcher reporting.
7. Check admin list/editor/preview at 320px, mobile, tablet and desktop in both themes. Tables may scroll horizontally inside their wrapper; the whole page must not overflow.
8. Check two editor sessions: stale Save/Publish reports a revision conflict instead of overwriting.

## Deliberate limits

No new Lessons 3–8 content, role system, user/researcher management, media, rich text, imports, analytics editing, version-history UI or approval workflow. Section/unit framing stays fixed. Instructions/character overrides already attached to seeded lessons are preserved; this basic editor is not an instruction-page/character CMS. Unpublish is reversible archival, not deletion. Lesson loading requires the authenticated online catalog; no new offline authoring or private-key cache is added.

## Continuation audit and validation results

The interrupted work already contained the migration, admin list/editor/preview/guard, public content schemas, database catalog reads, attempt-pinned content and route wiring. These were retained. The database test file was still only in the staging workspace; documentation and frontend authoring tests were absent. The staged/public compiler projection needed finishing, publish validation needed stricter JSON types, and untouched prerequisite lock states were not recalculated after an edit. The overview also still hardcoded Lesson 1 in its prerequisite message and showed latest metadata for an old active attempt. These gaps were completed without changing auth, scoring, audio or researcher reporting.

Final validation on 2026-09-12:

- Full suite: **69 files, 363 tests passed**. Focused admin/content/overview run: 60 passed before the final additional overview regression, which also passed in the full run.
- App and node TypeScript no-emit: passed.
- ESLint: passed.
- Production build/PWA generation: passed; emitted the >500 kB chunk advisory (main JS about 810 kB uncompressed). No code-splitting redesign was added.
- Production assets contain none of the original private lesson fixture identifiers or temporary QA HTML references.
- Real Edge layout QA: 24 list/editor/preview × viewport × theme combinations passed with isolated backend fixtures. No hosted migration or live-user test was run.
- Historical migrations unchanged; no commit or push.

### Exact changed/new files

```text
docs/basic-lesson-management.md
docs/online-setup.md
src/app/App.tsx
src/features/admin/ActivityEditor.tsx
src/features/admin/AdminRoute.tsx
src/features/admin/LessonContentPreview.tsx
src/features/admin/LessonManagementPage.tsx
src/features/admin/lesson-management.css
src/features/admin/lesson-management.database.test.ts
src/features/admin/lesson-management.service.ts
src/features/admin/lesson-management.test.tsx
src/features/lessons/ActiveLessonPage.tsx
src/features/lessons/LessonOverviewPage.test.tsx
src/features/lessons/LessonOverviewPage.tsx
src/features/lessons/LessonResultPage.tsx
src/features/lessons/attempts/online-attempt.service.ts
src/features/lessons/content/catalog-shell.ts
src/features/lessons/content/content.service.test.ts
src/features/lessons/content/content.service.ts
src/features/lessons/content/published-content.test.ts
src/features/lessons/domain/content.schemas.ts
src/features/lessons/domain/evaluation.ts
src/features/lessons/progress/online-progress.service.ts
src/features/menu/MainMenuPage.tsx
src/features/word-list/WordListPage.test.tsx
src/stores/content.store.ts
supabase/migrations/202609120002_basic_lesson_management.sql
```
