-- Chapter teaching may be empty, or contain ordinary blocks and dynamic tables.
-- The lesson-level vocabulary/Overview block remains unchanged.
begin;

create or replace function public.validate_legacy_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare item jsonb; safe_items jsonb := '[]'::jsonb;
begin
  for item in select value from jsonb_array_elements(p->'instructionalContent') loop
    if item->>'type' = 'content-table' then
      if jsonb_typeof(item->'id') is distinct from 'string'
        or length(btrim(item->>'id')) = 0
        or item - array['id','type','tables'] <> '{}'::jsonb
        or jsonb_typeof(item->'tables') is distinct from 'array'
        or jsonb_array_length(item->'tables') = 0 then
        raise exception 'Teaching table blocks require an ID and at least one table.';
      end if;
      perform public.validate_content_tables(item->'tables');
      item := jsonb_build_object('id',item->>'id','type','paragraph','title','Teaching table','body','Table content');
    elsif item->>'type' = 'vocabulary-table' and item ? 'tables' then
      if jsonb_typeof(item->'id') is distinct from 'string'
        or jsonb_typeof(item->'title') is distinct from 'string' then
        raise exception 'Vocabulary block ID and title must be text.';
      end if;
      perform public.validate_content_tables(item->'tables');
      if item->'rows' is distinct from '[]'::jsonb then
        raise exception 'Use either legacy vocabulary rows or configurable tables.';
      end if;
      item := jsonb_build_object('id',item->>'id','type','paragraph','title',item->>'title','body','Table content');
    end if;
    safe_items := safe_items || jsonb_build_array(item);
  end loop;
  perform public.validate_pre_dynamic_tables_lesson(jsonb_set(p,'{instructionalContent}',safe_items));
end;
$$;

create or replace function public.compile_legacy_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare sanitized jsonb; safe_items jsonb;
begin
  select coalesce(jsonb_agg(case when value->>'type' in ('vocabulary-table','content-table')
    then jsonb_build_object('id',value->>'id','type','paragraph','title','Teaching table','body','Table content')
    else value end order by ordinality), '[]'::jsonb)
  into safe_items from jsonb_array_elements(p->'instructionalContent') with ordinality;
  sanitized := jsonb_set(p,'{instructionalContent}',safe_items);
  perform public.compile_pre_vocabulary_lesson(sanitized,v);
  select coalesce(jsonb_agg(public.lesson_public_fields(value,
    case when value->>'type'='example' then array['id','type','phrase','expression','note']
      when value->>'type'='vocabulary-table' then array['id','type','title','rows','tables']
      when value->>'type'='content-table' then array['id','type','tables']
      else array['id','type','title','body'] end) order by ordinality), '[]'::jsonb)
  into safe_items from jsonb_array_elements(p->'instructionalContent') with ordinality;
  update public.lesson_definitions definition set presentation = definition.presentation || jsonb_build_object('instructionalContent',safe_items)
  where definition.lesson_id=p->>'id' and definition.content_version=v;
end;
$$;

create or replace function public.compile_single_accepted_organize_answers(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare chapter jsonb; safe_chapter jsonb; safe_chapters jsonb := '[]'; safe_instructions jsonb; safe_activities jsonb; presentation jsonb; flattened jsonb;
begin
  perform public.validate_chapter_authored_lesson(p);
  flattened := public.flatten_lesson_chapters(p);
  perform public.compile_legacy_lesson(flattened,v);
  select definition.presentation into presentation from public.lesson_definitions definition where definition.lesson_id=p->>'id' and definition.content_version=v;
  for chapter in select value from jsonb_array_elements(p->'chapters') order by (value->>'displayOrder')::integer loop
    select coalesce(jsonb_agg(public.lesson_public_fields(value,
      case when value->>'type'='example' then array['id','type','phrase','expression','note']
        when value->>'type'='vocabulary-table' then array['id','type','title','rows','tables']
        when value->>'type'='content-table' then array['id','type','tables']
        else array['id','type','title','body'] end) order by ordinality), '[]'::jsonb)
    into safe_instructions from jsonb_array_elements(chapter->'instructionalContent') with ordinality;
    select coalesce(jsonb_agg(public_activity.value order by authored.ordinality),'[]'::jsonb)
    into safe_activities from jsonb_array_elements(chapter->'activities') with ordinality authored(value,ordinality)
    join jsonb_array_elements(presentation->'activities') public_activity(value) on public_activity.value->>'id'=authored.value->>'id';
    safe_chapter := public.lesson_public_fields(chapter,array['id','title','description','displayOrder'])
      || jsonb_build_object('instructionalContent',safe_instructions,'activities',safe_activities);
    safe_chapters := safe_chapters || jsonb_build_array(safe_chapter);
  end loop;
  update public.lesson_definitions definition set presentation=definition.presentation || jsonb_build_object('chapters',safe_chapters)
  where definition.lesson_id=p->>'id' and definition.content_version=v;
end;
$$;

create function public.chapter_has_teaching_content(p_chapter jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(p_chapter->'instructionalContent','[]'::jsonb)) item
    where item->>'type' <> 'vocabulary-table'
  );
$$;

-- Keep the existing authorization and activity/assessment checks in the prior functions.
alter function public.advance_lesson_attempt_stage(uuid) rename to advance_lesson_attempt_stage_before_optional_teaching;
create function public.advance_lesson_attempt_stage(p_attempt_id uuid)
returns public.lesson_attempts language plpgsql security definer set search_path = '' as $$
declare result public.lesson_attempts; chapter jsonb; definition public.lesson_definitions;
begin
  result := public.advance_lesson_attempt_stage_before_optional_teaching(p_attempt_id);
  while result.flow_stage = 'chapter-teaching' loop
    select * into definition from public.lesson_definitions
    where lesson_id=result.lesson_id and content_version=result.content_version;
    select value into chapter from jsonb_array_elements(definition.presentation->'chapters') item(value)
    where value->>'id'=result.current_chapter_id;
    if chapter is null or public.chapter_has_teaching_content(chapter) then exit; end if;
    result := public.advance_lesson_attempt_stage_before_optional_teaching(p_attempt_id);
  end loop;
  return result;
end;
$$;

alter function public.start_lesson_attempt(text) rename to start_lesson_attempt_before_optional_teaching;
create function public.start_lesson_attempt(p_lesson_id text)
returns public.lesson_attempts language plpgsql security definer set search_path = '' as $$
declare result public.lesson_attempts; chapter jsonb; definition public.lesson_definitions;
begin
  result := public.start_lesson_attempt_before_optional_teaching(p_lesson_id);
  while result.flow_stage = 'chapter-teaching' loop
    select * into definition from public.lesson_definitions
    where lesson_id=result.lesson_id and content_version=result.content_version;
    select value into chapter from jsonb_array_elements(definition.presentation->'chapters') item(value)
    where value->>'id'=result.current_chapter_id;
    if chapter is null or public.chapter_has_teaching_content(chapter) then exit; end if;
    result := public.advance_lesson_attempt_stage_before_optional_teaching(result.id);
  end loop;
  return result;
end;
$$;

revoke all on function public.validate_legacy_authored_lesson(jsonb),
  public.compile_legacy_lesson(jsonb,integer),
  public.compile_single_accepted_organize_answers(jsonb,integer),
  public.chapter_has_teaching_content(jsonb),
  public.advance_lesson_attempt_stage_before_optional_teaching(uuid),
  public.start_lesson_attempt_before_optional_teaching(text)
  from public, anon, authenticated;
revoke execute on function public.advance_lesson_attempt_stage(uuid), public.start_lesson_attempt(text) from public, anon;
grant execute on function public.advance_lesson_attempt_stage(uuid), public.start_lesson_attempt(text) to authenticated;
commit;
