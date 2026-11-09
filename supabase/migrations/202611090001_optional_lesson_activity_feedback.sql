-- Activity explanations are optional authored feedback. Keep the existing
-- validator's answer/content checks while normalizing omitted feedback only
-- for that legacy required-field validation.
create or replace function public.activity_with_optional_feedback_for_validation(p_activity jsonb)
returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when not (p_activity ? 'explanation')
      or p_activity->'explanation' = 'null'::jsonb
      or (
        jsonb_typeof(p_activity->'explanation') = 'object'
        and (
          not (p_activity->'explanation' ? 'body')
          or p_activity#>'{explanation,body}' = 'null'::jsonb
          or (
            jsonb_typeof(p_activity#>'{explanation,body}') = 'string'
            and length(btrim(p_activity#>>'{explanation,body}')) = 0
          )
        )
      ) then
        p_activity || jsonb_build_object('explanation', jsonb_build_object(
          'title', 'Answer feedback',
          'body', 'No additional explanation was authored.'
        ))
    when jsonb_typeof(p_activity->'explanation') = 'object'
      and (
        not (p_activity->'explanation' ? 'title')
        or p_activity#>'{explanation,title}' = 'null'::jsonb
        or (
          jsonb_typeof(p_activity#>'{explanation,title}') = 'string'
          and length(btrim(p_activity#>>'{explanation,title}')) = 0
        )
      ) then
        jsonb_set(p_activity, '{explanation,title}', '"Answer feedback"'::jsonb, true)
    else p_activity
  end;
$$;
revoke all on function public.activity_with_optional_feedback_for_validation(jsonb)
  from public, anon, authenticated;

-- Replace the validator in place so existing database functions that resolved
-- its OID continue to use the optional-feedback behavior.
create or replace function public.validate_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  normalized jsonb := p;
  normalized_chapters jsonb;
  activity jsonb;
  accepted jsonb;
  answer_sequence jsonb;
  token_count integer;
  sequence_index integer;
begin
  if p ? 'activities' then
    normalized := jsonb_set(
      normalized,
      '{activities}',
      coalesce((
        select jsonb_agg(public.activity_with_optional_feedback_for_validation(value) order by ordinal)
        from jsonb_array_elements(coalesce(p->'activities', '[]'::jsonb)) with ordinality items(value, ordinal)
      ), '[]'::jsonb)
    );
  end if;

  if jsonb_typeof(p->'chapters') = 'array' then
    select coalesce(jsonb_agg(
      case when jsonb_typeof(chapter.value->'activities') = 'array' then
        jsonb_set(
          chapter.value,
          '{activities}',
          coalesce((
            select jsonb_agg(public.activity_with_optional_feedback_for_validation(activity.value) order by activity.ordinal)
            from jsonb_array_elements(chapter.value->'activities') with ordinality activity(value, ordinal)
          ), '[]'::jsonb)
        )
      else chapter.value end
      order by chapter.ordinal
    ), '[]'::jsonb)
    into normalized_chapters
    from jsonb_array_elements(p->'chapters') with ordinality chapter(value, ordinal);
    normalized := jsonb_set(normalized, '{chapters}', normalized_chapters);
  end if;

  perform public.validate_single_accepted_organize_answer(normalized);

  for activity in
    select value from jsonb_array_elements(coalesce(normalized->'activities', '[]'::jsonb))
    union all
    select activity.value
    from jsonb_array_elements(coalesce(normalized->'chapters', '[]'::jsonb)) chapter(value)
    cross join lateral jsonb_array_elements(coalesce(chapter.value->'activities', '[]'::jsonb)) activity(value)
  loop
    if activity->>'type' <> 'organize-translate' then continue; end if;
    accepted := case when activity ? 'acceptedTokenSequences'
      then activity->'acceptedTokenSequences'
      else jsonb_build_array(activity->'correctTokenSequence') end;
    if jsonb_typeof(accepted) is distinct from 'array' or jsonb_array_length(accepted) < 1 then
      raise exception 'Add at least one accepted token order.';
    end if;
    if activity ? 'acceptedTokenSequences'
      and activity ? 'correctTokenSequence'
      and activity->'correctTokenSequence' <> accepted->0 then
      raise exception 'The legacy correct order must match Accepted answer 1.';
    end if;
    token_count := jsonb_array_length(activity->'tokens');
    sequence_index := 0;
    for answer_sequence in select value from jsonb_array_elements(accepted) loop
      sequence_index := sequence_index + 1;
      if jsonb_typeof(answer_sequence) is distinct from 'array'
        or jsonb_array_length(answer_sequence) <> token_count
        or (select count(distinct token.value) from jsonb_array_elements(answer_sequence) token) <> token_count
        or exists (
          select 1 from jsonb_array_elements(answer_sequence) token
          where jsonb_typeof(token.value) <> 'string'
            or not exists (
              select 1 from jsonb_array_elements(activity->'tokens') available
              where available->>'id' = token.value#>>'{}'
            )
        ) then
        raise exception 'Accepted answer % must use every activity token exactly once.', sequence_index;
      end if;
    end loop;
    if (select count(distinct value::text) from jsonb_array_elements(accepted)) <> jsonb_array_length(accepted) then
      raise exception 'Accepted token orders must be unique.';
    end if;
  end loop;
end;
$$;
revoke all on function public.validate_authored_lesson(jsonb) from public, anon, authenticated;

-- The chapter compiler called the older strict chapter validator directly.
-- Route it through the normalized validator before flattening so optional
-- explanations are accepted by every compile path.
create or replace function public.compile_single_accepted_organize_answers(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
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
    select value from jsonb_array_elements(p->'chapters') order by (value->>'displayOrder')::integer
  loop
    select coalesce(jsonb_agg(public.lesson_public_fields(value,
      case when value->>'type' = 'example' then array['id','type','phrase','expression','note']
        when value->>'type' = 'vocabulary-table' then array['id','type','title','rows','tables']
        when value->>'type' = 'content-table' then array['id','type','tables']
        else array['id','type','title','body'] end) order by ordinality), '[]'::jsonb)
    into safe_instructions
    from jsonb_array_elements(chapter->'instructionalContent') with ordinality;

    select coalesce(jsonb_agg(public_activity.value order by authored.ordinality), '[]'::jsonb)
    into safe_activities
    from jsonb_array_elements(chapter->'activities') with ordinality authored(value, ordinality)
    join jsonb_array_elements(presentation->'activities') public_activity(value)
      on public_activity.value->>'id' = authored.value->>'id';

    safe_chapter := public.lesson_public_fields(chapter, array['id','title','description','displayOrder'])
      || jsonb_build_object('instructionalContent', safe_instructions, 'activities', safe_activities);
    safe_chapters := safe_chapters || jsonb_build_array(safe_chapter);
  end loop;

  update public.lesson_definitions definition
  set presentation = definition.presentation || jsonb_build_object('chapters', safe_chapters)
  where definition.lesson_id = p->>'id' and definition.content_version = v;
end;
$$;
revoke all on function public.compile_single_accepted_organize_answers(jsonb, integer)
  from public, anon, authenticated;

-- Release private correctness and feedback only for activities that this
-- authenticated student has already submitted on this exact lesson attempt.
create or replace function public.get_lesson_content(p_lesson_id text, p_attempt_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v integer;
  doc jsonb;
  activities jsonb := '[]'::jsonb;
  a jsonb;
  feedback jsonb;
  answer jsonb;
begin
  if (select auth.uid()) is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  if p_attempt_id is not null then
    select content_version into v
    from public.lesson_attempts
    where id = p_attempt_id and lesson_id = p_lesson_id and user_id = (select auth.uid());
  else
    select published_version into v
    from public.lesson_catalog
    where lesson_id = p_lesson_id and published;
  end if;

  select presentation into doc
  from public.lesson_definitions
  where lesson_id = p_lesson_id and content_version = v;
  if doc is null then raise exception 'This lesson is unavailable.'; end if;

  for a in select value from jsonb_array_elements(doc->'activities') loop
    if p_attempt_id is not null and exists (
      select 1 from public.attempt_answers
      where attempt_id = p_attempt_id and activity_id = a->>'id'
    ) then
      select keys.feedback, keys.correct_answer into feedback, answer
      from public.lesson_activity_keys keys
      where keys.lesson_id = p_lesson_id
        and keys.content_version = v
        and keys.activity_id = a->>'id';

      -- The compiled public placeholder must not masquerade as authored
      -- feedback when the researcher left the optional explanation blank.
      a := (a - 'explanation') || coalesce(feedback - 'explanation', '{}'::jsonb);
      if jsonb_typeof(feedback->'explanation') = 'object'
        and length(btrim(coalesce(feedback#>>'{explanation,body}', ''))) > 0 then
        a := a || jsonb_build_object('explanation', feedback->'explanation');
      end if;

      if a->>'type' in ('find-word', 'choose-correct-translation') then
        a := a || jsonb_build_object('correctChoiceId', answer);
      elsif a->>'type' = 'organize-translate' then
        a := a || jsonb_build_object(
          'correctTokenSequence',
          case when jsonb_typeof(answer->0) = 'array' then answer->0 else answer end
        );
      end if;
    end if;
    activities := activities || jsonb_build_array(a);
  end loop;

  return doc || jsonb_build_object('activities', activities);
end;
$$;
