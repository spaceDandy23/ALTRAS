begin;

-- Older authored lessons have no attemptLimit field and remain Unlimited.
alter function public.validate_authored_lesson(jsonb)
  rename to validate_authored_lesson_before_attempt_limits;
create function public.validate_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare configured jsonb; mode text; maximum text;
begin
  perform public.validate_authored_lesson_before_attempt_limits(p);
  if not (p ? 'attemptLimit') then return; end if;
  configured := p->'attemptLimit';
  if jsonb_typeof(configured) is distinct from 'object'
    or coalesce(configured->>'mode','') not in ('unlimited','limited') then
    raise exception 'Lesson attempt limit configuration is invalid.';
  end if;
  mode := configured->>'mode';
  if mode = 'limited' then
    maximum := configured->>'maxAttempts';
    if jsonb_typeof(configured->'maxAttempts') is distinct from 'number'
      or (maximum::numeric <= 0)
      or (maximum::numeric <> trunc(maximum::numeric)) then
      raise exception 'A limited lesson must have a positive whole-number attempt limit.';
    end if;
  end if;
end;
$$;
revoke all on function public.validate_authored_lesson_before_attempt_limits(jsonb),
  public.validate_authored_lesson(jsonb) from public, anon, authenticated;

-- Persist the limit with each immutable published lesson version.
alter function public.compile_lesson(jsonb, integer)
  rename to compile_lesson_before_attempt_limits;
create function public.compile_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
begin
  perform public.validate_authored_lesson(p);
  perform public.compile_lesson_before_attempt_limits(p, v);
  update public.lesson_definitions
  set presentation = presentation || jsonb_build_object(
    'attemptLimit', coalesce(p->'attemptLimit', '{"mode":"unlimited","maxAttempts":null}'::jsonb)
  )
  where lesson_id = p->>'id' and content_version = v;
end;
$$;
revoke all on function public.compile_lesson_before_attempt_limits(jsonb, integer),
  public.compile_lesson(jsonb, integer) from public, anon, authenticated;

-- This helper only exposes the caller's own count and the current published limit.
create function public.lesson_attempt_limit_status(p_lesson_id text, p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare presentation jsonb; used bigint; mode text; maximum numeric; reached boolean;
begin
  select d.presentation into presentation
  from public.lesson_catalog c join public.lesson_definitions d
    on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
  where c.lesson_id=p_lesson_id and c.published;
  select count(*) into used from public.lesson_attempts
    where user_id=p_user_id and lesson_id=p_lesson_id;
  mode := presentation#>>'{attemptLimit,mode}';
  if jsonb_typeof(presentation#>'{attemptLimit,maxAttempts}') = 'number'
    and (presentation#>>'{attemptLimit,maxAttempts}')::numeric > 0
    and (presentation#>>'{attemptLimit,maxAttempts}')::numeric = trunc((presentation#>>'{attemptLimit,maxAttempts}')::numeric) then
    maximum := (presentation#>>'{attemptLimit,maxAttempts}')::numeric;
  end if;
  reached := mode='limited' and (maximum is null or used >= maximum);
  return jsonb_build_object('attemptsUsed',used,'attemptLimitReached',coalesce(reached,false));
end;
$$;
revoke all on function public.lesson_attempt_limit_status(text, uuid) from public, anon, authenticated;

alter function public.get_lesson_catalog() rename to get_lesson_catalog_before_attempt_limits;
create function public.get_lesson_catalog() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lessons jsonb;
begin
  lessons := public.get_lesson_catalog_before_attempt_limits();
  return coalesce((
    select jsonb_agg(lesson.value || public.lesson_attempt_limit_status(
      lesson.value->>'id',(select auth.uid())
    ) order by ordinality)
    from jsonb_array_elements(lessons) with ordinality lesson(value,ordinality)
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.get_lesson_catalog_before_attempt_limits(),
  public.get_lesson_catalog() from public, anon, authenticated;
grant execute on function public.get_lesson_catalog() to authenticated;

alter function public.get_lesson_content(text, uuid)
  rename to get_lesson_content_before_attempt_limits;
create function public.get_lesson_content(p_lesson_id text, p_attempt_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare lesson jsonb;
begin
  lesson := public.get_lesson_content_before_attempt_limits(p_lesson_id,p_attempt_id);
  if p_attempt_id is null then
    return lesson || public.lesson_attempt_limit_status(p_lesson_id,(select auth.uid()));
  end if;
  return lesson;
end;
$$;
revoke all on function public.get_lesson_content_before_attempt_limits(text, uuid),
  public.get_lesson_content(text, uuid) from public, anon, authenticated;
grant execute on function public.get_lesson_content(text, uuid) to authenticated;

-- Serialize starts for one student/lesson pair so parallel requests cannot pass the cap.
alter function public.start_lesson_attempt(text)
  rename to start_lesson_attempt_before_attempt_limits;
create function public.start_lesson_attempt(p_lesson_id text)
returns public.lesson_attempts
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := (select auth.uid());
  presentation jsonb;
  mode text;
  maximum numeric;
  used bigint;
  result public.lesson_attempts;
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(caller_id::text || ':' || p_lesson_id,0));

  -- Existing active work can always be resumed, even if an administrator later lowers the cap.
  select * into result from public.lesson_attempts
  where user_id=caller_id and lesson_id=p_lesson_id and status='active' limit 1;
  if result.id is not null then
    return public.start_lesson_attempt_before_attempt_limits(p_lesson_id);
  end if;

  select d.presentation into presentation
  from public.lesson_catalog c join public.lesson_definitions d
    on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
  where c.lesson_id=p_lesson_id and c.published
  for share of c;
  mode := presentation#>>'{attemptLimit,mode}';
  if mode='limited' then
    if jsonb_typeof(presentation#>'{attemptLimit,maxAttempts}') = 'number'
      and (presentation#>>'{attemptLimit,maxAttempts}')::numeric > 0
      and (presentation#>>'{attemptLimit,maxAttempts}')::numeric = trunc((presentation#>>'{attemptLimit,maxAttempts}')::numeric) then
      maximum := (presentation#>>'{attemptLimit,maxAttempts}')::numeric;
    end if;
    select count(*) into used from public.lesson_attempts
      where user_id=caller_id and lesson_id=p_lesson_id;
    if maximum is null or used >= maximum then
      raise exception 'Lesson attempt limit reached.' using errcode='P0001';
    end if;
  end if;

  return public.start_lesson_attempt_before_attempt_limits(p_lesson_id);
end;
$$;
revoke all on function public.start_lesson_attempt_before_attempt_limits(text),
  public.start_lesson_attempt(text) from public, anon, authenticated;
grant execute on function public.start_lesson_attempt(text) to authenticated;

commit;
