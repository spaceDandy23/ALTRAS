-- Phase 4 follow-up: repair anonymous result codes and make researcher accounts
-- read-only at both the participant-data RLS and write-operation boundaries.
-- Run after 202608310001_researcher_results.sql.

-- Researcher accounts read participant outcomes only through the anonymized RPC.
drop policy if exists "Students read their own progress" on public.lesson_progress;
create policy "Students read their own progress"
  on public.lesson_progress for select to authenticated
  using ((select auth.uid()) = user_id and not public.is_researcher());

drop policy if exists "Students read their own attempts" on public.lesson_attempts;
create policy "Students read their own attempts"
  on public.lesson_attempts for select to authenticated
  using ((select auth.uid()) = user_id and not public.is_researcher());

drop policy if exists "Students read their own lesson answers" on public.attempt_answers;
create policy "Students read their own lesson answers"
  on public.attempt_answers for select to authenticated
  using (
    not public.is_researcher()
    and exists (
      select 1
      from public.lesson_attempts
      where id = attempt_id
        and user_id = (select auth.uid())
    )
  );

drop policy if exists "Students read their own assessments" on public.assessment_attempts;
create policy "Students read their own assessments"
  on public.assessment_attempts for select to authenticated
  using ((select auth.uid()) = user_id and not public.is_researcher());

drop policy if exists "Students read their own assessment answers"
  on public.assessment_attempt_answers;
create policy "Students read their own assessment answers"
  on public.assessment_attempt_answers for select to authenticated
  using (
    not public.is_researcher()
    and exists (
      select 1
      from public.assessment_attempts
      where id = attempt_id
        and user_id = (select auth.uid())
    )
  );

-- Direct participant writes must also reject allow-listed researchers. The
-- trigger below additionally protects writes performed by SECURITY DEFINER
-- lesson and assessment functions, which bypass table RLS by design.
drop policy if exists "Students create their own progress" on public.lesson_progress;
create policy "Students create their own progress"
  on public.lesson_progress for insert to authenticated
  with check ((select auth.uid()) = user_id and not public.is_researcher());

drop policy if exists "Students update their own progress" on public.lesson_progress;
create policy "Students update their own progress"
  on public.lesson_progress for update to authenticated
  using ((select auth.uid()) = user_id and not public.is_researcher())
  with check ((select auth.uid()) = user_id and not public.is_researcher());

drop policy if exists "Students create their own attempts" on public.lesson_attempts;
create policy "Students create their own attempts"
  on public.lesson_attempts for insert to authenticated
  with check ((select auth.uid()) = user_id and not public.is_researcher());

drop policy if exists "Students add answers to active attempts" on public.attempt_answers;
create policy "Students add answers to active attempts"
  on public.attempt_answers for insert to authenticated
  with check (
    not public.is_researcher()
    and exists (
      select 1
      from public.lesson_attempts
      where id = attempt_id
        and user_id = (select auth.uid())
        and status = 'active'
    )
  );

create or replace function public.reject_researcher_learning_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_researcher() then
    raise exception 'Researcher accounts cannot modify participant learning records.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.reject_researcher_learning_write() from public;

drop trigger if exists reject_researcher_lesson_progress_write on public.lesson_progress;
create trigger reject_researcher_lesson_progress_write
  before insert or update on public.lesson_progress
  for each row execute function public.reject_researcher_learning_write();

drop trigger if exists reject_researcher_lesson_attempt_write on public.lesson_attempts;
create trigger reject_researcher_lesson_attempt_write
  before insert or update on public.lesson_attempts
  for each row execute function public.reject_researcher_learning_write();

drop trigger if exists reject_researcher_lesson_answer_write on public.attempt_answers;
create trigger reject_researcher_lesson_answer_write
  before insert or update on public.attempt_answers
  for each row execute function public.reject_researcher_learning_write();

drop trigger if exists reject_researcher_assessment_attempt_write on public.assessment_attempts;
create trigger reject_researcher_assessment_attempt_write
  before insert or update on public.assessment_attempts
  for each row execute function public.reject_researcher_learning_write();

drop trigger if exists reject_researcher_assessment_answer_write
  on public.assessment_attempt_answers;
create trigger reject_researcher_assessment_answer_write
  before insert or update on public.assessment_attempt_answers
  for each row execute function public.reject_researcher_learning_write();

-- The original Phase 4 RPC used digest() while setting an empty search_path.
-- pgcrypto functions are outside pg_catalog, so that lookup can fail at runtime.
-- PostgreSQL's built-in md5() keeps codes deterministic without weakening the
-- empty search_path or depending on an extension schema.
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
    'ALT-' || upper(substr(md5(profile.user_id::text), 1, 8)),
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
        values
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
  order by 1;
end;
$$;

revoke execute on function public.get_researcher_results() from public;
grant execute on function public.get_researcher_results() to authenticated;
