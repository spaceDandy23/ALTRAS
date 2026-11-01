-- Phase 1 lesson chapters. Lesson progression and attempts remain lesson-scoped.
begin;

-- Preserve the existing authoring validator/compiler as the flat player compatibility layer.
alter function public.validate_authored_lesson(jsonb) rename to validate_legacy_authored_lesson;
alter function public.compile_lesson(jsonb, integer) rename to compile_legacy_lesson;

create function public.validate_lesson_chapter_draft(p jsonb) returns void
language plpgsql
set search_path = ''
as $$
declare
  chapter jsonb;
  chapter_ids text[] := array[]::text[];
  chapter_orders integer[] := array[]::integer[];
  content_ids text[] := array[]::text[];
  item jsonb;
begin
  if jsonb_typeof(p->'chapters') is distinct from 'array' then
    raise exception 'Chapters must be an array.';
  end if;

  for chapter in select value from jsonb_array_elements(p->'chapters') loop
    if jsonb_typeof(chapter) <> 'object'
      or coalesce(chapter->>'id', '') !~ '^[a-z0-9-]{3,100}$'
      or jsonb_typeof(chapter->'title') is distinct from 'string'
      or jsonb_typeof(chapter->'displayOrder') is distinct from 'number'
      or coalesce(chapter->>'displayOrder', '') !~ '^[0-9]{1,5}$'
      or (chapter->>'displayOrder')::integer < 1
      or jsonb_typeof(chapter->'instructionalContent') is distinct from 'array'
      or jsonb_typeof(chapter->'activities') is distinct from 'array'
      or (chapter ? 'description' and jsonb_typeof(chapter->'description') <> 'string') then
      raise exception 'Invalid chapter structure.';
    end if;
    if chapter->>'id' = any(chapter_ids) then raise exception 'Chapter IDs must be unique.'; end if;
    if (chapter->>'displayOrder')::integer = any(chapter_orders) then raise exception 'Chapter order must be unique.'; end if;
    chapter_ids := array_append(chapter_ids, chapter->>'id');
    chapter_orders := array_append(chapter_orders, (chapter->>'displayOrder')::integer);

    for item in select value from jsonb_array_elements(chapter->'instructionalContent') loop
      if coalesce(item->>'id', '') = '' or item->>'id' = any(content_ids) then
        raise exception 'Content IDs must be present and unique across chapters.';
      end if;
      content_ids := array_append(content_ids, item->>'id');
    end loop;
    for item in select value from jsonb_array_elements(chapter->'activities') loop
      if coalesce(item->>'id', '') = '' or item->>'id' = any(content_ids) then
        raise exception 'Content IDs must be present and unique across chapters.';
      end if;
      content_ids := array_append(content_ids, item->>'id');
    end loop;
  end loop;

  if (select coalesce(sum(jsonb_array_length(value->'activities')), 0)
      from jsonb_array_elements(p->'chapters')) > 10 then
    raise exception 'A lesson supports at most 10 activities.';
  end if;
end;
$$;

revoke all on function public.validate_lesson_chapter_draft(jsonb) from public, anon, authenticated;

create function public.flatten_lesson_chapters(p jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p || jsonb_build_object(
    'instructionalContent', coalesce((
      select jsonb_agg(content.value order by chapter.ordinality, content.ordinality)
      from jsonb_array_elements(p->'chapters') with ordinality chapter(value, ordinality)
      cross join lateral jsonb_array_elements(chapter.value->'instructionalContent') with ordinality content(value, ordinality)
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(activity.value order by chapter.ordinality, activity.ordinality)
      from jsonb_array_elements(p->'chapters') with ordinality chapter(value, ordinality)
      cross join lateral jsonb_array_elements(chapter.value->'activities') with ordinality activity(value, ordinality)
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.flatten_lesson_chapters(jsonb) from public, anon, authenticated;

create function public.enforce_lesson_chapter_draft() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.validate_lesson_chapter_draft(new.draft);
  new.draft := public.flatten_lesson_chapters(new.draft);
  return new;
end;
$$;

revoke all on function public.enforce_lesson_chapter_draft() from public, anon, authenticated;

-- Existing lessons become one chapter without changing any lesson/content/activity identifiers.
update public.lesson_catalog
set draft = draft || jsonb_build_object(
  'chapters',
  jsonb_build_array(jsonb_build_object(
    'id', 'chapter-' || lesson_id,
    'title', 'Chapter 1',
    'description', coalesce(draft->>'shortDescription', ''),
    'displayOrder', 1,
    'instructionalContent', coalesce(draft->'instructionalContent', '[]'::jsonb),
    'activities', coalesce(draft->'activities', '[]'::jsonb)
  ))
)
where not draft ? 'chapters';

-- Published versions receive the same additive grouping. Their flat player payload is unchanged.
update public.lesson_definitions
set presentation = presentation || jsonb_build_object(
  'chapters',
  jsonb_build_array(jsonb_build_object(
    'id', 'chapter-' || lesson_id,
    'title', 'Chapter 1',
    'description', coalesce(presentation->>'shortDescription', ''),
    'displayOrder', 1,
    'instructionalContent', coalesce(presentation->'instructionalContent', '[]'::jsonb),
    'activities', coalesce(presentation->'activities', '[]'::jsonb)
  ))
)
where presentation is not null and not presentation ? 'chapters';

create trigger enforce_lesson_chapter_draft
before insert or update of draft on public.lesson_catalog
for each row execute function public.enforce_lesson_chapter_draft();

create function public.validate_authored_lesson(p jsonb) returns void
language plpgsql
set search_path = ''
as $$
declare chapter jsonb; flattened jsonb;
begin
  perform public.validate_lesson_chapter_draft(p);
  if jsonb_array_length(p->'chapters') = 0 then
    raise exception 'A published lesson requires at least one chapter.';
  end if;
  for chapter in select value from jsonb_array_elements(p->'chapters') loop
    if length(btrim(chapter->>'title')) = 0 or length(chapter->>'title') > 2000 then
      raise exception 'Chapter title is required (maximum 2000 characters).';
    end if;
    if length(coalesce(chapter->>'description', '')) > 4000 then
      raise exception 'Chapter description must be at most 4000 characters.';
    end if;
  end loop;
  flattened := public.flatten_lesson_chapters(p);
  perform public.validate_legacy_authored_lesson(flattened);
end;
$$;

revoke all on function public.validate_authored_lesson(jsonb) from public, anon, authenticated;

create function public.compile_lesson(p jsonb, v integer) returns void
language plpgsql
set search_path = ''
as $$
declare
  chapter jsonb;
  safe_chapter jsonb;
  safe_chapters jsonb := '[]'::jsonb;
  safe_instructions jsonb;
  safe_activities jsonb;
  presentation jsonb;
  flattened jsonb;
begin
  perform public.validate_authored_lesson(p);
  flattened := public.flatten_lesson_chapters(p);
  perform public.compile_legacy_lesson(flattened, v);
  select definition.presentation into presentation
  from public.lesson_definitions definition
  where definition.lesson_id = p->>'id' and definition.content_version = v;

  for chapter in
    select value from jsonb_array_elements(p->'chapters')
    order by (value->>'displayOrder')::integer
  loop
    select coalesce(jsonb_agg(public.lesson_public_fields(value,
      case when value->>'type' = 'example'
        then array['id','type','phrase','expression','note']
        else array['id','type','title','body'] end)), '[]'::jsonb)
    into safe_instructions
    from jsonb_array_elements(chapter->'instructionalContent');

    select coalesce(jsonb_agg(public_activity.value order by authored_activity.ordinality), '[]'::jsonb)
    into safe_activities
    from jsonb_array_elements(chapter->'activities') with ordinality authored_activity(value, ordinality)
    join jsonb_array_elements(presentation->'activities') public_activity(value)
      on public_activity.value->>'id' = authored_activity.value->>'id';

    safe_chapter := public.lesson_public_fields(chapter, array['id','title','description','displayOrder'])
      || jsonb_build_object('instructionalContent', safe_instructions, 'activities', safe_activities);
    safe_chapters := safe_chapters || jsonb_build_array(safe_chapter);
  end loop;

  update public.lesson_definitions definition
  set presentation = definition.presentation || jsonb_build_object('chapters', safe_chapters)
  where definition.lesson_id = p->>'id' and definition.content_version = v;
end;
$$;

revoke all on function public.compile_lesson(jsonb, integer) from public, anon, authenticated;

comment on function public.compile_lesson(jsonb, integer) is
  'Compiles ordered chapters and the unchanged flat player payload into an immutable lesson version.';

commit;
