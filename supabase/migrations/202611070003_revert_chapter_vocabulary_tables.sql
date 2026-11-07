-- Revert only chapter-level Vocabulary validation and publication support.
-- Lesson-level dynamic Vocabulary tables remain supported by earlier migrations.
begin;

create or replace function public.validate_lesson_chapter_draft(p jsonb) returns void
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

create or replace function public.compile_single_accepted_organize_answers(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare
  chapter jsonb; safe_chapter jsonb; safe_chapters jsonb := '[]';
  safe_instructions jsonb; safe_activities jsonb; presentation jsonb; flattened jsonb;
begin
  perform public.validate_chapter_authored_lesson(p);
  flattened := public.flatten_lesson_chapters(p);
  perform public.compile_legacy_lesson(flattened, v);
  select definition.presentation into presentation
  from public.lesson_definitions definition
  where definition.lesson_id = p->>'id' and definition.content_version = v;
  for chapter in select value from jsonb_array_elements(p->'chapters') order by (value->>'displayOrder')::integer loop
    select coalesce(jsonb_agg(public.lesson_public_fields(value,
      case when value->>'type'='example' then array['id','type','phrase','expression','note']
        when value->>'type'='vocabulary-table' then array['id','type','title','rows','tables']
        else array['id','type','title','body'] end) order by ordinality), '[]'::jsonb)
    into safe_instructions from jsonb_array_elements(chapter->'instructionalContent') with ordinality;
    select coalesce(jsonb_agg(public_activity.value order by authored.ordinality),'[]'::jsonb)
    into safe_activities from jsonb_array_elements(chapter->'activities') with ordinality authored(value,ordinality)
    join jsonb_array_elements(presentation->'activities') public_activity(value)
      on public_activity.value->>'id'=authored.value->>'id';
    safe_chapter := public.lesson_public_fields(chapter,array['id','title','description','displayOrder'])
      || jsonb_build_object('instructionalContent',safe_instructions,'activities',safe_activities);
    safe_chapters := safe_chapters || jsonb_build_array(safe_chapter);
  end loop;
  update public.lesson_definitions definition
  set presentation = definition.presentation || jsonb_build_object('chapters',safe_chapters)
  where definition.lesson_id=p->>'id' and definition.content_version=v;
end;
$$;

commit;
