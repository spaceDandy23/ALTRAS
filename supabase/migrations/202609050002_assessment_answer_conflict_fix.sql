-- Resolve PL/pgSQL output-column ambiguity in the hardened assessment answer RPC.
-- Run after 202609050001_research_data_integrity.sql.

create or replace function public.submit_assessment_answer(
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
  on conflict on constraint assessment_attempt_answers_attempt_id_question_id_key do update
    set selected_choice_id = excluded.selected_choice_id,
        is_correct = excluded.is_correct,
        answered_at = now()
  returning * into saved_answer;

  return query select saved_answer.attempt_id, saved_answer.question_id,
    saved_answer.selected_choice_id, saved_answer.answered_at;
end;
$$;

revoke execute on function public.submit_assessment_answer(uuid, text, text) from public;
grant execute on function public.submit_assessment_answer(uuid, text, text) to authenticated;
