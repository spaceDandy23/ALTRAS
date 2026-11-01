# Lesson chapters — Phase 1

Phase 1 adds ordered chapter authoring without changing lesson-scoped progression, attempts,
scoring, XP, stars, prerequisites, or student navigation.

## Representation and compatibility

Chapters are nested in the existing versioned lesson JSON. Each chapter has an ID, title, optional
description, display order, teaching-content blocks, and ordered activities. The existing activity
types and IDs are unchanged.

`202610300001_lesson_chapters.sql` wraps every existing lesson draft and published presentation in
one `Chapter 1`. Lesson IDs, activity IDs, content versions, attempts, answers, progress, scores,
streaks, and research history remain in place. The database derives the existing flat
`instructionalContent` and `activities` arrays from chapters before saving or publishing. That flat
payload keeps the Phase 1 student player unchanged; published content also carries `chapters` for
the future Phase 2 flow.

Chapter timestamps are intentionally represented by the owning catalog draft's existing
`updated_at` and immutable publication version rather than adding mutable timestamps inside a JSON
snapshot.

## CMS and security

The existing `/admin/lessons` editor can create, edit, reorder, and confirm deletion of chapters;
author teaching explanations/examples/notes; add and reorder activities within a chapter; and move
an activity to another chapter. Deleting a chapter removes its nested draft content only after the
shared confirmation dialog. Live content remains unchanged until the draft is published.

No new browser mutation surface was added. The existing `save_admin_lesson` and
`set_lesson_publication` SECURITY DEFINER RPCs retain their `is_admin()` checks. Chapter structure,
global content-ID uniqueness, ordering, and the ten-activity lesson limit are enforced at the
database boundary. Students and researchers cannot mutate catalog drafts.

## Assessments and offline scope

Current pre-test/post-test records use global enum kinds and one attempt per user/kind; they are not
reusable lesson-owned assessment entities. Phase 1 therefore does not store misleading lesson links.
Phase 2 must first define lesson-owned assessment definitions and update the current uniqueness and
runtime routing contracts.

The app remains online-first and Supabase-authoritative. Chapter data is returned in the same lesson
content response, so no second content cache is needed. Existing offline answer drafts and lesson
attempt synchronization continue to use the flat compatibility activity sequence until Phase 2
introduces chapter checkpoints.

## Deployment

Apply migrations in order, database first:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Then deploy the matching frontend. Do not deploy the chapter-aware editor before the migration.
