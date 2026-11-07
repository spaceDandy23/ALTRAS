-- Extend versioned vocabulary blocks. Existing drafts and published versions are not rewritten.
begin;

create function public.validate_content_tables(tables jsonb) returns void
language plpgsql set search_path = '' as $$
declare item jsonb; col jsonb; row_data jsonb; cell record;
  table_ids text[] := '{}'; column_ids text[]; row_ids text[];
begin
  if jsonb_typeof(tables) is distinct from 'array' then raise exception 'Tables must be an array.'; end if;
  for item in select value from jsonb_array_elements(tables) loop
    if jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'string' or length(btrim(item->>'id')) = 0
      or (item ? 'title' and jsonb_typeof(item->'title') is distinct from 'string')
      or jsonb_typeof(item->'columns') is distinct from 'array'
      or jsonb_typeof(item->'rows') is distinct from 'array' then
      raise exception 'Each table needs an ID, columns, and rows.';
    end if;
    if item - array['id','title','columns','rows'] <> '{}'::jsonb then raise exception 'Unknown table fields.'; end if;
    if item->>'id' = any(table_ids) then raise exception 'Table IDs must be unique.'; end if;
    table_ids := array_append(table_ids,item->>'id');
    if jsonb_array_length(item->'columns') = 0 then raise exception 'A table needs at least one column.'; end if;
    column_ids := '{}'; row_ids := '{}';
    for col in select value from jsonb_array_elements(item->'columns') loop
      if jsonb_typeof(col) is distinct from 'object'
        or jsonb_typeof(col->'id') is distinct from 'string' or length(btrim(col->>'id')) = 0
        or jsonb_typeof(col->'label') is distinct from 'string' or length(btrim(col->>'label')) = 0 then
        raise exception 'Each column needs an ID and label.';
      end if;
      if col - array['id','label'] <> '{}'::jsonb then raise exception 'Unknown column fields.'; end if;
      if col->>'id' = any(column_ids) then raise exception 'Column IDs must be unique.'; end if;
      column_ids := array_append(column_ids,col->>'id');
    end loop;
    for row_data in select value from jsonb_array_elements(item->'rows') loop
      if jsonb_typeof(row_data) is distinct from 'object'
        or jsonb_typeof(row_data->'id') is distinct from 'string' or length(btrim(row_data->>'id')) = 0
        or jsonb_typeof(row_data->'cells') is distinct from 'object' then
        raise exception 'Each row needs an ID and cells.';
      end if;
      if row_data - array['id','cells'] <> '{}'::jsonb then raise exception 'Unknown row fields.'; end if;
      if row_data->>'id' = any(row_ids) then raise exception 'Row IDs must be unique.'; end if;
      row_ids := array_append(row_ids,row_data->>'id');
      if not (row_data->'cells' ?& column_ids) then raise exception 'Missing table cell.'; end if;
      for cell in select * from jsonb_each(row_data->'cells') loop
        if not (cell.key = any(column_ids)) or jsonb_typeof(cell.value) <> 'string' then
          raise exception 'Cells must contain text for configured columns only.';
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;
revoke all on function public.validate_content_tables(jsonb) from public, anon, authenticated;

alter function public.validate_legacy_authored_lesson(jsonb) rename to validate_pre_dynamic_tables_lesson;
create function public.validate_legacy_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare item jsonb; safe_items jsonb := '[]';
begin
  for item in select value from jsonb_array_elements(p->'instructionalContent') loop
    if item->>'type' = 'vocabulary-table' and item ? 'tables' then
      if jsonb_typeof(item->'id') is distinct from 'string'
        or jsonb_typeof(item->'title') is distinct from 'string' then
        raise exception 'Vocabulary block ID and title must be text.';
      end if;
      perform public.validate_content_tables(item->'tables');
      if item->'rows' is distinct from '[]'::jsonb then
        raise exception 'Use either legacy vocabulary rows or configurable tables.';
      end if;
      -- Existing validator still checks block IDs/titles and every other lesson field.
      item := jsonb_build_object('id',item->>'id','type','paragraph','title',item->>'title','body','Table content');
    end if;
    safe_items := safe_items || jsonb_build_array(item);
  end loop;
  perform public.validate_pre_dynamic_tables_lesson(jsonb_set(p,'{instructionalContent}',safe_items));
end;
$$;
revoke all on function public.validate_legacy_authored_lesson(jsonb) from public, anon, authenticated;

-- Keep the existing private-key compiler; carry the validated table fields through its public projection.
create or replace function public.compile_legacy_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare sanitized jsonb; safe_items jsonb;
begin
  select coalesce(jsonb_agg(case when value->>'type'='vocabulary-table'
    then jsonb_build_object('id',value->>'id','type','paragraph','title',value->>'title','body','Vocabulary table')
    else value end order by ordinality), '[]'::jsonb)
  into safe_items from jsonb_array_elements(p->'instructionalContent') with ordinality;
  sanitized := jsonb_set(p,'{instructionalContent}',safe_items);
  perform public.compile_pre_vocabulary_lesson(sanitized,v);
  select coalesce(jsonb_agg(public.lesson_public_fields(value,
    case when value->>'type'='example' then array['id','type','phrase','expression','note']
      when value->>'type'='vocabulary-table' then array['id','type','title','rows','tables']
      else array['id','type','title','body'] end) order by ordinality), '[]'::jsonb)
  into safe_items from jsonb_array_elements(p->'instructionalContent') with ordinality;
  update public.lesson_definitions definition set presentation = definition.presentation || jsonb_build_object('instructionalContent',safe_items)
  where definition.lesson_id=p->>'id' and definition.content_version=v;
end;
$$;

-- This is the chapter presentation compiler called by the accepted-answer wrapper.
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
revoke all on function public.compile_legacy_lesson(jsonb,integer) from public, anon, authenticated;
revoke all on function public.compile_single_accepted_organize_answers(jsonb,integer) from public, anon, authenticated;
commit;
