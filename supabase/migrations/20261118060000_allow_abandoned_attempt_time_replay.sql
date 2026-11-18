-- A lesson can be restarted while an active-time segment is waiting locally.
-- Keep that segment replayable after the server marks the old attempt abandoned,
-- while bounding accepted time at the server-recorded abandonment timestamp.
begin;

create or replace function public.add_attempt_active_seconds(
  p_attempt_id uuid,
  p_seconds integer,
  p_segment_id uuid
)
returns public.lesson_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  inserted_segment uuid;
  result public.lesson_attempts;
  observed_seconds integer;
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  if p_segment_id is null or p_seconds < 1 or p_seconds > 3600 then
    raise exception 'Invalid active-time segment.';
  end if;

  select * into result
  from public.lesson_attempts
  where id = p_attempt_id
    and user_id = caller_id
    and status in ('active', 'completed', 'abandoned')
  for update;
  if result.id is null then
    raise exception 'Attempt not found.';
  end if;

  if exists (
    select 1 from public.lesson_active_time_segments segment
    where segment.segment_id = p_segment_id
      and segment.attempt_id = p_attempt_id
      and segment.user_id = caller_id
      and segment.seconds = p_seconds
  ) then
    return result;
  elsif exists (
    select 1 from public.lesson_active_time_segments segment
    where segment.segment_id = p_segment_id
  ) then
    raise exception 'Invalid active-time segment.';
  end if;

  observed_seconds := greatest(0, floor(extract(epoch from (
    case
      when result.status = 'completed' then coalesce(result.completed_at, now())
      when result.status = 'abandoned' then coalesce(result.abandoned_at, now())
      else now()
    end - result.started_at
  )))::integer);
  if result.active_seconds + p_seconds > observed_seconds + 5 then
    raise exception 'Active-time segment exceeds server-observed attempt duration.';
  end if;

  insert into public.lesson_active_time_segments(segment_id, attempt_id, user_id, seconds)
  values (p_segment_id, p_attempt_id, caller_id, p_seconds)
  returning segment_id into inserted_segment;

  update public.lesson_attempts
  set active_seconds = active_seconds + p_seconds,
      last_updated_at = now()
  where id = p_attempt_id
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.add_attempt_active_seconds(uuid, integer) from authenticated;
revoke all on function public.add_attempt_active_seconds(uuid, integer, uuid) from public, anon;
grant execute on function public.add_attempt_active_seconds(uuid, integer, uuid) to authenticated;

commit;
