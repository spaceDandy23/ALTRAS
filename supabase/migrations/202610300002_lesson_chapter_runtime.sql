-- Phase 2 lesson flow: lesson-scoped assessments and server-owned chapter stages.
begin;

alter table public.lesson_definitions
  add column pre_assessment_version integer,
  add column post_assessment_version integer;

alter table public.lesson_attempts
  add column flow_stage text not null default 'legacy-activity'
    check (flow_stage in ('legacy-activity','pre-test','chapter-teaching','chapter-activity','post-test','ready-to-complete')),
  add column current_chapter_id text,
  add column pre_assessment_version integer,
  add column post_assessment_version integer;

alter table public.assessment_attempts
  drop constraint assessment_attempts_user_id_assessment_key,
  add column lesson_id text,
  add column lesson_attempt_id uuid references public.lesson_attempts(id) on delete cascade;

create unique index assessment_attempts_global_unique
  on public.assessment_attempts(user_id, assessment)
  where lesson_attempt_id is null;
create unique index assessment_attempts_lesson_unique
  on public.assessment_attempts(lesson_attempt_id, assessment)
  where lesson_attempt_id is not null;

alter function public.validate_authored_lesson(jsonb) rename to validate_chapter_authored_lesson;
create function public.validate_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  perform public.validate_chapter_authored_lesson(p);
  if p ? 'assessments' then
    if jsonb_typeof(p->'assessments') <> 'object'
      or (p->'assessments' ? 'preTest' and p#>>'{assessments,preTest}' <> 'pre-test')
      or (p->'assessments' ? 'postTest' and p#>>'{assessments,postTest}' <> 'post-test') then
      raise exception 'Invalid lesson assessment configuration.';
    end if;
  end if;
end;
$$;
revoke all on function public.validate_authored_lesson(jsonb) from public, anon, authenticated;

alter function public.compile_lesson(jsonb, integer) rename to compile_chapter_lesson;
create function public.compile_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare pre_version integer; post_version integer; safe_assessments jsonb := '{}'::jsonb;
begin
  perform public.validate_authored_lesson(p);
  if p#>>'{assessments,preTest}' = 'pre-test' then
    select published_version into pre_version from public.assessment_catalog where assessment = 'pre-test';
    if pre_version is null then raise exception 'Published pre-test content is required.'; end if;
    safe_assessments := safe_assessments || jsonb_build_object('preTest','pre-test');
  end if;
  if p#>>'{assessments,postTest}' = 'post-test' then
    select published_version into post_version from public.assessment_catalog where assessment = 'post-test';
    if post_version is null then raise exception 'Published post-test content is required.'; end if;
    safe_assessments := safe_assessments || jsonb_build_object('postTest','post-test');
  end if;

  perform public.compile_chapter_lesson(p, v);
  update public.lesson_definitions
  set pre_assessment_version = pre_version,
      post_assessment_version = post_version,
      presentation = presentation || case when safe_assessments = '{}'::jsonb then '{}'::jsonb
        else jsonb_build_object('assessments', safe_assessments) end
  where lesson_id = p->>'id' and content_version = v;
end;
$$;
revoke all on function public.compile_lesson(jsonb, integer) from public, anon, authenticated;

alter function public.start_lesson_attempt(text) rename to start_legacy_lesson_attempt;
create function public.start_lesson_attempt(p_lesson_id text)
returns public.lesson_attempts
language plpgsql security definer set search_path = '' as $$
declare result public.lesson_attempts; definition public.lesson_definitions; first_chapter text;
begin
  result := public.start_legacy_lesson_attempt(p_lesson_id);
  select * into definition from public.lesson_definitions
  where lesson_id = result.lesson_id and content_version = result.content_version;
  if result.flow_stage = 'legacy-activity'
    and (definition.pre_assessment_version is not null
      or definition.post_assessment_version is not null
      or jsonb_array_length(coalesce(definition.presentation->'chapters','[]'::jsonb)) > 1) then
    select chapter->>'id' into first_chapter
    from jsonb_array_elements(definition.presentation->'chapters') chapter
    order by (chapter->>'displayOrder')::integer limit 1;
    update public.lesson_attempts
    set flow_stage = case when definition.pre_assessment_version is not null
          then 'pre-test' else 'chapter-teaching' end,
        current_chapter_id = first_chapter,
        pre_assessment_version = definition.pre_assessment_version,
        post_assessment_version = definition.post_assessment_version,
        last_updated_at = now()
    where id = result.id returning * into result;
  end if;
  return result;
end;
$$;

create function public.advance_lesson_attempt_stage(p_attempt_id uuid)
returns public.lesson_attempts
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := (select auth.uid());
  current_attempt public.lesson_attempts;
  definition public.lesson_definitions;
  current_chapter jsonb;
  next_chapter jsonb;
  current_order integer;
  required_count integer;
  answered_count integer;
begin
  if caller_id is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt from public.lesson_attempts
  where id = p_attempt_id and user_id = caller_id for update;
  if current_attempt.id is null or current_attempt.status <> 'active' then
    raise exception 'Active attempt not found.';
  end if;
  select * into definition from public.lesson_definitions
  where lesson_id=current_attempt.lesson_id and content_version=current_attempt.content_version;

  if current_attempt.flow_stage = 'pre-test' then
    if not exists(select 1 from public.assessment_attempts
      where lesson_attempt_id=current_attempt.id and assessment='pre-test' and status='submitted') then
      raise exception 'Complete the lesson pre-test first.';
    end if;
    update public.lesson_attempts set flow_stage='chapter-teaching',last_updated_at=now()
    where id=current_attempt.id returning * into current_attempt;
    return current_attempt;
  end if;

  if current_attempt.flow_stage in ('chapter-teaching','chapter-activity') then
    select value into current_chapter
    from jsonb_array_elements(definition.presentation->'chapters') chapter(value)
    where value->>'id'=current_attempt.current_chapter_id;
    if current_chapter is null then raise exception 'Lesson chapter not found.'; end if;
    if current_attempt.flow_stage = 'chapter-teaching'
      and jsonb_array_length(current_chapter->'activities') > 0 then
      update public.lesson_attempts set flow_stage='chapter-activity',last_updated_at=now()
      where id=current_attempt.id returning * into current_attempt;
      return current_attempt;
    end if;
    if current_attempt.flow_stage = 'chapter-activity' then
      required_count := jsonb_array_length(current_chapter->'activities');
      select count(*) into answered_count from public.attempt_answers answer
      where answer.attempt_id=current_attempt.id and exists (
        select 1 from jsonb_array_elements(current_chapter->'activities') activity
        where activity->>'id'=answer.activity_id
      );
      if answered_count <> required_count then raise exception 'Complete every chapter activity first.'; end if;
    end if;
    current_order := (current_chapter->>'displayOrder')::integer;
    select value into next_chapter
    from jsonb_array_elements(definition.presentation->'chapters') chapter(value)
    where (value->>'displayOrder')::integer > current_order
    order by (value->>'displayOrder')::integer limit 1;
    update public.lesson_attempts
    set flow_stage = case when next_chapter is not null then 'chapter-teaching'
          when post_assessment_version is not null then 'post-test'
          else 'ready-to-complete' end,
        current_chapter_id = coalesce(next_chapter->>'id', current_chapter_id),
        last_updated_at=now()
    where id=current_attempt.id returning * into current_attempt;
    return current_attempt;
  end if;

  if current_attempt.flow_stage = 'post-test' then
    if not exists(select 1 from public.assessment_attempts
      where lesson_attempt_id=current_attempt.id and assessment='post-test' and status='submitted') then
      raise exception 'Complete the lesson post-test first.';
    end if;
    update public.lesson_attempts set flow_stage='ready-to-complete',last_updated_at=now()
    where id=current_attempt.id returning * into current_attempt;
    return current_attempt;
  end if;
  raise exception 'This lesson step cannot advance.';
end;
$$;

alter function public.submit_lesson_activity_answer(uuid,text,jsonb)
  rename to submit_legacy_lesson_activity_answer;
create function public.submit_lesson_activity_answer(
  p_attempt_id uuid, p_activity_id text, p_submitted_answer jsonb
)
returns public.attempt_answers
language plpgsql security definer set search_path = '' as $$
declare current_attempt public.lesson_attempts; definition public.lesson_definitions; chapter jsonb; position bigint;
begin
  select * into current_attempt from public.lesson_attempts
  where id=p_attempt_id and user_id=(select auth.uid()) for update;
  if current_attempt.id is null or current_attempt.status <> 'active' then
    raise exception 'Active attempt not found.';
  end if;
  if current_attempt.flow_stage not in ('legacy-activity','chapter-activity') then
    raise exception 'Complete the current lesson step first.';
  end if;
  if current_attempt.flow_stage = 'chapter-activity' then
    select presentation into definition.presentation from public.lesson_definitions
    where lesson_id=current_attempt.lesson_id and content_version=current_attempt.content_version;
    select value into chapter from jsonb_array_elements(definition.presentation->'chapters') value
    where value->>'id'=current_attempt.current_chapter_id;
    select ordinality into position from jsonb_array_elements(chapter->'activities') with ordinality activity(value,ordinality)
    where value->>'id'=p_activity_id;
    if position is null then raise exception 'Activity is not in the current chapter.'; end if;
    if exists(select 1 from jsonb_array_elements(chapter->'activities') with ordinality activity(value,ordinality)
      where ordinality < position and not exists(select 1 from public.attempt_answers answer
        where answer.attempt_id=current_attempt.id and answer.activity_id=value->>'id')) then
      raise exception 'Complete activities in order.';
    end if;
  end if;
  return public.submit_legacy_lesson_activity_answer(p_attempt_id,p_activity_id,p_submitted_answer);
end;
$$;

alter function public.complete_lesson_attempt(uuid) rename to complete_legacy_lesson_attempt;
create function public.complete_lesson_attempt(p_attempt_id uuid)
returns public.lesson_attempts
language plpgsql security definer set search_path = '' as $$
declare current_attempt public.lesson_attempts;
begin
  select * into current_attempt from public.lesson_attempts
  where id=p_attempt_id and user_id=(select auth.uid()) for update;
  if current_attempt.id is null then raise exception 'Attempt not found.'; end if;
  if current_attempt.status='completed' then return current_attempt; end if;
  if current_attempt.flow_stage not in ('legacy-activity','ready-to-complete') then
    raise exception 'Complete every required lesson step first.';
  end if;
  return public.complete_legacy_lesson_attempt(p_attempt_id);
end;
$$;

alter function public.start_assessment(public.assessment_kind) rename to start_global_assessment;
alter function public.get_assessment_questions(public.assessment_kind) rename to get_global_assessment_questions;
alter function public.get_assessment_attempt(public.assessment_kind) rename to get_global_assessment_attempt;

create or replace function public.start_global_assessment(p_assessment public.assessment_kind)
returns public.assessment_attempts
language plpgsql security definer set search_path = '' as $$
declare result public.assessment_attempts; version integer; question_count integer;
begin
  if (select auth.uid()) is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into result from public.assessment_attempts
  where user_id=(select auth.uid()) and assessment=p_assessment and lesson_attempt_id is null;
  if result.id is not null then return result; end if;
  select published_version into version from public.assessment_catalog where assessment=p_assessment;
  select count(*) into question_count from public.assessment_questions
  where assessment=p_assessment and content_version=version;
  if version is null or question_count=0 then raise exception 'Assessment content is not available.'; end if;
  insert into public.assessment_attempts(user_id,assessment,content_version,expected_question_count)
  values((select auth.uid()),p_assessment,version,question_count) returning * into result;
  return result;
end;
$$;

create function public.start_assessment(
  p_assessment public.assessment_kind,
  p_lesson_attempt_id uuid default null
)
returns public.assessment_attempts
language plpgsql security definer set search_path = '' as $$
declare result public.assessment_attempts; lesson_attempt public.lesson_attempts; version integer; question_count integer;
begin
  if p_lesson_attempt_id is null then return public.start_global_assessment(p_assessment); end if;
  if (select auth.uid()) is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into lesson_attempt from public.lesson_attempts
  where id=p_lesson_attempt_id and user_id=(select auth.uid()) and status='active' for update;
  if lesson_attempt.id is null then raise exception 'Active lesson attempt not found.'; end if;
  if (p_assessment='pre-test' and lesson_attempt.flow_stage <> 'pre-test')
    or (p_assessment='post-test' and lesson_attempt.flow_stage <> 'post-test') then
    raise exception 'This assessment is not the current lesson step.';
  end if;
  version := case when p_assessment='pre-test' then lesson_attempt.pre_assessment_version
    else lesson_attempt.post_assessment_version end;
  if version is null then raise exception 'This lesson does not include that assessment.'; end if;
  select * into result from public.assessment_attempts
  where lesson_attempt_id=p_lesson_attempt_id and assessment=p_assessment;
  if result.id is not null then return result; end if;
  select count(*) into question_count from public.assessment_questions
  where assessment=p_assessment and content_version=version;
  if question_count=0 then raise exception 'Assessment content is not available.'; end if;
  insert into public.assessment_attempts
    (user_id,assessment,content_version,expected_question_count,lesson_id,lesson_attempt_id)
  values ((select auth.uid()),p_assessment,version,question_count,lesson_attempt.lesson_id,lesson_attempt.id)
  returning * into result;
  return result;
end;
$$;

create function public.get_assessment_questions(
  p_assessment public.assessment_kind,
  p_lesson_attempt_id uuid default null
)
returns table (id text, assessment public.assessment_kind, display_order integer, prompt text,
  choices jsonb, content_version integer, is_placeholder boolean)
language sql stable security definer set search_path = '' as $$
  select q.id,q.assessment,q.display_order,q.prompt,q.choices,q.content_version,q.is_placeholder
  from public.assessment_questions q
  where q.assessment=p_assessment
    and q.content_version=case when p_lesson_attempt_id is null then coalesce(
      (select a.content_version from public.assessment_attempts a
       where a.user_id=(select auth.uid()) and a.assessment=p_assessment and a.lesson_attempt_id is null),
      (select c.published_version from public.assessment_catalog c where c.assessment=p_assessment))
    else coalesce(
      (select a.content_version from public.assessment_attempts a
       where a.user_id=(select auth.uid()) and a.assessment=p_assessment and a.lesson_attempt_id=p_lesson_attempt_id),
      (select case when p_assessment='pre-test' then l.pre_assessment_version else l.post_assessment_version end
       from public.lesson_attempts l where l.id=p_lesson_attempt_id and l.user_id=(select auth.uid()))) end
    and (select auth.uid()) is not null and not public.is_researcher() and not public.is_admin()
  order by q.display_order;
$$;

create function public.get_assessment_attempt(
  p_assessment public.assessment_kind,
  p_lesson_attempt_id uuid default null
)
returns table (
  id uuid,user_id uuid,assessment public.assessment_kind,status public.assessment_attempt_status,
  started_at timestamptz,submitted_at timestamptz,score smallint,completion_seconds integer,
  content_version integer,expected_question_count integer,accepted_revision bigint,
  accepted_mutation_id uuid,submitted_revision bigint,lesson_id text,lesson_attempt_id uuid,
  assessment_attempt_answers jsonb
)
language sql stable security definer set search_path = '' as $$
  select a.id,a.user_id,a.assessment,a.status,a.started_at,a.submitted_at,a.score,a.completion_seconds,
    a.content_version,a.expected_question_count,a.accepted_revision,a.accepted_mutation_id,
    a.submitted_revision,a.lesson_id,a.lesson_attempt_id,
    coalesce(jsonb_agg(jsonb_build_object('question_id',b.question_id,
      'selected_choice_id',b.selected_choice_id,'answered_at',b.answered_at)
      order by b.question_id) filter(where b.id is not null),'[]'::jsonb)
  from public.assessment_attempts a left join public.assessment_attempt_answers b on b.attempt_id=a.id
  where a.user_id=(select auth.uid()) and a.assessment=p_assessment
    and a.lesson_attempt_id is not distinct from p_lesson_attempt_id
    and not public.is_researcher() and not public.is_admin()
  group by a.id;
$$;

-- Lesson-scoped checks belong to their lesson attempt. Keep the existing
-- researcher pre/post columns limited to the standalone study assessments.
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
    where attempts.lesson_attempt_id is null
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

revoke all on function public.start_legacy_lesson_attempt(text),
  public.submit_legacy_lesson_activity_answer(uuid,text,jsonb),
  public.complete_legacy_lesson_attempt(uuid),
  public.start_global_assessment(public.assessment_kind),
  public.get_global_assessment_questions(public.assessment_kind),
  public.get_global_assessment_attempt(public.assessment_kind)
from public,anon,authenticated;
revoke execute on function public.start_lesson_attempt(text),
  public.advance_lesson_attempt_stage(uuid),
  public.submit_lesson_activity_answer(uuid,text,jsonb),
  public.complete_lesson_attempt(uuid),
  public.start_assessment(public.assessment_kind,uuid),
  public.get_assessment_questions(public.assessment_kind,uuid),
  public.get_assessment_attempt(public.assessment_kind,uuid)
from public,anon;
grant execute on function public.start_lesson_attempt(text),
  public.advance_lesson_attempt_stage(uuid),
  public.submit_lesson_activity_answer(uuid,text,jsonb),
  public.complete_lesson_attempt(uuid),
  public.start_assessment(public.assessment_kind,uuid),
  public.get_assessment_questions(public.assessment_kind,uuid),
  public.get_assessment_attempt(public.assessment_kind,uuid)
to authenticated;

commit;
