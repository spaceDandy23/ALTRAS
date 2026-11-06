-- Idempotent lesson-stage acknowledgement for offline/reconnect replay.
begin;

create function public.sync_lesson_attempt_stage(
  p_attempt_id uuid,
  p_expected_stage text,
  p_expected_chapter_id text
)
returns public.lesson_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_attempt public.lesson_attempts;
begin
  if caller_id is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt
  from public.lesson_attempts
  where id = p_attempt_id and user_id = caller_id
  for update;
  if current_attempt.id is null or current_attempt.status <> 'active' then
    raise exception 'Active attempt not found.';
  end if;
  if current_attempt.flow_stage <> p_expected_stage
    or current_attempt.current_chapter_id is distinct from p_expected_chapter_id then
    return current_attempt;
  end if;
  return public.advance_lesson_attempt_stage(p_attempt_id);
end;
$$;

revoke execute on function public.sync_lesson_attempt_stage(uuid,text,text) from public,anon;
grant execute on function public.sync_lesson_attempt_stage(uuid,text,text) to authenticated;

commit;
