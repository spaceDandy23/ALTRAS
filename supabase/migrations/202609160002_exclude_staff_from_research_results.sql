-- Keep administrator and researcher accounts out of the participant population.
begin;

create or replace function public.get_researcher_results()
returns table (
  participant_code text,
  username text,
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
  with active_lessons as (
    select catalog.lesson_id
    from public.lesson_catalog catalog
    where catalog.published
  ),
  lesson_attempt_summary as (
    select
      attempt.user_id,
      attempt.lesson_id,
      (
        array_agg(attempt.final_score order by attempt.completed_at desc)
        filter (where attempt.status = 'completed' and attempt.final_score is not null)
      )[1]::smallint as latest_score,
      coalesce(sum(attempt.active_seconds), 0)::integer as active_seconds
    from public.lesson_attempts attempt
    join active_lessons active on active.lesson_id = attempt.lesson_id
    group by attempt.user_id, attempt.lesson_id
  ),
  participant_lessons as (
    select
      progress.user_id,
      count(*) filter (where progress.status = 'cleared')::integer as lessons_completed,
      count(*)::integer as lessons_available,
      max(progress.last_attempted_at) as latest_lesson_activity_at,
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
      ) as lesson_results
    from public.lesson_progress progress
    join active_lessons active on active.lesson_id = progress.lesson_id
    left join lesson_attempt_summary attempts
      on attempts.user_id = progress.user_id
      and attempts.lesson_id = progress.lesson_id
    group by progress.user_id
  ),
  participant_assessments as (
    select
      attempts.user_id,
      case
        when bool_or(attempts.assessment = 'pre-test' and attempts.status = 'submitted') then 'completed'
        when bool_or(attempts.assessment = 'pre-test' and attempts.status = 'active') then 'in_progress'
        else 'not_started'
      end as pre_test_status,
      max(attempts.score) filter (
        where attempts.assessment = 'pre-test' and attempts.status = 'submitted'
      )::smallint as pre_test_score,
      max(attempts.submitted_at) filter (
        where attempts.assessment = 'pre-test' and attempts.status = 'submitted'
      ) as pre_test_completed_at,
      case
        when bool_or(attempts.assessment = 'post-test' and attempts.status = 'submitted') then 'completed'
        when bool_or(attempts.assessment = 'post-test' and attempts.status = 'active') then 'in_progress'
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
    'ALT-' || upper(substr(md5(profile.user_id::text), 1, 8)),
    profile.username,
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
      from (values
        (assessments.pre_test_completed_at),
        (assessments.post_test_completed_at),
        (lessons.latest_lesson_activity_at)
      ) as activities(activity_at)
    ),
    coalesce(lessons.lesson_results, '[]'::jsonb)
  from public.profiles profile
  left join participant_assessments assessments on assessments.user_id = profile.user_id
  left join participant_lessons lessons on lessons.user_id = profile.user_id
  where not exists (
    select 1 from public.researcher_users researchers
    where researchers.user_id = profile.user_id
  )
  and not exists (
    select 1 from public.admin_users administrators
    where administrators.user_id = profile.user_id
  )
  order by 1;
end;
$$;

revoke execute on function public.get_researcher_results() from public, anon;
grant execute on function public.get_researcher_results() to authenticated;

commit;
