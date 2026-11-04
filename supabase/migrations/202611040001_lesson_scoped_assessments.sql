-- Move assessment authoring and runtime into each lesson. Standalone assessments are retired.
begin;

alter table public.assessment_questions add column lesson_id text;

do $$
declare
  legacy_constraint text;
begin
  select constraint_row.conname into legacy_constraint
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.assessment_questions'::regclass
    and constraint_row.contype = 'u'
    and (
      select array_agg(attribute.attname order by key.ordinality)
      from unnest(constraint_row.conkey) with ordinality as key(attnum, ordinality)
      join pg_attribute attribute
        on attribute.attrelid = constraint_row.conrelid
       and attribute.attnum = key.attnum
    ) = array['assessment', 'display_order', 'content_version']::name[]
  limit 1;

  if legacy_constraint is not null then
    execute format('alter table public.assessment_questions drop constraint %I', legacy_constraint);
  end if;
end;
$$;


-- Discard the old global question bank; new lesson questions are written by the lesson publisher.
delete from public.assessment_questions where lesson_id is null;

-- Initialize lesson-scoped authoring without copying old global questions.
update public.lesson_catalog
set draft = jsonb_set(coalesce(draft, '{}'::jsonb), '{assessmentQuestions}',
  jsonb_build_object('pre-test', '[]'::jsonb, 'post-test', '[]'::jsonb), true)
where not (coalesce(draft, '{}'::jsonb) ? 'assessmentQuestions');

alter table public.assessment_questions alter column lesson_id set not null;
create unique index assessment_questions_lesson_order_unique
  on public.assessment_questions(lesson_id, assessment, content_version, display_order);
drop index if exists public.assessment_attempts_global_unique;
alter table public.assessment_attempts alter column lesson_id set not null;
alter table public.assessment_attempts alter column lesson_attempt_id set not null;
drop index if exists public.assessment_attempts_lesson_unique;
create unique index assessment_attempts_lesson_unique on public.assessment_attempts(lesson_attempt_id, assessment);
create or replace function public.validate_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare kind public.assessment_kind; questions jsonb; enabled boolean;
begin
  perform public.validate_chapter_authored_lesson(p);
  if p ? 'assessments' then
    if jsonb_typeof(p->'assessments') <> 'object'
      or (p#>>'{assessments,preTest}' is not null and p#>>'{assessments,preTest}' <> 'pre-test')
      or (p#>>'{assessments,postTest}' is not null and p#>>'{assessments,postTest}' <> 'post-test') then
      raise exception 'Invalid lesson assessment configuration.';
    end if;
  end if;
  if jsonb_typeof(p->'assessmentQuestions') is distinct from 'object' then
    raise exception 'Lesson Pre-test and Post-test questions must be stored with the lesson draft.';
  end if;
  foreach kind in array array['pre-test'::public.assessment_kind, 'post-test'::public.assessment_kind] loop
    enabled := case when kind = 'pre-test' then p#>>'{assessments,preTest}' = 'pre-test'
      else p#>>'{assessments,postTest}' = 'post-test' end;
    questions := p#>array['assessmentQuestions', kind::text];
    if jsonb_typeof(questions) is distinct from 'array' then
      if enabled then raise exception 'Add a question list for the lesson %.', kind; end if;
    else
      perform public.validate_admin_assessment_draft(
        kind, jsonb_build_object('assessment', kind::text, 'questions', questions)
      );
    end if;
  end loop;
end;
$$;
revoke all on function public.validate_authored_lesson(jsonb) from public, anon, authenticated;

create or replace function public.compile_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare
  kind public.assessment_kind;
  question jsonb;
  question_index integer;
  enabled boolean;
  versions jsonb := '{}'::jsonb;
begin
  perform public.validate_authored_lesson(p);
  perform public.compile_chapter_lesson(p, v);
  foreach kind in array array['pre-test'::public.assessment_kind, 'post-test'::public.assessment_kind] loop
    enabled := case when kind = 'pre-test' then p#>>'{assessments,preTest}' = 'pre-test'
      else p#>>'{assessments,postTest}' = 'post-test' end;
    if enabled then
      perform public.validate_publishable_assessment(
        kind,
        jsonb_build_object('assessment', kind::text, 'questions', p#>array['assessmentQuestions',kind::text])
      );
      question_index := 0;
      for question in select value from jsonb_array_elements(p#>array['assessmentQuestions',kind::text]) loop
        question_index := question_index + 1;
        insert into public.assessment_questions (
          id, assessment, display_order, prompt, choices, correct_choice_id,
          content_version, is_placeholder, lesson_id
        ) values (
          p->>'id' || ':' || kind::text || ':v' || v::text || ':' || (question->>'id'),
          kind, question_index,
          question->>'prompt', question->'choices', question->>'correctChoiceId',
          v, coalesce((question->>'isPlaceholder')::boolean, false), p->>'id'
        ) on conflict (id) do update set
          prompt = excluded.prompt, choices = excluded.choices,
          correct_choice_id = excluded.correct_choice_id,
          is_placeholder = excluded.is_placeholder;
      end loop;
      versions := versions || jsonb_build_object(
        case when kind = 'pre-test' then 'preTest' else 'postTest' end,
        kind::text
      );
    end if;
  end loop;
  update public.lesson_definitions
  set pre_assessment_version = case when versions ? 'preTest' then v else null end,
      post_assessment_version = case when versions ? 'postTest' then v else null end,
      presentation = presentation || jsonb_build_object('assessments', versions)
  where lesson_id = p->>'id' and content_version = v;
end;
$$;
revoke all on function public.compile_lesson(jsonb,integer) from public, anon, authenticated;

-- Fresh starts pin the lesson's question set; existing in-progress attempts
-- retain their prior global snapshot and remain resumable.
create or replace function public.start_lesson_attempt(p_lesson_id text)
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

drop function public.start_assessment(public.assessment_kind,uuid,uuid);
create function public.start_assessment(
  p_assessment public.assessment_kind,
  p_lesson_attempt_id uuid default null,
  p_client_attempt_id uuid default null
)
returns public.assessment_attempts
language plpgsql security definer set search_path = '' as $$
declare
  result public.assessment_attempts;
  lesson_attempt public.lesson_attempts;
  version integer;
  question_count integer;
  question_lesson_id text;
begin
  if p_lesson_attempt_id is null then raise exception 'Lesson attempt is required.'; end if;
  if (select auth.uid()) is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into lesson_attempt from public.lesson_attempts
  where id=p_lesson_attempt_id and user_id=(select auth.uid()) and status='active' for update;
  if lesson_attempt.id is null then raise exception 'Active lesson attempt not found.'; end if;
  select * into result from public.assessment_attempts
  where lesson_attempt_id=p_lesson_attempt_id and assessment=p_assessment;
  if result.id is not null then return result; end if;
  if (p_assessment='pre-test' and lesson_attempt.flow_stage <> 'pre-test')
    or (p_assessment='post-test' and lesson_attempt.flow_stage <> 'post-test') then
    raise exception 'This assessment is not the current lesson step.';
  end if;
  version := case when p_assessment='pre-test' then lesson_attempt.pre_assessment_version
    else lesson_attempt.post_assessment_version end;
  if version is null then raise exception 'This lesson does not include that assessment.'; end if;
  if p_client_attempt_id is not null and exists(select 1 from public.assessment_attempts where id=p_client_attempt_id) then
    raise exception 'Assessment attempt ID is already in use.';
  end if;
  question_lesson_id := lesson_attempt.lesson_id;
  select count(*) into question_count from public.assessment_questions
  where assessment=p_assessment and content_version=version
    and lesson_id = question_lesson_id;
  if question_count=0 then raise exception 'Assessment content is not available.'; end if;
  insert into public.assessment_attempts
    (id,user_id,assessment,content_version,expected_question_count,lesson_id,lesson_attempt_id)
  values (coalesce(p_client_attempt_id,gen_random_uuid()),(select auth.uid()),p_assessment,version,
    question_count,lesson_attempt.lesson_id,lesson_attempt.id)
  returning * into result;
  return result;
end;
$$;
revoke execute on function public.start_assessment(public.assessment_kind,uuid,uuid) from public,anon;
grant execute on function public.start_assessment(public.assessment_kind,uuid,uuid) to authenticated;

create or replace function public.get_assessment_questions(
  p_assessment public.assessment_kind,
  p_lesson_attempt_id uuid default null
)
returns table (id text, assessment public.assessment_kind, display_order integer, prompt text,
  choices jsonb, content_version integer, is_placeholder boolean)
language sql stable security definer set search_path = '' as $$
  select q.id,q.assessment,q.display_order,q.prompt,q.choices,q.content_version,q.is_placeholder
  from public.assessment_questions q
  where p_lesson_attempt_id is not null
    and q.assessment = p_assessment
    and q.content_version = coalesce(
      (select a.content_version from public.assessment_attempts a
       where a.user_id = (select auth.uid()) and a.assessment = p_assessment
         and a.lesson_attempt_id = p_lesson_attempt_id),
      (select case when p_assessment = 'pre-test' then l.pre_assessment_version else l.post_assessment_version end
       from public.lesson_attempts l where l.id = p_lesson_attempt_id and l.user_id = (select auth.uid()))
    )
    and q.lesson_id = (select l.lesson_id from public.lesson_attempts l
      where l.id = p_lesson_attempt_id and l.user_id = (select auth.uid()))
    and (select auth.uid()) is not null
    and not public.is_researcher() and not public.is_admin()
  order by q.display_order;
$$;

create or replace function public.get_assessment_attempt(
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
  from public.assessment_attempts a
  left join public.assessment_attempt_answers b on b.attempt_id = a.id
  where p_lesson_attempt_id is not null
    and a.user_id = (select auth.uid()) and a.assessment = p_assessment
    and a.lesson_attempt_id = p_lesson_attempt_id
    and not public.is_researcher() and not public.is_admin()
  group by a.id;
$$;
create or replace function public.submit_assessment_answer(
  p_attempt_id uuid, p_question_id text, p_choice_id text
)
returns table (attempt_id uuid, question_id text, selected_choice_id text, answered_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  current_attempt public.assessment_attempts;
  current_question public.assessment_questions;
  saved_answer public.assessment_attempt_answers;
  question_lesson_id text := null;
begin
  if (select auth.uid()) is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt from public.assessment_attempts
  where id=p_attempt_id and user_id=(select auth.uid()) for update;
  if current_attempt.id is null or current_attempt.status <> 'active' then
    raise exception 'Active assessment not found.';
  end if;
  if current_attempt.lesson_attempt_id is not null then
    select lesson_id into question_lesson_id
    from public.lesson_attempts where id=current_attempt.lesson_attempt_id and user_id=(select auth.uid());
  end if;
  select * into current_question from public.assessment_questions
  where id=p_question_id and assessment=current_attempt.assessment
    and content_version=current_attempt.content_version
    and lesson_id = question_lesson_id;
  if current_question.id is null then raise exception 'Question not found.'; end if;
  if not exists (select 1 from jsonb_array_elements(current_question.choices) choice where choice->>'id'=p_choice_id) then
    raise exception 'Choice not found.';
  end if;
  insert into public.assessment_attempt_answers(attempt_id,question_id,selected_choice_id,is_correct)
  values(p_attempt_id,p_question_id,p_choice_id,p_choice_id=current_question.correct_choice_id)
  on conflict on constraint assessment_attempt_answers_attempt_id_question_id_key do update
    set selected_choice_id=excluded.selected_choice_id,is_correct=excluded.is_correct,answered_at=now()
  returning * into saved_answer;
  return query select saved_answer.attempt_id,saved_answer.question_id,saved_answer.selected_choice_id,saved_answer.answered_at;
end;
$$;

create or replace function public.sync_assessment_draft(
  p_attempt_id uuid, p_base_revision bigint, p_revision bigint, p_mutation_id uuid, p_answers jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_attempt public.assessment_attempts;
  incoming jsonb;
  existing jsonb;
  question_lesson_id text := null;
begin
  if (select auth.uid()) is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt from public.assessment_attempts
    where id=p_attempt_id and user_id=(select auth.uid()) for update;
  if current_attempt.id is null or current_attempt.status <> 'active' then raise exception 'Active assessment not found.'; end if;
  if current_attempt.lesson_attempt_id is not null then
    select lesson_id into question_lesson_id
    from public.lesson_attempts where id=current_attempt.lesson_attempt_id and user_id=(select auth.uid());
  end if;
  if p_base_revision is null or p_revision is null or p_mutation_id is null
    or p_base_revision < 0 or p_revision <= p_base_revision or p_revision > 9007199254740991 then raise exception 'Invalid revision.'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then raise exception 'Invalid snapshot.'; end if;
  if jsonb_array_length(p_answers) > current_attempt.expected_question_count
    or exists (select 1 from jsonb_array_elements(p_answers) v
      where jsonb_typeof(v) <> 'object' or jsonb_typeof(v->'question_id') is distinct from 'string'
        or jsonb_typeof(v->'selected_choice_id') is distinct from 'string')
    or (select count(distinct v->>'question_id') from jsonb_array_elements(p_answers) v) <> jsonb_array_length(p_answers) then raise exception 'Invalid snapshot.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('question_id',v->>'question_id','selected_choice_id',v->>'selected_choice_id') order by v->>'question_id'),'[]'::jsonb)
    into incoming from jsonb_array_elements(p_answers) v;
  select coalesce(jsonb_agg(jsonb_build_object('question_id',a.question_id,'selected_choice_id',a.selected_choice_id) order by a.question_id),'[]'::jsonb)
    into existing from public.assessment_attempt_answers a where a.attempt_id=p_attempt_id;
  if current_attempt.accepted_revision=p_revision and current_attempt.accepted_mutation_id=p_mutation_id and incoming=existing then return; end if;
  if current_attempt.accepted_revision<>p_base_revision or p_revision<=current_attempt.accepted_revision then
    raise exception 'Assessment revision conflict.' using errcode='40001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_answers) v where not exists (
    select 1 from public.assessment_questions q where q.id=v->>'question_id'
      and q.assessment=current_attempt.assessment and q.content_version=current_attempt.content_version
      and q.lesson_id = question_lesson_id
      and exists(select 1 from jsonb_array_elements(q.choices) c where c->>'id'=v->>'selected_choice_id')
  )) then raise exception 'Invalid question or choice.'; end if;
  if exists (select 1 from public.assessment_attempt_answers a where a.attempt_id=p_attempt_id
    and not exists(select 1 from jsonb_array_elements(p_answers) v where v->>'question_id'=a.question_id)) then
    raise exception 'Snapshot omits accepted answers.';
  end if;
  insert into public.assessment_attempt_answers(attempt_id,question_id,selected_choice_id,is_correct)
    select p_attempt_id,q.id,v->>'selected_choice_id',(v->>'selected_choice_id')=q.correct_choice_id
    from jsonb_array_elements(p_answers) v join public.assessment_questions q on q.id=v->>'question_id'
    where q.assessment=current_attempt.assessment and q.content_version=current_attempt.content_version
      and q.lesson_id = question_lesson_id
    on conflict on constraint assessment_attempt_answers_attempt_id_question_id_key do update
      set selected_choice_id=excluded.selected_choice_id,is_correct=excluded.is_correct,answered_at=now();
  update public.assessment_attempts set accepted_revision=p_revision,accepted_mutation_id=p_mutation_id where id=p_attempt_id;
end;
$$;

drop function if exists public.get_researcher_results();
create function public.get_researcher_results()
returns table (
  participant_code text, username text, lessons_completed integer,
  lessons_available integer, latest_activity_at timestamptz, lesson_results jsonb
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_researcher() then
    raise exception 'Researcher access required.' using errcode = '42501';
  end if;
  return query
  with active_lessons as (
    select catalog.lesson_id from public.lesson_catalog catalog where catalog.published
  ),
  lesson_attempt_summary as (
    select attempt.user_id, attempt.lesson_id,
      (array_agg(attempt.final_score order by attempt.completed_at desc)
        filter (where attempt.status = 'completed' and attempt.final_score is not null))[1]::smallint as latest_score,
      coalesce(sum(attempt.active_seconds), 0)::integer as active_seconds
    from public.lesson_attempts attempt
    join active_lessons active on active.lesson_id = attempt.lesson_id
    group by attempt.user_id, attempt.lesson_id
  ),
  participant_lessons as (
    select progress.user_id,
      count(*) filter (where progress.status = 'cleared')::integer as lessons_completed,
      count(*)::integer as lessons_available,
      max(progress.last_attempted_at) as latest_activity_at,
      coalesce(jsonb_agg(jsonb_build_object(
        'lesson_id', progress.lesson_id, 'status', progress.status,
        'best_score', progress.best_score, 'latest_score', attempts.latest_score,
        'attempt_count', progress.attempt_count, 'completed_at', progress.cleared_at,
        'active_seconds', coalesce(attempts.active_seconds, 0)
      ) order by progress.lesson_id), '[]'::jsonb) as lesson_results
    from public.lesson_progress progress
    join active_lessons active on active.lesson_id = progress.lesson_id
    left join lesson_attempt_summary attempts
      on attempts.user_id = progress.user_id and attempts.lesson_id = progress.lesson_id
    group by progress.user_id
  )
  select 'ALT-' || upper(substr(md5(profile.user_id::text), 1, 8)), profile.username,
    coalesce(lessons.lessons_completed, 0), coalesce(lessons.lessons_available, 0),
    lessons.latest_activity_at, coalesce(lessons.lesson_results, '[]'::jsonb)
  from public.profiles profile
  left join participant_lessons lessons on lessons.user_id = profile.user_id
  where not exists (select 1 from public.researcher_users staff where staff.user_id = profile.user_id)
    and not exists (select 1 from public.admin_users staff where staff.user_id = profile.user_id)
  order by 1;
end;
$$;
revoke all on function public.get_researcher_results() from public, anon;
grant execute on function public.get_researcher_results() to authenticated;
create function public.get_researcher_lesson_assessment_results()
returns table (
  participant_code text, username text, lesson_id text, lesson_title text,
  pre_test_status text, pre_test_score smallint,
  post_test_status text, post_test_score smallint
)
language sql stable security definer set search_path = '' as $$
  with active_lessons as (
    select catalog.lesson_id, definition.presentation->>'title' as lesson_title
    from public.lesson_catalog catalog
    join public.lesson_definitions definition
      on (definition.lesson_id,definition.content_version)=(catalog.lesson_id,catalog.published_version)
    where catalog.published
  ),
  lesson_attempt_assessments as (
    select attempts.user_id, attempts.lesson_id,
      bool_or(attempts.assessment='pre-test' and attempts.status='active') as pre_active,
      bool_or(attempts.assessment='post-test' and attempts.status='active') as post_active,
      (array_agg(attempts.score order by attempts.submitted_at desc)
        filter(where attempts.assessment='pre-test' and attempts.status='submitted'))[1]::smallint as pre_score,
      (array_agg(attempts.score order by attempts.submitted_at desc)
        filter(where attempts.assessment='post-test' and attempts.status='submitted'))[1]::smallint as post_score
    from public.assessment_attempts attempts
    where attempts.lesson_attempt_id is not null and attempts.lesson_id is not null
    group by attempts.user_id,attempts.lesson_id
  )
  select 'ALT-' || upper(substr(md5(profile.user_id::text),1,8)), profile.username,
    lesson.lesson_id, lesson.lesson_title,
    case when result.pre_score is not null then 'completed' when result.pre_active then 'in_progress' else 'not_started' end,
    result.pre_score,
    case when result.post_score is not null then 'completed' when result.post_active then 'in_progress' else 'not_started' end,
    result.post_score
  from public.profiles profile
  cross join active_lessons lesson
  left join lesson_attempt_assessments result
    on result.user_id=profile.user_id and result.lesson_id=lesson.lesson_id
  where (select auth.uid()) is not null and public.is_researcher()
    and not exists(select 1 from public.researcher_users staff where staff.user_id=profile.user_id)
    and not exists(select 1 from public.admin_users staff where staff.user_id=profile.user_id)
  order by lesson.lesson_id,profile.username;
$$;
revoke all on function public.get_researcher_lesson_assessment_results() from public,anon;
grant execute on function public.get_researcher_lesson_assessment_results() to authenticated;

drop function if exists public.start_global_assessment(public.assessment_kind);
drop function if exists public.get_global_assessment_questions(public.assessment_kind);
drop function if exists public.get_global_assessment_attempt(public.assessment_kind);
drop function if exists public.get_admin_assessments();
drop function if exists public.save_admin_assessment(public.assessment_kind, jsonb, bigint);
drop function if exists public.publish_admin_assessment(public.assessment_kind, bigint);
drop function if exists public.admin_assessment_snapshot(public.assessment_kind);
drop table public.assessment_catalog;

commit;
