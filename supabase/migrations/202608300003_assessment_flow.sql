-- Server-scored pre-test and post-test attempts.
-- Placeholder questions are deliberately labeled and can be replaced by a later
-- content migration before the official research beta.

create table public.assessment_questions (
  id text primary key,
  assessment public.assessment_kind not null,
  display_order integer not null check (display_order > 0),
  prompt text not null,
  choices jsonb not null check (jsonb_typeof(choices) = 'array'),
  correct_choice_id text not null,
  content_version integer not null default 1 check (content_version > 0),
  is_placeholder boolean not null default true,
  unique (assessment, display_order, content_version)
);

alter table public.assessment_attempts
  add column content_version integer not null default 1 check (content_version > 0),
  add column expected_question_count integer not null default 1
    check (expected_question_count > 0);

alter table public.assessment_attempts
  add constraint assessment_attempts_valid_state check (
    (
      status = 'active'
      and submitted_at is null
      and score is null
      and completion_seconds is null
    )
    or (
      status = 'submitted'
      and submitted_at is not null
      and score is not null
      and completion_seconds is not null
    )
  );

create table public.assessment_attempt_answers (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.assessment_attempts (id) on delete cascade,
  question_id text not null references public.assessment_questions (id),
  selected_choice_id text not null,
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

insert into public.assessment_questions
  (id, assessment, display_order, prompt, choices, correct_choice_id)
values
  (
    'pre-placeholder-1', 'pre-test', 1,
    '[Placeholder] Which expression means “the sum of a number and five”?',
    '[{"id":"a","label":"n + 5"},{"id":"b","label":"n - 5"},{"id":"c","label":"5n"}]',
    'a'
  ),
  (
    'pre-placeholder-2', 'pre-test', 2,
    '[Placeholder] Which operation is shown by the word “product”?',
    '[{"id":"a","label":"Addition"},{"id":"b","label":"Multiplication"},{"id":"c","label":"Division"}]',
    'b'
  ),
  (
    'pre-placeholder-3', 'pre-test', 3,
    '[Placeholder] Which expression means “six less than a number”?',
    '[{"id":"a","label":"6 - n"},{"id":"b","label":"n - 6"},{"id":"c","label":"n + 6"}]',
    'b'
  ),
  (
    'post-placeholder-1', 'post-test', 1,
    '[Placeholder] Which expression means “the quotient of a number and four”?',
    '[{"id":"a","label":"4 ÷ n"},{"id":"b","label":"4n"},{"id":"c","label":"n ÷ 4"}]',
    'c'
  ),
  (
    'post-placeholder-2', 'post-test', 2,
    '[Placeholder] Which phrase correctly describes 12 − y?',
    '[{"id":"a","label":"A number subtracted from twelve"},{"id":"b","label":"Twelve subtracted from a number"},{"id":"c","label":"The sum of twelve and a number"}]',
    'a'
  ),
  (
    'post-placeholder-3', 'post-test', 3,
    '[Placeholder] Which expression means “four more than twice a number”?',
    '[{"id":"a","label":"4n + 2"},{"id":"b","label":"2n + 4"},{"id":"c","label":"2(n + 4)"}]',
    'b'
  );

alter table public.assessment_questions enable row level security;
alter table public.assessment_attempt_answers enable row level security;

create policy "Students read assessment answers; researchers read all"
  on public.assessment_attempt_answers for select to authenticated
  using (
    exists (
      select 1 from public.assessment_attempts
      where id = attempt_id
        and (user_id = (select auth.uid()) or public.is_researcher())
    )
  );

create or replace function public.get_assessment_questions(p_assessment public.assessment_kind)
returns table (
  id text,
  assessment public.assessment_kind,
  display_order integer,
  prompt text,
  choices jsonb,
  content_version integer,
  is_placeholder boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, q.assessment, q.display_order, q.prompt, q.choices,
    q.content_version, q.is_placeholder
  from public.assessment_questions q
  where q.assessment = p_assessment
    and q.content_version = (
      select max(current.content_version)
      from public.assessment_questions current
      where current.assessment = p_assessment
    )
    and (select auth.uid()) is not null
  order by q.display_order;
$$;

create or replace function public.start_assessment(p_assessment public.assessment_kind)
returns public.assessment_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.assessment_attempts;
  question_version integer;
  question_count integer;
begin
  select * into result
  from public.assessment_attempts
  where user_id = (select auth.uid()) and assessment = p_assessment;
  if result.id is not null then return result; end if;

  select max(content_version), count(*) into question_version, question_count
  from public.assessment_questions
  where assessment = p_assessment
    and content_version = (
      select max(current.content_version)
      from public.assessment_questions current
      where current.assessment = p_assessment
    );
  if question_count = 0 then raise exception 'Assessment content is not available.'; end if;

  insert into public.assessment_attempts
    (user_id, assessment, content_version, expected_question_count)
  values ((select auth.uid()), p_assessment, question_version, question_count)
  returning * into result;
  return result;
end;
$$;

create or replace function public.submit_assessment_answer(
  p_attempt_id uuid,
  p_question_id text,
  p_choice_id text
)
returns public.assessment_attempt_answers
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempt public.assessment_attempts;
  current_question public.assessment_questions;
  result public.assessment_attempt_answers;
begin
  select * into current_attempt
  from public.assessment_attempts
  where id = p_attempt_id
    and user_id = (select auth.uid())
    and status = 'active';
  if current_attempt.id is null then raise exception 'Active assessment not found.'; end if;

  select * into current_question
  from public.assessment_questions
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
    p_attempt_id,
    p_question_id,
    p_choice_id,
    p_choice_id = current_question.correct_choice_id
  )
  on conflict (attempt_id, question_id) do nothing
  returning * into result;

  if result.id is null then
    select * into result from public.assessment_attempt_answers
    where attempt_id = p_attempt_id and question_id = p_question_id;
  end if;
  return result;
end;
$$;

create or replace function public.complete_assessment(p_attempt_id uuid)
returns public.assessment_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.assessment_attempts;
  answer_count integer;
  correct_count integer;
begin
  select * into result
  from public.assessment_attempts
  where id = p_attempt_id and user_id = (select auth.uid())
  for update;
  if result.id is null then raise exception 'Assessment not found.'; end if;
  if result.status = 'submitted' then return result; end if;

  select count(*), count(*) filter (where is_correct)
  into answer_count, correct_count
  from public.assessment_attempt_answers
  where attempt_id = p_attempt_id;
  if answer_count <> result.expected_question_count then
    raise exception 'Answer every question before submitting.';
  end if;

  update public.assessment_attempts
  set status = 'submitted',
      submitted_at = now(),
      score = round((correct_count::numeric / result.expected_question_count) * 100),
      completion_seconds = greatest(0, extract(epoch from (now() - result.started_at))::integer)
  where id = p_attempt_id
  returning * into result;
  return result;
end;
$$;

revoke insert, update on public.assessment_attempts from authenticated;
revoke all on public.assessment_questions from authenticated;
revoke all on public.assessment_attempt_answers from authenticated;
grant select on public.assessment_attempt_answers to authenticated;

revoke execute on function public.get_assessment_questions(public.assessment_kind) from public;
revoke execute on function public.start_assessment(public.assessment_kind) from public;
revoke execute on function public.submit_assessment_answer(uuid, text, text) from public;
revoke execute on function public.complete_assessment(uuid) from public;
grant execute on function public.get_assessment_questions(public.assessment_kind) to authenticated;
grant execute on function public.start_assessment(public.assessment_kind) to authenticated;
grant execute on function public.submit_assessment_answer(uuid, text, text) to authenticated;
grant execute on function public.complete_assessment(uuid) to authenticated;
