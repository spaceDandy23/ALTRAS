begin;

-- Preserve the existing private answer-key compiler and add only the authored
-- instruction text to the public activity projection for translation choices.
alter function public.compile_lesson(jsonb, integer)
  rename to compile_lesson_before_activity_instruction_semantics;

create function public.compile_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare
  presentation jsonb;
  flattened jsonb;
  top_level_activities jsonb;
  chapter_activities jsonb;
  authored_chapter jsonb;
  compiled_chapter jsonb;
  compiled_chapter_with_activities jsonb;
  chapters jsonb := '[]'::jsonb;
begin
  perform public.validate_authored_lesson(p);
  perform public.compile_lesson_before_activity_instruction_semantics(p, v);

  select definition.presentation into presentation
  from public.lesson_definitions definition
  where definition.lesson_id = p->>'id' and definition.content_version = v;

  flattened := public.flatten_lesson_chapters(p);

  select coalesce(jsonb_agg(
    case
      when authored.value->>'type' = 'choose-correct-translation'
        and jsonb_typeof(authored.value->'instructions') = 'string'
        then coalesce(compiled.value, '{}'::jsonb)
          || jsonb_build_object('instructions', authored.value->'instructions')
      else coalesce(compiled.value, '{}'::jsonb)
    end order by authored.ordinality
  ), '[]'::jsonb)
  into top_level_activities
  from jsonb_array_elements(flattened->'activities') with ordinality authored(value, ordinality)
  left join jsonb_array_elements(coalesce(presentation->'activities', '[]'::jsonb)) compiled(value)
    on compiled.value->>'id' = authored.value->>'id';

  for authored_chapter in
    select value from jsonb_array_elements(coalesce(p->'chapters', '[]'::jsonb))
  loop
    select value into compiled_chapter
    from jsonb_array_elements(coalesce(presentation->'chapters', '[]'::jsonb))
    where value->>'id' = authored_chapter->>'id';

    if compiled_chapter is null then
      continue;
    end if;

    select coalesce(jsonb_agg(
      case
        when authored.value->>'type' = 'choose-correct-translation'
          and jsonb_typeof(authored.value->'instructions') = 'string'
          then coalesce(compiled.value, '{}'::jsonb)
            || jsonb_build_object('instructions', authored.value->'instructions')
        else coalesce(compiled.value, '{}'::jsonb)
      end order by authored.ordinality
    ), '[]'::jsonb)
    into chapter_activities
    from jsonb_array_elements(coalesce(authored_chapter->'activities', '[]'::jsonb))
      with ordinality authored(value, ordinality)
    left join jsonb_array_elements(coalesce(compiled_chapter->'activities', '[]'::jsonb)) compiled(value)
      on compiled.value->>'id' = authored.value->>'id';

    compiled_chapter_with_activities := compiled_chapter
      || jsonb_build_object('activities', chapter_activities);
    chapters := chapters || jsonb_build_array(compiled_chapter_with_activities);
  end loop;

  update public.lesson_definitions definition
  set presentation = definition.presentation
    || jsonb_build_object('activities', top_level_activities)
    || case when p ? 'chapters' then jsonb_build_object('chapters', chapters) else '{}'::jsonb end
  where definition.lesson_id = p->>'id' and definition.content_version = v;
end;
$$;

revoke all on function public.compile_lesson_before_activity_instruction_semantics(jsonb, integer),
  public.compile_lesson(jsonb, integer) from public, anon, authenticated;

commit;
