-- Phase 4: secure, anonymized researcher results access.
-- Apply after the online foundation and assessment migrations.

create table public.researcher_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now()
);

-- Preserve any manually provisioned legacy researchers while moving the source
-- of truth to the dedicated allow-list table.
insert into public.researcher_users (user_id)
select user_id
from public.profiles
where role = 'researcher'
on conflict (user_id) do nothing;

alter table public.researcher_users enable row level security;

create policy "Researchers verify only their own authorization"
  on public.researcher_users for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.researcher_users from authenticated;
grant select on public.researcher_users to authenticated;

-- This function intentionally accepts no user ID, so it can only disclose the
-- current caller's authorization state.
create or replace function public.is_researcher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.researcher_users
    where user_id = (select auth.uid())
  );
$$;

-- Researchers must use the anonymized RPC below. Remove the legacy broad
-- researcher reads so raw participant data and submitted answers remain private.
drop policy if exists "Students read their profile; researchers read all" on public.profiles;
drop policy if exists "Students read progress; researchers read all" on public.lesson_progress;
drop policy if exists "Students read attempts; researchers read all" on public.lesson_attempts;
drop policy if exists "Students read answers; researchers read all" on public.attempt_answers;
drop policy if exists "Students read assessments; researchers read all" on public.assessment_attempts;
drop policy if exists "Students read assessment answers; researchers read all"
  on public.assessment_attempt_answers;

create policy "Students read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Students read their own progress"
  on public.lesson_progress for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Students read their own attempts"
  on public.lesson_attempts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Students read their own lesson answers"
  on public.attempt_answers for select to authenticated
  using (
    exists (
      select 1
      from public.lesson_attempts
      where id = attempt_id
        and user_id = (select auth.uid())
    )
  );

create policy "Students read their own assessments"
  on public.assessment_attempts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Students read their own assessment answers"
  on public.assessment_attempt_answers for select to authenticated
  using (
    exists (
      select 1
      from public.assessment_attempts
      where id = attempt_id
        and user_id = (select auth.uid())
    )
  );

create or replace function public.get_researcher_results()
returns table (
  participant_code text,
  pre_test_status text,
  pre_test_score smallint,
  pre_test_completed_at timestamptz,
  post_test_status text,
  post_test_score smallint,
  post_test_completed_at timestamptz,
  lessons_completed integer,
  lessons_available integer,
  latest_activity_at timestamptz,
  lesson_results jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_researcher() then
    raise exception 'Researcher access required.' using errcode = '42501';
  end if;

  return query
  with lesson_attempt_summary as (
    select
      user_id,
      lesson_id,
      (
        array_agg(final_score order by completed_at desc)
        filter (where status = 'completed' and final_score is not null)
      )[1]::smallint as latest_score,
      coalesce(sum(active_seconds), 0)::integer as active_seconds
    from public.lesson_attempts
    group by user_id, lesson_id
  ),
  participant_lessons as (
    select
      progress.user_id,
      count(*) filter (where progress.status = 'cleared')::integer as lessons_completed,
      count(*)::integer as lessons_available,
      max(progress.last_attempted_at) as latest_lesson_activity_at,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'lesson_id', progress.lesson_id,
            'status', progress.status,
            'best_score', progress.best_score,
            'latest_score', attempts.latest_score,
            'attempt_count', progress.attempt_count,
            'completed_at', progress.cleared_at,
            'active_seconds', coalesce(attempts.active_seconds, 0)
          )
          order by progress.lesson_id
        ),
        '[]'::jsonb
      ) as lesson_results
    from public.lesson_progress progress
    left join lesson_attempt_summary attempts
      on attempts.user_id = progress.user_id
      and attempts.lesson_id = progress.lesson_id
    group by progress.user_id
  ),
  participant_assessments as (
    select
      attempts.user_id,
      case
        when bool_or(attempts.assessment = 'pre-test' and attempts.status = 'submitted')
          then 'completed'
        when bool_or(attempts.assessment = 'pre-test' and attempts.status = 'active')
          then 'in_progress'
        else 'not_started'
      end as pre_test_status,
      max(attempts.score) filter (
        where attempts.assessment = 'pre-test' and attempts.status = 'submitted'
      )::smallint as pre_test_score,
      max(attempts.submitted_at) filter (
        where attempts.assessment = 'pre-test' and attempts.status = 'submitted'
      ) as pre_test_completed_at,
      case
        when bool_or(attempts.assessment = 'post-test' and attempts.status = 'submitted')
          then 'completed'
        when bool_or(attempts.assessment = 'post-test' and attempts.status = 'active')
          then 'in_progress'
        else 'not_started'
      end as post_test_status,
      max(attempts.score) filter (
        where attempts.assessment = 'post-test' and attempts.status = 'submitted'
      )::smallint as post_test_score,
      max(attempts.submitted_at) filter (
        where attempts.assessment = 'post-test' and attempts.status = 'submitted'
      ) as post_test_completed_at
    from public.assessment_attempts attempts
    group by attempts.user_id
  )
  select
    'ALT-' || upper(substr(encode(digest(profile.user_id::text, 'sha256'), 'hex'), 1, 8)),
    coalesce(assessments.pre_test_status, 'not_started'),
    assessments.pre_test_score,
    assessments.pre_test_completed_at,
    coalesce(assessments.post_test_status, 'not_started'),
    assessments.post_test_score,
    assessments.post_test_completed_at,
    coalesce(lessons.lessons_completed, 0),
    coalesce(lessons.lessons_available, 0),
    (
      select max(activity_at)
      from (
        values (
          assessments.pre_test_completed_at
        ), (
          assessments.post_test_completed_at
        ), (
          lessons.latest_lesson_activity_at
        )
      ) as activities(activity_at)
    ),
    coalesce(lessons.lesson_results, '[]'::jsonb)
  from public.profiles profile
  left join participant_assessments assessments on assessments.user_id = profile.user_id
  left join participant_lessons lessons on lessons.user_id = profile.user_id
  order by 1;
end;
$$;

revoke execute on function public.is_researcher() from public;
grant execute on function public.is_researcher() to authenticated;
revoke execute on function public.get_researcher_results() from public;
grant execute on function public.get_researcher_results() to authenticated;
