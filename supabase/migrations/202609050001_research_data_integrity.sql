-- Research-data integrity hardening.
-- Run after 202609040001_assessment_answer_draft_upsert.sql.

-- The packaged lesson UI remains in the application, but the database needs a
-- private authority copy of outcome-affecting metadata and answer keys.
create table public.lesson_definitions (
  lesson_id text not null,
  content_version integer not null check (content_version > 0),
  expected_activity_count integer not null check (expected_activity_count > 0),
  passing_threshold smallint not null check (passing_threshold between 0 and 100),
  prerequisite_lesson_id text,
  primary key (lesson_id, content_version)
);

create table public.lesson_activity_keys (
  lesson_id text not null,
  content_version integer not null,
  activity_id text not null,
  activity_type text not null check (activity_type in ('find-word', 'organize-translate')),
  answer_options jsonb not null check (jsonb_typeof(answer_options) = 'array'),
  correct_answer jsonb not null,
  primary key (lesson_id, content_version, activity_id),
  foreign key (lesson_id, content_version)
    references public.lesson_definitions (lesson_id, content_version) on delete cascade
);

insert into public.lesson_definitions
  (lesson_id, content_version, expected_activity_count, passing_threshold, prerequisite_lesson_id)
values
  ('lesson-operation-signals', 1, 6, 70, null),
  ('lesson-order-matters', 2, 5, 70, 'lesson-operation-signals');

insert into public.lesson_activity_keys
  (lesson_id, content_version, activity_id, activity_type, answer_options, correct_answer)
values
  ('lesson-operation-signals', 1, 'find-sum', 'find-word',
    '["sum","difference","product"]', '"sum"'),
  ('lesson-operation-signals', 1, 'find-product', 'find-word',
    '["quotient","product","difference"]', '"product"'),
  ('lesson-operation-signals', 1, 'find-quotient', 'find-word',
    '["sum","quotient","product"]', '"quotient"'),
  ('lesson-operation-signals', 1, 'organize-less-than', 'organize-translate',
    '["number","six","less-than"]', '["six","less-than","number"]'),
  ('lesson-operation-signals', 1, 'organize-subtracted-from', 'organize-translate',
    '["twelve","a-number","subtracted-from"]', '["a-number","subtracted-from","twelve"]'),
  ('lesson-operation-signals', 1, 'organize-sum-product', 'organize-translate',
    '["seven","and","three-times","sum-of"]', '["sum-of","three-times","and","seven"]'),
  ('lesson-order-matters', 2, 'order-find-less-than', 'find-word',
    '["less","more","times"]', '"less"'),
  ('lesson-order-matters', 2, 'order-find-subtracted-from', 'find-word',
    '["added","subtracted","multiplied"]', '"subtracted"'),
  ('lesson-order-matters', 2, 'order-organize-less-than', 'organize-translate',
    '["number","less-than","five"]', '["five","less-than","number"]'),
  ('lesson-order-matters', 2, 'order-organize-subtracted-from', 'organize-translate',
    '["twelve","subtracted-from","a-number"]', '["a-number","subtracted-from","twelve"]'),
  ('lesson-order-matters', 2, 'order-organize-more-than', 'organize-translate',
    '["twice-number","four","more-than"]', '["four","more-than","twice-number"]');

alter table public.lesson_definitions enable row level security;
alter table public.lesson_activity_keys enable row level security;
revoke all on public.lesson_definitions, public.lesson_activity_keys from public, authenticated;

-- Defaults are inserted only when missing. The targeted unlock update can only
-- advance locked -> available and never rewrites earned outcome fields.
create or replace function public.initialize_lesson_progress()
returns setof public.lesson_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  insert into public.lesson_progress (user_id, lesson_id, status)
  select
    caller_id,
    lesson.lesson_id,
    case
      when lesson.prerequisite_lesson_id is null then 'available'::public.lesson_progress_status
      when exists (
        select 1 from public.lesson_progress prerequisite
        where prerequisite.user_id = caller_id
          and prerequisite.lesson_id = lesson.prerequisite_lesson_id
          and prerequisite.status = 'cleared'
      ) then 'available'::public.lesson_progress_status
      else 'locked'::public.lesson_progress_status
    end
  from (
    select distinct on (definition.lesson_id) definition.*
    from public.lesson_definitions definition
    order by definition.lesson_id, definition.content_version desc
  ) lesson
  on conflict (user_id, lesson_id) do nothing;

  update public.lesson_progress progress
  set status = 'available'
  from (
    select distinct on (definition.lesson_id) definition.*
    from public.lesson_definitions definition
    order by definition.lesson_id, definition.content_version desc
  ) lesson
  where progress.user_id = caller_id
    and progress.lesson_id = lesson.lesson_id
    and progress.status = 'locked'
    and lesson.prerequisite_lesson_id is not null
    and exists (
      select 1 from public.lesson_progress prerequisite
      where prerequisite.user_id = caller_id
        and prerequisite.lesson_id = lesson.prerequisite_lesson_id
        and prerequisite.status = 'cleared'
    );

  return query
  select progress.* from public.lesson_progress progress
  where progress.user_id = caller_id
  order by progress.lesson_id;
end;
$$;

create or replace function public.start_lesson_attempt(p_lesson_id text)
returns public.lesson_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  definition public.lesson_definitions;
  progress public.lesson_progress;
  result public.lesson_attempts;
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  select * into definition from public.lesson_definitions
  where lesson_id = p_lesson_id
  order by content_version desc
  limit 1;
  if definition.lesson_id is null then raise exception 'Lesson not found.'; end if;

  perform public.initialize_lesson_progress();
  select * into progress from public.lesson_progress
  where user_id = caller_id and lesson_id = p_lesson_id
  for update;
  if progress.status = 'locked' then raise exception 'Lesson is locked.'; end if;

  select * into result from public.lesson_attempts
  where user_id = caller_id and lesson_id = p_lesson_id and status = 'active';
  if result.id is not null then return result; end if;

  insert into public.lesson_attempts
    (user_id, lesson_id, content_version, expected_activity_count, passing_threshold)
  values (
    caller_id, definition.lesson_id, definition.content_version,
    definition.expected_activity_count, definition.passing_threshold
  )
  returning * into result;

  update public.lesson_progress
  set status = case when status = 'cleared' then status else 'in-progress' end,
      first_started_at = coalesce(first_started_at, now())
  where user_id = caller_id and lesson_id = p_lesson_id;
  return result;
end;
$$;

create or replace function public.submit_lesson_activity_answer(
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

  if activity.activity_type = 'find-word' and jsonb_typeof(p_submitted_answer) = 'string' then
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

  insert into public.attempt_answers
    (attempt_id, activity_id, activity_type, submitted_answer, is_correct)
  values (
    attempt.id, activity.activity_id, activity.activity_type,
    p_submitted_answer, p_submitted_answer = activity.correct_answer
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

drop function if exists public.complete_lesson_attempt(uuid, text[]);
create or replace function public.complete_lesson_attempt(p_attempt_id uuid)
returns public.lesson_attempts
language plpgsql
security definer
set search_path = ''
as $$
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
  where id = p_attempt_id and user_id = caller_id
  for update;
  if current_attempt.id is null then raise exception 'Attempt not found.'; end if;
  if current_attempt.status = 'completed' then return current_attempt; end if;
  if current_attempt.status <> 'active' then raise exception 'Attempt cannot be completed.'; end if;

  select * into definition from public.lesson_definitions
  where lesson_id = current_attempt.lesson_id
    and content_version = current_attempt.content_version;
  if definition.lesson_id is null then raise exception 'Lesson definition not found.'; end if;

  select count(*), count(*) filter (where answer.submitted_answer = activity.correct_answer)
  into answer_count, correct_count
  from public.attempt_answers answer
  join public.lesson_activity_keys activity
    on activity.lesson_id = current_attempt.lesson_id
    and activity.content_version = current_attempt.content_version
    and activity.activity_id = answer.activity_id
  where answer.attempt_id = p_attempt_id;
  if answer_count <> definition.expected_activity_count then
    raise exception 'Complete every activity before finishing the lesson.';
  end if;

  update public.attempt_answers answer
  set is_correct = answer.submitted_answer = activity.correct_answer
  from public.lesson_activity_keys activity
  where answer.attempt_id = p_attempt_id
    and activity.lesson_id = current_attempt.lesson_id
    and activity.content_version = current_attempt.content_version
    and activity.activity_id = answer.activity_id;

  computed_score := round((correct_count::numeric / definition.expected_activity_count) * 100);
  computed_stars := case
    when computed_score = 100 then 3
    when computed_score >= 85 then 2
    when computed_score >= definition.passing_threshold then 1
    else 0
  end;
  computed_cleared := computed_score >= definition.passing_threshold;

  select * into current_progress from public.lesson_progress
  where user_id = caller_id and lesson_id = current_attempt.lesson_id
  for update;
  if current_progress.user_id is null then raise exception 'Lesson progress not found.'; end if;

  next_best_score := greatest(current_progress.best_score, computed_score);
  next_best_stars := greatest(current_progress.best_star_count, computed_stars);
  next_xp := next_best_score + (next_best_stars * 10);
  xp_delta := greatest(0, next_xp - current_progress.xp_awarded);

  update public.lesson_attempts
  set status = 'completed', completed_at = now(), last_updated_at = now(),
      final_score = computed_score, star_count = computed_stars,
      cleared = computed_cleared, xp_improvement = xp_delta
  where id = p_attempt_id
  returning * into current_attempt;

  update public.lesson_progress
  set status = case
        when computed_cleared or current_progress.status = 'cleared' then 'cleared'::public.lesson_progress_status
        else 'available'::public.lesson_progress_status
      end,
      best_score = next_best_score,
      best_star_count = next_best_stars,
      attempt_count = current_progress.attempt_count + 1,
      xp_awarded = greatest(current_progress.xp_awarded, next_xp),
      last_attempted_at = now(),
      cleared_at = coalesce(current_progress.cleared_at, case when computed_cleared then now() end)
  where user_id = caller_id and lesson_id = current_attempt.lesson_id;

  if computed_cleared then
    insert into public.lesson_progress (user_id, lesson_id, status)
    select caller_id, follow_up.lesson_id, 'available'
    from (
      select distinct on (candidate.lesson_id) candidate.*
      from public.lesson_definitions candidate
      where candidate.prerequisite_lesson_id = current_attempt.lesson_id
      order by candidate.lesson_id, candidate.content_version desc
    ) follow_up
    on conflict (user_id, lesson_id) do update
      set status = case
        when public.lesson_progress.status = 'locked' then 'available'::public.lesson_progress_status
        else public.lesson_progress.status
      end;
  end if;
  return current_attempt;
end;
$$;

-- Students resume through this safe projection, not the answer table. It does
-- not contain is_correct or any question key.
create or replace function public.get_assessment_attempt(p_assessment public.assessment_kind)
returns table (
  id uuid,
  user_id uuid,
  assessment public.assessment_kind,
  status public.assessment_attempt_status,
  started_at timestamptz,
  submitted_at timestamptz,
  score smallint,
  completion_seconds integer,
  content_version integer,
  expected_question_count integer,
  assessment_attempt_answers jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    attempt.id, attempt.user_id, attempt.assessment, attempt.status,
    attempt.started_at, attempt.submitted_at, attempt.score,
    attempt.completion_seconds, attempt.content_version,
    attempt.expected_question_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'question_id', answer.question_id,
          'selected_choice_id', answer.selected_choice_id,
          'answered_at', answer.answered_at
        ) order by answer.answered_at
      ) filter (where answer.id is not null),
      '[]'::jsonb
    )
  from public.assessment_attempts attempt
  left join public.assessment_attempt_answers answer on answer.attempt_id = attempt.id
  where attempt.user_id = (select auth.uid())
    and attempt.assessment = p_assessment
    and not public.is_researcher()
  group by attempt.id;
$$;

drop function if exists public.submit_assessment_answer(uuid, text, text);
create function public.submit_assessment_answer(
  p_attempt_id uuid,
  p_question_id text,
  p_choice_id text
)
returns table (
  attempt_id uuid,
  question_id text,
  selected_choice_id text,
  answered_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempt public.assessment_attempts;
  current_question public.assessment_questions;
  saved_answer public.assessment_attempt_answers;
begin
  if (select auth.uid()) is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  -- Completion takes the same row lock, so it cannot score between this status
  -- check and the answer upsert committing.
  select * into current_attempt from public.assessment_attempts
  where id = p_attempt_id and user_id = (select auth.uid())
  for update;
  if current_attempt.id is null or current_attempt.status <> 'active' then
    raise exception 'Active assessment not found.';
  end if;

  select * into current_question from public.assessment_questions
  where id = p_question_id
    and assessment = current_attempt.assessment
    and content_version = current_attempt.content_version;
  if current_question.id is null then raise exception 'Question not found.'; end if;
  if not exists (
    select 1 from jsonb_array_elements(current_question.choices) choice
    where choice ->> 'id' = p_choice_id
  ) then raise exception 'Choice not found.'; end if;

  insert into public.assessment_attempt_answers
    (attempt_id, question_id, selected_choice_id, is_correct)
  values (
    p_attempt_id, p_question_id, p_choice_id,
    p_choice_id = current_question.correct_choice_id
  )
  on conflict (attempt_id, question_id) do update
    set selected_choice_id = excluded.selected_choice_id,
        is_correct = excluded.is_correct,
        answered_at = now()
  returning * into saved_answer;

  return query select saved_answer.attempt_id, saved_answer.question_id,
    saved_answer.selected_choice_id, saved_answer.answered_at;
end;
$$;

-- Remove all student-direct outcome mutation paths and the assessment answer
-- table read that exposed is_correct. Researchers keep using the authorized,
-- SECURITY DEFINER aggregate RPC.
revoke insert, update, delete on public.lesson_progress from authenticated;
revoke insert, update, delete on public.lesson_attempts from authenticated;
revoke insert, update, delete on public.attempt_answers from authenticated;
revoke select, insert, update, delete on public.assessment_attempt_answers from authenticated;
drop policy if exists "Students read their own assessment answers"
  on public.assessment_attempt_answers;

revoke execute on function public.initialize_lesson_progress() from public;
revoke execute on function public.start_lesson_attempt(text) from public;
revoke execute on function public.submit_lesson_activity_answer(uuid, text, jsonb) from public;
revoke execute on function public.complete_lesson_attempt(uuid) from public;
revoke execute on function public.get_assessment_attempt(public.assessment_kind) from public;
revoke execute on function public.submit_assessment_answer(uuid, text, text) from public;
grant execute on function public.initialize_lesson_progress() to authenticated;
grant execute on function public.start_lesson_attempt(text) to authenticated;
grant execute on function public.submit_lesson_activity_answer(uuid, text, jsonb) to authenticated;
grant execute on function public.complete_lesson_attempt(uuid) to authenticated;
grant execute on function public.get_assessment_attempt(public.assessment_kind) to authenticated;
grant execute on function public.submit_assessment_answer(uuid, text, text) to authenticated;
