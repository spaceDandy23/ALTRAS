-- The visual-test cleanup restored the original published definitions for these
-- lessons but intentionally retained their temporary drafts. Repair only the
-- two known temporary display-order values; leave every other draft edit intact.
begin;

with restored_orders(lesson_id, stale_order) as (
  values
    ('lesson-operation-signals'::text, 2),
    ('lesson-order-matters'::text, 3)
), published_orders as (
  select catalog.lesson_id, (definition.presentation->>'displayOrder')::integer as display_order
  from public.lesson_catalog catalog
  join public.lesson_definitions definition
    on (definition.lesson_id, definition.content_version) = (catalog.lesson_id, catalog.published_version)
  join restored_orders restored on restored.lesson_id = catalog.lesson_id
  where catalog.published
    and catalog.draft::text ilike '%temporary%'
    and (catalog.draft->>'displayOrder')::integer = restored.stale_order
)
update public.lesson_catalog catalog
set draft = jsonb_set(catalog.draft, '{displayOrder}', to_jsonb(published_orders.display_order)),
    revision = catalog.revision + 1,
    updated_at = now()
from published_orders
where catalog.lesson_id = published_orders.lesson_id
  and published_orders.display_order <> (catalog.draft->>'displayOrder')::integer;

create or replace function public.get_admin_lesson_order_conflict(
  p_lesson_id text,
  p_display_order integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare conflict jsonb;
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if p_display_order is null or p_display_order < 1 then
    raise exception 'Lesson order must be a positive integer.';
  end if;

  select jsonb_build_object(
    'lessonId', catalog.lesson_id,
    'title', definition.presentation->>'title',
    'displayOrder', (definition.presentation->>'displayOrder')::integer
  ) into conflict
  from public.lesson_catalog catalog
  join public.lesson_definitions definition
    on (definition.lesson_id, definition.content_version) = (catalog.lesson_id, catalog.published_version)
  where catalog.published
    and catalog.lesson_id <> p_lesson_id
    and (definition.presentation->>'displayOrder')::integer = p_display_order
  order by catalog.lesson_id
  limit 1;

  return conflict;
end;
$$;

create or replace function public.set_lesson_publication(p_lesson_id text, p_publish boolean, p_revision bigint) returns public.lesson_catalog
language plpgsql security definer set search_path = '' as $$
declare
  item public.lesson_catalog;
  result public.lesson_catalog;
  v integer;
  prereq text;
  current_prereq text;
  cursor_id text;
  path text[];
  conflicting_title text;
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(20260912, 2);
  select * into item from public.lesson_catalog where lesson_id = p_lesson_id for update;
  if item.lesson_id is null or p_publish is null then raise exception 'Lesson not found.'; end if;
  if p_revision is distinct from item.revision then raise exception 'This lesson changed in another session. Reload before publishing.' using errcode = '40001'; end if;
  if not p_publish then
    if exists(select 1 from public.lesson_catalog c join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
      where c.published and d.prerequisite_lesson_id = p_lesson_id) then raise exception 'Unpublish dependent lessons first.'; end if;
  else
    perform public.validate_authored_lesson(item.draft);
    prereq := nullif(item.draft->>'prerequisiteLessonId','');
    path := array[p_lesson_id]; cursor_id := prereq;
    while cursor_id is not null loop
      if cursor_id = any(path) then raise exception 'Prerequisites cannot contain a cycle.'; end if;
      path := array_append(path,cursor_id);
      if not exists(select 1 from public.lesson_catalog where lesson_id=cursor_id and published) then raise exception 'Publish the prerequisite first.'; end if;
      select d.prerequisite_lesson_id into cursor_id from public.lesson_catalog c join public.lesson_definitions d
        on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version) where c.lesson_id=cursor_id;
    end loop;
    select d.presentation->>'title' into conflicting_title
    from public.lesson_catalog c
    join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
    where c.published
      and c.lesson_id <> p_lesson_id
      and (d.presentation->>'displayOrder')::integer = (item.draft->>'displayOrder')::integer
    order by c.lesson_id
    limit 1;
    if conflicting_title is not null then
      raise exception 'Lesson order % is already used by "%".', (item.draft->>'displayOrder')::integer, conflicting_title;
    end if;
    if exists(select 1 from public.lesson_catalog c join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
      where c.published and ((c.lesson_id=prereq and (d.presentation->>'displayOrder')::integer >= (item.draft->>'displayOrder')::integer)
      or (d.prerequisite_lesson_id=p_lesson_id and (d.presentation->>'displayOrder')::integer <= (item.draft->>'displayOrder')::integer))) then raise exception 'Prerequisites must appear before their dependent lessons.'; end if;
    select prerequisite_lesson_id into current_prereq from public.lesson_definitions where lesson_id=p_lesson_id and content_version=item.published_version;
    if current_prereq is distinct from prereq and exists(select 1 from public.lesson_attempts where lesson_id=p_lesson_id) then raise exception 'Cannot change the prerequisite after students have started this lesson.'; end if;
    select coalesce(max(content_version),0)+1 into v from public.lesson_definitions where lesson_id=p_lesson_id;
    perform public.compile_lesson(item.draft,v);
  end if;
  update public.lesson_catalog set published=p_publish, published_version=case when p_publish then v else published_version end,
    revision=revision+1, updated_at=now() where lesson_id=p_lesson_id returning * into result;
  return result;
end;
$$;

revoke all on function public.get_admin_lesson_order_conflict(text,integer) from public, anon;
grant execute on function public.get_admin_lesson_order_conflict(text,integer) to authenticated;

commit;
