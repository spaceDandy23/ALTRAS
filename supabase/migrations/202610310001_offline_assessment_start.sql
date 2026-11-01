-- Allow a cached lesson assessment to claim a stable client-generated ID on reconnect.
begin;

drop function public.start_assessment(public.assessment_kind, uuid);

create function public.start_assessment(
  p_assessment public.assessment_kind,
  p_lesson_attempt_id uuid default null,
  p_client_attempt_id uuid default null
)
returns public.assessment_attempts
language plpgsql security definer set search_path = '' as $$
declare
  result public.assessment_attempts;
  lesson_attempt public.lesson_attempts;
  version integer;
  question_count integer;
begin
  if p_lesson_attempt_id is null then
    return public.start_global_assessment(p_assessment);
  end if;
  if (select auth.uid()) is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into lesson_attempt from public.lesson_attempts
  where id=p_lesson_attempt_id and user_id=(select auth.uid()) and status='active' for update;
  if lesson_attempt.id is null then raise exception 'Active lesson attempt not found.'; end if;
  select * into result from public.assessment_attempts
  where lesson_attempt_id=p_lesson_attempt_id and assessment=p_assessment;
  if result.id is not null then return result; end if;
  if (p_assessment='pre-test' and lesson_attempt.flow_stage <> 'pre-test')
    or (p_assessment='post-test' and lesson_attempt.flow_stage <> 'post-test') then
    raise exception 'This assessment is not the current lesson step.';
  end if;
  version := case when p_assessment='pre-test' then lesson_attempt.pre_assessment_version
    else lesson_attempt.post_assessment_version end;
  if version is null then raise exception 'This lesson does not include that assessment.'; end if;
  if p_client_attempt_id is not null and exists(
    select 1 from public.assessment_attempts where id=p_client_attempt_id
  ) then
    raise exception 'Assessment attempt ID is already in use.';
  end if;
  select count(*) into question_count from public.assessment_questions
  where assessment=p_assessment and content_version=version;
  if question_count=0 then raise exception 'Assessment content is not available.'; end if;
  insert into public.assessment_attempts
    (id,user_id,assessment,content_version,expected_question_count,lesson_id,lesson_attempt_id)
  values (coalesce(p_client_attempt_id,gen_random_uuid()),(select auth.uid()),p_assessment,version,
    question_count,lesson_attempt.lesson_id,lesson_attempt.id)
  returning * into result;
  return result;
end;
$$;

revoke execute on function public.start_assessment(public.assessment_kind,uuid,uuid) from public,anon;
grant execute on function public.start_assessment(public.assessment_kind,uuid,uuid) to authenticated;

commit;
