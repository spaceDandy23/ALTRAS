-- Add multiple explicitly authored answer orders for Organize & Translate only.
-- Old drafts and published private keys remain valid as a single accepted order.
begin;

alter function public.validate_authored_lesson(jsonb)
  rename to validate_single_accepted_organize_answer;

create function public.validate_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  activity jsonb;
  accepted jsonb;
  sequence jsonb;
  normalized_activities jsonb;
  normalized_lesson jsonb;
  token_count integer;
  sequence_index integer;
begin
  select coalesce(jsonb_agg(
    case when value->>'type' = 'organize-translate'
      and jsonb_typeof(value->'acceptedTokenSequences') = 'array'
      then (value - 'acceptedTokenSequences') || jsonb_build_object(
        'correctTokenSequence', coalesce(value->'correctTokenSequence', value->'acceptedTokenSequences'->0)
      )
      else value end order by ordinal
  ), '[]'::jsonb)
  into normalized_activities
  from jsonb_array_elements(coalesce(p->'activities','[]'::jsonb)) with ordinality rows(value,ordinal);
  normalized_lesson := p || jsonb_build_object('activities', normalized_activities);
  perform public.validate_single_accepted_organize_answer(normalized_lesson);

  for activity in select value from jsonb_array_elements(coalesce(p->'activities','[]'::jsonb)) loop
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
    for sequence in select value from jsonb_array_elements(accepted) loop
      sequence_index := sequence_index + 1;
      if jsonb_typeof(sequence) is distinct from 'array'
        or jsonb_array_length(sequence) <> token_count
        or (select count(distinct token.value) from jsonb_array_elements(sequence) token) <> token_count
        or exists (
          select 1 from jsonb_array_elements(sequence) token
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

-- Keep the existing chapter/public-presentation compiler and replace only its private key shape.
alter function public.compile_chapter_lesson(jsonb, integer)
  rename to compile_single_accepted_organize_answers;
create function public.compile_chapter_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare activity jsonb; accepted jsonb;
begin
  perform public.compile_single_accepted_organize_answers(p, v);
  for activity in select value from jsonb_array_elements(p->'activities') loop
    if activity->>'type' <> 'organize-translate' then continue; end if;
    accepted := case when jsonb_typeof(activity->'acceptedTokenSequences') = 'array'
      then activity->'acceptedTokenSequences'
      else jsonb_build_array(activity->'correctTokenSequence') end;
    update public.lesson_activity_keys
    set correct_answer = accepted
    where lesson_id = p->>'id' and content_version = v and activity_id = activity->>'id';
  end loop;
end;
$$;
revoke all on function public.compile_chapter_lesson(jsonb, integer) from public, anon, authenticated;

-- The answer RPC accepts both legacy flat keys and new nested accepted-sequence keys.
create or replace function public.submit_legacy_lesson_activity_answer(
  p_attempt_id uuid,
  p_activity_id text,
  p_submitted_answer jsonb
)
returns public.attempt_answers
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  attempt public.lesson_attempts;
  activity public.lesson_activity_keys;
  result public.attempt_answers;
  answer_is_valid boolean := false;
  answer_is_correct boolean := false;
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  select * into attempt from public.lesson_attempts
  where id = p_attempt_id and user_id = caller_id
  for update;
  if attempt.id is null or attempt.status <> 'active' then
    raise exception 'Active attempt not found.';
  end if;

  select * into activity from public.lesson_activity_keys
  where lesson_id = attempt.lesson_id
    and content_version = attempt.content_version
    and activity_id = p_activity_id;
  if activity.activity_id is null then raise exception 'Activity not found.'; end if;

  if activity.activity_type in ('find-word', 'choose-correct-translation')
    and jsonb_typeof(p_submitted_answer) = 'string' then
    select exists (
      select 1 from jsonb_array_elements(activity.answer_options) option
      where option = p_submitted_answer
    ) into answer_is_valid;
  elsif activity.activity_type = 'organize-translate'
    and jsonb_typeof(p_submitted_answer) = 'array'
    and jsonb_array_length(p_submitted_answer) = jsonb_array_length(activity.answer_options) then
    select count(*) = jsonb_array_length(p_submitted_answer)
      and count(distinct answer.value) = jsonb_array_length(p_submitted_answer)
      and coalesce(bool_and(activity.answer_options ? answer.value), false)
    into answer_is_valid
    from jsonb_array_elements_text(p_submitted_answer) answer(value);
  end if;
  if not answer_is_valid then raise exception 'Invalid activity answer.'; end if;

  answer_is_correct := case
    when activity.activity_type = 'organize-translate'
      and jsonb_typeof(activity.correct_answer->0) = 'array'
      then exists (
        select 1 from jsonb_array_elements(activity.correct_answer) accepted
        where accepted.value = p_submitted_answer
      )
    else p_submitted_answer = activity.correct_answer
  end;

  insert into public.attempt_answers
    (attempt_id, activity_id, activity_type, submitted_answer, is_correct)
  values (
    attempt.id, activity.activity_id, activity.activity_type,
    p_submitted_answer, answer_is_correct
  )
  on conflict (attempt_id, activity_id) do nothing
  returning * into result;

  if result.id is null then
    select * into result from public.attempt_answers
    where attempt_id = attempt.id and activity_id = activity.activity_id;
  end if;
  return result;
end;
$$;
revoke all on function public.submit_legacy_lesson_activity_answer(uuid, text, jsonb) from public, anon, authenticated;

-- Completion recalculates correctness server-side, so it must use the same private accepted set.
create or replace function public.complete_legacy_lesson_attempt(p_attempt_id uuid)
returns public.lesson_attempts
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := (select auth.uid());
  current_attempt public.lesson_attempts;
  definition public.lesson_definitions;
  current_progress public.lesson_progress;
  answer_count integer;
  correct_count integer;
  computed_score smallint;
  computed_stars smallint;
  computed_cleared boolean;
  next_best_score smallint;
  next_best_stars smallint;
  next_xp integer;
  xp_delta integer;
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt from public.lesson_attempts
  where id = p_attempt_id and user_id = caller_id for update;
  if current_attempt.id is null then raise exception 'Attempt not found.'; end if;
  if current_attempt.status = 'completed' then return current_attempt; end if;
  if current_attempt.status <> 'active' then raise exception 'Attempt cannot be completed.'; end if;
  select * into definition from public.lesson_definitions
  where lesson_id = current_attempt.lesson_id and content_version = current_attempt.content_version;
  if definition.lesson_id is null then raise exception 'Lesson definition not found.'; end if;

  select count(*), count(*) filter (where case
    when activity.activity_type = 'organize-translate'
      and jsonb_typeof(activity.correct_answer->0) = 'array'
      then exists (
        select 1 from jsonb_array_elements(activity.correct_answer) accepted
        where accepted.value = answer.submitted_answer
      )
    else answer.submitted_answer = activity.correct_answer
  end) into answer_count, correct_count
  from public.attempt_answers answer
  join public.lesson_activity_keys activity
    on activity.lesson_id = current_attempt.lesson_id
    and activity.content_version = current_attempt.content_version
    and activity.activity_id = answer.activity_id
  where answer.attempt_id = p_attempt_id;
  if answer_count <> definition.expected_activity_count then
    raise exception 'Complete every activity before finishing the lesson.';
  end if;

  update public.attempt_answers answer set is_correct = case
    when activity.activity_type = 'organize-translate'
      and jsonb_typeof(activity.correct_answer->0) = 'array'
      then exists (
        select 1 from jsonb_array_elements(activity.correct_answer) accepted
        where accepted.value = answer.submitted_answer
      )
    else answer.submitted_answer = activity.correct_answer
  end
  from public.lesson_activity_keys activity
  where answer.attempt_id = p_attempt_id
    and activity.lesson_id = current_attempt.lesson_id
    and activity.content_version = current_attempt.content_version
    and activity.activity_id = answer.activity_id;

  computed_score := round((correct_count::numeric / definition.expected_activity_count) * 100);
  computed_stars := case when computed_score = 100 then 3 when computed_score >= 76 then 2 when computed_score >= 50 then 1 else 0 end;
  computed_cleared := computed_score >= definition.passing_threshold;
  select * into current_progress from public.lesson_progress
  where user_id = caller_id and lesson_id = current_attempt.lesson_id for update;
  if current_progress.user_id is null then raise exception 'Lesson progress not found.'; end if;
  next_best_score := greatest(current_progress.best_score, computed_score);
  next_best_stars := greatest(current_progress.best_star_count, computed_stars);
  next_xp := next_best_score + (next_best_stars * 10);
  xp_delta := greatest(0, next_xp - current_progress.xp_awarded);
  update public.lesson_attempts set
    status = 'completed', completed_at = now(), last_updated_at = now(),
    final_score = computed_score, star_count = computed_stars,
    cleared = computed_cleared, xp_improvement = xp_delta
  where id = p_attempt_id returning * into current_attempt;
  update public.lesson_progress set
    status = case when computed_cleared or current_progress.status = 'cleared'
      then 'cleared'::public.lesson_progress_status else 'available'::public.lesson_progress_status end,
    best_score = next_best_score, best_star_count = next_best_stars,
    attempt_count = current_progress.attempt_count + 1,
    xp_awarded = greatest(current_progress.xp_awarded, next_xp),
    last_attempted_at = now(),
    cleared_at = coalesce(current_progress.cleared_at, case when computed_cleared then now() end)
  where user_id = caller_id and lesson_id = current_attempt.lesson_id;
  if computed_cleared then
    insert into public.lesson_progress(user_id, lesson_id, status)
    select caller_id, candidate.lesson_id, 'available'
    from public.lesson_catalog catalog
    join public.lesson_definitions candidate
      on (candidate.lesson_id, candidate.content_version) = (catalog.lesson_id, catalog.published_version)
    where catalog.published and candidate.prerequisite_lesson_id = current_attempt.lesson_id
    on conflict(user_id, lesson_id) do update set
      status = case when public.lesson_progress.status = 'locked'
        then 'available'::public.lesson_progress_status else public.lesson_progress.status end;
  end if;
  return current_attempt;
end;
$$;
revoke all on function public.complete_legacy_lesson_attempt(uuid) from public, anon, authenticated;

commit;
