begin;

alter table public.assessment_attempts
  add column answering_seconds integer
  check (answering_seconds is null or answering_seconds between 0 and 86400);

drop function public.get_assessment_attempt(public.assessment_kind, uuid);
create function public.get_assessment_attempt(
  p_assessment public.assessment_kind,
  p_lesson_attempt_id uuid default null
)
returns table (
  id uuid,
  user_id uuid,
  assessment public.assessment_kind,
  status public.assessment_attempt_status,
  started_at timestamptz,
  submitted_at timestamptz,
  score smallint,
  completion_seconds integer,
  answering_seconds integer,
  content_version integer,
  expected_question_count integer,
  accepted_revision bigint,
  accepted_mutation_id uuid,
  submitted_revision bigint,
  lesson_id text,
  lesson_attempt_id uuid,
  assessment_attempt_answers jsonb
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.user_id, a.assessment, a.status, a.started_at, a.submitted_at,
    a.score, a.completion_seconds, a.answering_seconds, a.content_version,
    a.expected_question_count, a.accepted_revision, a.accepted_mutation_id,
    a.submitted_revision, a.lesson_id, a.lesson_attempt_id,
    coalesce(jsonb_agg(jsonb_build_object('question_id', b.question_id,
      'selected_choice_id', b.selected_choice_id, 'answered_at', b.answered_at)
      order by b.question_id) filter (where b.id is not null), '[]'::jsonb)
  from public.assessment_attempts a
  left join public.assessment_attempt_answers b on b.attempt_id = a.id
  where p_lesson_attempt_id is not null
    and a.user_id = (select auth.uid())
    and a.assessment = p_assessment
    and a.lesson_attempt_id = p_lesson_attempt_id
    and not public.is_researcher()
    and not public.is_admin()
  group by a.id;
$$;

revoke all on function public.get_assessment_attempt(public.assessment_kind, uuid)
  from public, anon;
grant execute on function public.get_assessment_attempt(public.assessment_kind, uuid)
  to authenticated;

create function public.complete_assessment_revision(
  p_attempt_id uuid,
  p_revision bigint,
  p_answering_seconds integer
)
returns void
language plpgsql security definer set search_path = '' as $$
declare current_attempt public.assessment_attempts;
begin
  if (select auth.uid()) is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt from public.assessment_attempts
  where id = p_attempt_id and user_id = (select auth.uid()) for update;
  if current_attempt.id is null then raise exception 'Assessment not found.'; end if;
  if current_attempt.status = 'submitted' then return; end if;
  if p_revision is null or current_attempt.accepted_revision <> p_revision then
    raise exception 'Assessment revision conflict.' using errcode = '40001';
  end if;
  if p_answering_seconds is null or p_answering_seconds < 0 or p_answering_seconds > 86400 then
    raise exception 'Invalid assessment answering time.';
  end if;

  update public.assessment_attempts
  set answering_seconds = p_answering_seconds
  where id = p_attempt_id;

  perform public.complete_assessment_revision(p_attempt_id, p_revision);
end;
$$;

revoke all on function public.complete_assessment_revision(uuid, bigint, integer)
  from public, anon;
grant execute on function public.complete_assessment_revision(uuid, bigint, integer)
  to authenticated;

commit;
