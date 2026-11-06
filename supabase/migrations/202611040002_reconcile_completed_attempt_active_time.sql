-- A durable active-time segment can be created just before a lesson closes
-- and replayed after the completion acknowledgement. Keep that idempotent
-- segment recordable instead of leaving the local queue stuck forever.
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
    and status in ('active', 'completed')
  for update;
  if result.id is null then
    raise exception 'Attempt not found.';
  end if;

  insert into public.lesson_active_time_segments(segment_id, attempt_id, user_id, seconds)
  values (p_segment_id, p_attempt_id, caller_id, p_seconds)
  on conflict (segment_id) do nothing
  returning segment_id into inserted_segment;

  if inserted_segment is not null then
    update public.lesson_attempts
    set active_seconds = active_seconds + p_seconds,
        last_updated_at = now()
    where id = p_attempt_id
    returning * into result;
  elsif not exists (
    select 1
    from public.lesson_active_time_segments segment
    where segment.segment_id = p_segment_id
      and segment.attempt_id = p_attempt_id
      and segment.user_id = caller_id
      and segment.seconds = p_seconds
  ) then
    raise exception 'Invalid active-time segment.';
  end if;

  return result;
end;
$$;

revoke execute on function public.add_attempt_active_seconds(uuid, integer) from authenticated;
revoke all on function public.add_attempt_active_seconds(uuid, integer, uuid) from public, anon;
grant execute on function public.add_attempt_active_seconds(uuid, integer, uuid) to authenticated;

commit;
