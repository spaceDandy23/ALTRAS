# Lesson chapters Phase 2

## Runtime flow

New lessons can reference the published global pre-test and post-test from their lesson draft. Publishing pins those assessment versions to the immutable lesson definition. Each new lesson attempt then follows its server-owned `flow_stage`:

`pre-test -> chapter teaching -> chapter activities -> ... -> post-test -> ready-to-complete`

Assessment attempts are scoped to the lesson attempt, so completing a standalone assessment or another lesson's assessment cannot satisfy the flow. Correct answers remain in the existing private assessment tables and scoring functions.

Legacy lessons with one migrated default chapter and no explicit assessment configuration retain the existing flat activity flow. Existing active and historical attempts remain `legacy-activity` and are not reset.

## Resume and progression

Supabase stores the lesson stage, current chapter, and pinned assessment versions on `lesson_attempts`. Activity answers remain ordered and scored by the existing lesson attempt. Chapter transitions do not create chapter XP, stars, attempts, progress rows, or unlocks.

## Offline boundary

Existing offline activity answers and active-time segments remain durable. Assessment drafts remain durable and are isolated by assessment attempt. Advancing between server-owned lesson stages currently requires a connection; the UI keeps the student at the completed step and asks them to reconnect. Phase 3 can queue those stage acknowledgements without changing the identifiers or database model introduced here.

## Deployment

Apply both chapter migrations in order:

```powershell
npx supabase migration list
npx supabase db push --linked --dry-run
npx supabase db push --linked
```
