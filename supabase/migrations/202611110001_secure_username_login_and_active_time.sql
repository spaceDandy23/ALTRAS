-- Move username identity resolution behind a rate-limited Edge Function and
-- bound client-reported active time by server-observed attempt duration.
begin;

drop function if exists public.resolve_login_email(text, text);

create table if not exists public.username_login_rate_limits (
  identifier_hash text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

alter table public.username_login_rate_limits enable row level security;
revoke all on table public.username_login_rate_limits from public, anon, authenticated;

create or replace function public.resolve_login_identity_for_edge(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text := lower(trim(coalesce(p_username, '')));
  resolved_email text;
begin
  if normalized_username !~ '^[a-z0-9_-]{3,24}$' then
    return null;
  end if;

  select auth_user.email into resolved_email
  from public.profiles profile
  join auth.users auth_user on auth_user.id = profile.user_id
  where profile.username = normalized_username
  limit 1;

  return resolved_email;
end;
$$;

create or replace function public.consume_username_login_rate_limit(
  p_identifier_hash text,
  p_attempt_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  consumed_count integer;
begin
  if p_identifier_hash !~ '^[a-f0-9]{64}$'
    or p_attempt_limit < 1
    or p_window_seconds < 1 then
    raise exception 'Invalid login rate-limit request.';
  end if;

  insert into public.username_login_rate_limits(identifier_hash, window_started_at, attempt_count)
  values (p_identifier_hash, now(), 1)
  on conflict (identifier_hash) do update
  set window_started_at = case
        when public.username_login_rate_limits.window_started_at
          <= now() - make_interval(secs => p_window_seconds) then now()
        else public.username_login_rate_limits.window_started_at
      end,
      attempt_count = case
        when public.username_login_rate_limits.window_started_at
          <= now() - make_interval(secs => p_window_seconds) then 1
        else public.username_login_rate_limits.attempt_count + 1
      end
  returning attempt_count into consumed_count;

  return consumed_count <= p_attempt_limit;
end;
$$;

create or replace function public.clear_username_login_rate_limit(p_identifier_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.username_login_rate_limits where identifier_hash = p_identifier_hash;
$$;

revoke all on function public.resolve_login_identity_for_edge(text) from public, anon, authenticated;
revoke all on function public.consume_username_login_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.clear_username_login_rate_limit(text) from public, anon, authenticated;
grant execute on function public.resolve_login_identity_for_edge(text) to service_role;
grant execute on function public.consume_username_login_rate_limit(text, integer, integer) to service_role;
grant execute on function public.clear_username_login_rate_limit(text) to service_role;

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
    and status in ('active', 'completed')
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
    case when result.status = 'completed' then coalesce(result.completed_at, now()) else now() end
    - result.started_at
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

revoke all on function public.add_attempt_active_seconds(uuid, integer, uuid) from public, anon;
grant execute on function public.add_attempt_active_seconds(uuid, integer, uuid) to authenticated;

commit;
