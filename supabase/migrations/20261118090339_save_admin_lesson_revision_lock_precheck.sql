create or replace function public.save_admin_lesson(p_lesson jsonb, p_revision bigint) returns public.lesson_catalog
language plpgsql security definer set search_path = '' as $$
declare existing public.lesson_catalog; result public.lesson_catalog; prereq text; path text[]; cursor_id text;
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;

  -- Reject malformed input and revisions that are already stale before joining
  -- the global authoring lock queue.
  if p_lesson is null or jsonb_typeof(p_lesson) <> 'object' or length(p_lesson::text) > 100000 then raise exception 'Invalid or oversized lesson.'; end if;
  if coalesce(p_lesson->>'id','') !~ '^[a-z0-9-]{3,80}$' or coalesce(length(btrim(p_lesson->>'title')),0) = 0 then raise exception 'Lesson ID and title are required.'; end if;
  if coalesce(p_lesson->>'displayOrder','') !~ '^[0-9]{1,5}$' or (p_lesson->>'displayOrder')::integer < 1 then raise exception 'Lesson order must be a positive integer.'; end if;
  if jsonb_typeof(p_lesson->'activities') is distinct from 'array' then raise exception 'Activities must be an array.'; end if;
  if jsonb_array_length(p_lesson->'activities') > 10 then raise exception 'A lesson supports at most 10 activities.'; end if;
  select * into existing from public.lesson_catalog where lesson_id = p_lesson->>'id';
  if (existing.lesson_id is null and p_revision is distinct from 0) or (existing.lesson_id is not null and p_revision is distinct from existing.revision) then
    raise exception 'This lesson changed in another session. Reload before saving.' using errcode = '40001'; end if;

  perform pg_advisory_xact_lock(20260912, 2);

  -- Another save can win the lock after the precheck, so re-read and enforce
  -- optimistic concurrency while holding the same lock used by publication.
  select * into existing from public.lesson_catalog where lesson_id = p_lesson->>'id' for update;
  if (existing.lesson_id is null and p_revision is distinct from 0) or (existing.lesson_id is not null and p_revision is distinct from existing.revision) then
    raise exception 'This lesson changed in another session. Reload before saving.' using errcode = '40001'; end if;

  prereq := nullif(p_lesson->>'prerequisiteLessonId','');
  path := array[p_lesson->>'id']; cursor_id := prereq;
  while cursor_id is not null loop
    if cursor_id = any(path) then raise exception 'Prerequisites cannot contain a cycle or the lesson itself.'; end if;
    path := array_append(path,cursor_id);
    if not exists(select 1 from public.lesson_catalog where lesson_id = cursor_id) then raise exception 'Prerequisite lesson does not exist.'; end if;
    select nullif(draft->>'prerequisiteLessonId','') into cursor_id from public.lesson_catalog where lesson_id = cursor_id;
  end loop;
  insert into public.lesson_catalog(lesson_id,draft) values(p_lesson->>'id',p_lesson)
    on conflict(lesson_id) do update set draft = excluded.draft, revision = public.lesson_catalog.revision + 1, updated_at = now()
    returning * into result;
  return result;
end;
$$;
