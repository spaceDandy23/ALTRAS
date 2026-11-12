-- Prevent the temporary visual-testing curriculum from reaching students.
-- Keep drafts, immutable definitions, and learner history for audit/recovery.
begin;

-- Restore the two pre-existing lessons to their newest non-demo immutable
-- definition. Their CMS drafts are left intact so no authored data is lost.
update public.lesson_catalog catalog
set published = true,
    published_version = (
      select max(definition.content_version)
      from public.lesson_definitions definition
      where definition.lesson_id = catalog.lesson_id
        and definition.presentation::text not ilike '%temporary%'
    ),
    revision = catalog.revision + 1,
    updated_at = now()
where catalog.lesson_id in ('lesson-operation-signals', 'lesson-order-matters')
  and catalog.published = true
  and catalog.draft::text ilike '%temporary%'
  and exists (
    select 1 from public.lesson_definitions definition
    where definition.lesson_id = catalog.lesson_id
      and definition.presentation::text not ilike '%temporary%'
  );

-- The remaining three lessons were created only for visual testing.
update public.lesson_catalog
set published = false,
    published_version = null,
    revision = revision + 1,
    updated_at = now()
where published = true
  and lesson_id in (
    'lesson-foundational-concepts',
    'lesson-writing-verbal-expressions',
    'lesson-translating-mathematical-expressions'
  )
  and draft::text ilike '%temporary%';

commit;
