-- One authoritative activity-day ledger; streak lengths are derived, never writable counters.
-- Calendar: Asia/Manila for all ALTRAS students until a per-user timezone model exists.
-- Only complete lesson attempts count (including low scores and replays). No backfill.
begin;

create table public.student_activity_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_day date not null,
  qualifying_attempt_id uuid not null unique references public.lesson_attempts(id),
  recorded_at timestamptz not null default statement_timestamp(),
  feedback_claimed_at timestamptz,
  primary key (user_id, activity_day)
);

alter table public.student_activity_days enable row level security;
revoke all on public.student_activity_days from public, anon, authenticated;
grant select on public.student_activity_days to authenticated;
create policy "Students read only their own activity days"
  on public.student_activity_days for select to authenticated
  using (user_id = (select auth.uid()) and not public.is_researcher());

create function public.record_student_activity_day()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  expected_count integer;
  answered_count integer;
begin
  -- This function is reachable only through the already-authoritative completion UPDATE.
  if caller_id is null or caller_id <> new.user_id or public.is_researcher() then
    return new;
  end if;
  if old.status <> 'active' or new.status <> 'completed'
    or new.completed_at is null or new.final_score is null then
    return new;
  end if;

  select definition.expected_activity_count into expected_count
  from public.lesson_definitions definition
  where definition.lesson_id = new.lesson_id and definition.content_version = new.content_version;
  select count(*) into answered_count
  from public.attempt_answers answer
  join public.lesson_activity_keys activity
    on activity.lesson_id = new.lesson_id and activity.content_version = new.content_version
    and activity.activity_id = answer.activity_id
  where answer.attempt_id = new.id;
  if expected_count is null or expected_count < 1 or answered_count <> expected_count then
    return new;
  end if;

  insert into public.student_activity_days (user_id, activity_day, qualifying_attempt_id)
  values (caller_id, (statement_timestamp() at time zone 'Asia/Manila')::date, new.id)
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function public.record_student_activity_day() from public, anon, authenticated;
create trigger on_student_lesson_completed
  after update of status on public.lesson_attempts
  for each row when (old.status = 'active' and new.status = 'completed')
  execute function public.record_student_activity_day();

-- No user id, date, timezone, or counters are accepted. The optional attempt id only
-- claims feedback for the day's first completion; it cannot create activity.
create function public.get_student_streak(p_attempt_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  server_now timestamptz := statement_timestamp();
  today date := (server_now at time zone 'Asia/Manila')::date;
  latest_day date;
  current_length integer;
  longest_length integer;
  claimed_day date;
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  if p_attempt_id is not null then
    update public.student_activity_days
    set feedback_claimed_at = server_now
    where user_id = caller_id and activity_day = today
      and qualifying_attempt_id = p_attempt_id and feedback_claimed_at is null
    returning activity_day into claimed_day;
  end if;

  with numbered_days as (
    select activity_day,
      activity_day - (row_number() over (order by activity_day))::integer as island
    from public.student_activity_days where user_id = caller_id
  ), runs as (
    select max(activity_day) as last_day, count(*)::integer as length
    from numbered_days group by island
  )
  select max(last_day), coalesce(max(length), 0),
    coalesce(max(length) filter (where last_day >= today - 1), 0)
  into latest_day, longest_length, current_length
  from runs;

  return jsonb_build_object(
    'user_id', caller_id,
    'current_streak', current_length,
    'longest_streak', longest_length,
    'last_activity_date', latest_day,
    'earned_today', coalesce(latest_day = today, false),
    'celebrate', claimed_day is not null,
    'calendar_timezone', 'Asia/Manila',
    'refresh_after_seconds', greatest(1, ceil(extract(epoch from (
      ((today + 1)::timestamp at time zone 'Asia/Manila') - server_now
    ))))
  );
end;
$$;

revoke all on function public.get_student_streak(uuid) from public, anon;
grant execute on function public.get_student_streak(uuid) to authenticated;

commit;
