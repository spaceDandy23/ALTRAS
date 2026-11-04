-- Add a choice-based algebra translation exercise to the existing activity engine.
-- Choice identifiers and correctness remain private in lesson_activity_keys.
begin;
alter table public.lesson_activity_keys
  drop constraint lesson_activity_keys_activity_type_check;
alter table public.lesson_activity_keys
  add constraint lesson_activity_keys_activity_type_check
  check (activity_type in ('find-word', 'organize-translate', 'choose-correct-translation'));

create or replace function public.validate_legacy_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare a jsonb; o jsonb; ids text[]; field text; choices jsonb; choice_based boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Invalid lesson.'; end if;
  foreach field in array array['id','title','shortDescription','sectionId','unitId'] loop
    if jsonb_typeof(p->field) is distinct from 'string' or length(btrim(p->>field)) = 0
      or length(p->>field) > 2000 then raise exception 'Lesson % is required (maximum 2000 characters).', field; end if;
  end loop;
  if p->>'id' !~ '^[a-z0-9-]{3,80}$'
    or p->>'sectionId' <> 'section-translating-verbal-expressions'
    or p->>'unitId' <> 'unit-operation-words' then raise exception 'Invalid lesson identity or unit.'; end if;
  if jsonb_typeof(p->'displayOrder') is distinct from 'number' or coalesce(p->>'displayOrder','') !~ '^[0-9]{1,5}$' or (p->>'displayOrder')::integer < 1 then
    raise exception 'Lesson order must be a positive integer.'; end if;
  if jsonb_typeof(p->'passingThreshold') is distinct from 'number' or coalesce(p->>'passingThreshold','') !~ '^[0-9]{1,3}$' or (p->>'passingThreshold')::integer > 100 then
    raise exception 'Passing score must be from 0 to 100.'; end if;
  if jsonb_typeof(p->'activities') is distinct from 'array' then raise exception 'Activities must be an array.'; end if;
  if jsonb_array_length(p->'activities') not between 1 and 10 then raise exception 'A published lesson requires 1 to 10 activities.'; end if;
  if jsonb_typeof(p->'instructionalContent') is distinct from 'array'
    or jsonb_typeof(p->'concepts') is distinct from 'array' or jsonb_array_length(p->'concepts') = 0 then
    raise exception 'Invalid lesson instructions or concepts.'; end if;
  if exists(select 1 from jsonb_array_elements(p->'concepts') c where jsonb_typeof(c) <> 'string' or length(btrim(c#>>'{}')) = 0) then
    raise exception 'Concepts must contain text.'; end if;
  if p ? 'prerequisiteLessonId' and (jsonb_typeof(p->'prerequisiteLessonId') is distinct from 'string' or coalesce(p->>'prerequisiteLessonId','') !~ '^[a-z0-9-]{3,80}$') then
    raise exception 'Invalid prerequisite ID.'; end if;
  if p ? 'characterId' and (jsonb_typeof(p->'characterId') is distinct from 'string' or length(btrim(p->>'characterId')) = 0) then
    raise exception 'Invalid character ID.'; end if;
  for o in select value from jsonb_array_elements(jsonb_build_array(p) || (p->'activities')) loop
    if o ? 'characterDialogue' then
      if jsonb_typeof(o->'characterDialogue') is distinct from 'object' then raise exception 'Invalid character dialogue.'; end if;
      if exists(select 1 from jsonb_each(o->'characterDialogue') d where jsonb_typeof(d.value) <> 'string' or length(btrim(d.value#>>'{}')) = 0) then
        raise exception 'Character dialogue must contain text.'; end if;
    end if;
  end loop;
  ids := array[]::text[];
  for a in select value from jsonb_array_elements(p->'instructionalContent') loop
    if coalesce(a->>'type','') not in ('paragraph','example','warning') then raise exception 'Invalid instruction type.'; end if;
    foreach field in array case when a->>'type' = 'example' then array['id','phrase','expression','note'] else array['id','title','body'] end loop
      if jsonb_typeof(a->field) is distinct from 'string' or length(btrim(a->>field)) = 0 then raise exception 'Instruction % is required.', field; end if;
    end loop;
    if a->>'id' = any(ids) then raise exception 'Content IDs must be unique.'; end if;
    ids := array_append(ids, a->>'id');
  end loop;
  for a in select value from jsonb_array_elements(p->'activities') loop
    if coalesce(a->>'type','') not in ('find-word','organize-translate','choose-correct-translation') then raise exception 'Unsupported activity type.'; end if;
    foreach field in array case when a->>'type' = 'choose-correct-translation'
      then array['id','title','prompt'] else array['id','title','prompt','mathStatement'] end loop
      if jsonb_typeof(a->field) is distinct from 'string' or length(btrim(a->>field)) = 0 or length(a->>field) > 2000 then
        raise exception 'Activity % is required (maximum 2000 characters).', field; end if;
    end loop;
    if a->>'id' = any(ids) then raise exception 'Content IDs must be unique.'; end if;
    ids := array_append(ids, a->>'id');
    if jsonb_typeof(a#>'{explanation,title}') is distinct from 'string' or jsonb_typeof(a#>'{explanation,body}') is distinct from 'string'
      or coalesce(length(btrim(a#>>'{explanation,title}')),0) = 0 or coalesce(length(btrim(a#>>'{explanation,body}')),0) = 0 then
      raise exception 'Feedback title and explanation are required.'; end if;
    if a ? 'hint' and (jsonb_typeof(a#>'{hint,body}') is distinct from 'string' or coalesce(length(btrim(a#>>'{hint,body}')),0) = 0) then raise exception 'Hint must contain text.'; end if;
    choice_based := a->>'type' in ('find-word','choose-correct-translation');
    choices := case when choice_based then a->'choices' else a->'tokens' end;
    if jsonb_typeof(choices) is distinct from 'array' then raise exception 'Choices or tokens are required.'; end if;
    if jsonb_array_length(choices) not between 2 and 20 then raise exception 'Use 2 to 20 choices or tokens.'; end if;
    for o in select value from jsonb_array_elements(choices) loop
      if jsonb_typeof(o->'id') is distinct from 'string' or coalesce(length(btrim(o->>'id')),0) = 0
        or jsonb_typeof(o->'label') is distinct from 'string' or coalesce(length(btrim(o->>'label')),0) = 0 then raise exception 'Each choice/token needs an ID and label.'; end if;
    end loop;
    if (select count(distinct value->>'id') from jsonb_array_elements(choices)) <> jsonb_array_length(choices) then raise exception 'Choice/token IDs must be unique.'; end if;
    if a->>'type' = 'find-word' then
      if jsonb_typeof(a->'sentenceBefore') is distinct from 'string' or jsonb_typeof(a->'sentenceAfter') is distinct from 'string'
        or jsonb_typeof(a->'correctChoiceId') is distinct from 'string'
        or not exists(select 1 from jsonb_array_elements(choices) c where c->>'id' = a->>'correctChoiceId') then raise exception 'Choose a valid correct answer and sentence.'; end if;
    elsif a->>'type' = 'choose-correct-translation' then
      if jsonb_typeof(a->'correctChoiceId') is distinct from 'string'
        or not exists(select 1 from jsonb_array_elements(choices) c where c->>'id' = a->>'correctChoiceId') then raise exception 'Choose a valid correct answer.'; end if;
    else
      if jsonb_typeof(a->'correctTokenSequence') is distinct from 'array' then raise exception 'Correct token order is required.'; end if;
      if jsonb_array_length(a->'correctTokenSequence') <> jsonb_array_length(choices)
        or (select count(distinct value) from jsonb_array_elements(a->'correctTokenSequence')) <> jsonb_array_length(choices)
        or exists(select 1 from jsonb_array_elements(a->'correctTokenSequence') s where jsonb_typeof(s) <> 'string'
          or not exists(select 1 from jsonb_array_elements(choices) c where c->>'id' = s#>>'{}')) then raise exception 'Correct order must use every token exactly once.'; end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.validate_legacy_authored_lesson(jsonb) from public, anon, authenticated;

-- Preserve the lesson-scoped assessment checks added by the current authoring layer.
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

create or replace function public.compile_legacy_lesson(p jsonb, v integer) returns void language plpgsql set search_path = '' as $$
declare a jsonb; safe_activity jsonb; safe_activities jsonb := '[]'; presentation jsonb; choice_based boolean;
begin
  perform public.validate_authored_lesson(p);
  for a in select value from jsonb_array_elements(p->'activities') loop
    choice_based := a->>'type' in ('find-word','choose-correct-translation');
    select jsonb_object_agg(key,value) into safe_activity from jsonb_each(a)
      where key in ('id','type','title','prompt','mathStatement','sentenceBefore','sentenceAfter');
    safe_activity := safe_activity || jsonb_build_object(
      case when choice_based then 'choices' else 'tokens' end,
      (select jsonb_agg(public.lesson_public_fields(value,array['id','label'])) from jsonb_array_elements(
        case when choice_based then a->'choices' else a->'tokens' end))
    ) || case when a ? 'hint' then jsonb_build_object('hint',public.lesson_public_fields(a->'hint',array['body'])) else '{}'::jsonb end;
    safe_activities := safe_activities || jsonb_build_array(
      safe_activity
      || jsonb_build_object('explanation', jsonb_build_object('title','Answer feedback','body','Submit your answer to see the explanation.'))
      || case when a ? 'characterDialogue' then jsonb_build_object('characterDialogue', public.lesson_public_fields(a->'characterDialogue',array['introduction','hint','encouragement'])) else '{}'::jsonb end
    );
  end loop;
  select jsonb_object_agg(key,value) into presentation from jsonb_each(p)
    where key in ('id','title','shortDescription','sectionId','unitId','concepts','displayOrder','prerequisiteLessonId','characterId');
  presentation := presentation || jsonb_build_object('instructionalContent',
    coalesce((select jsonb_agg(public.lesson_public_fields(value,
      case when value->>'type'='example' then array['id','type','phrase','expression','note'] else array['id','type','title','body'] end))
      from jsonb_array_elements(p->'instructionalContent')),'[]'::jsonb))
    || case when p ? 'characterDialogue' then jsonb_build_object('characterDialogue',public.lesson_public_fields(p->'characterDialogue',array['introduction','completion'])) else '{}'::jsonb end;
  presentation := presentation || jsonb_build_object('activities',safe_activities,'contentVersion',v,'contentStatus','playable','passingThreshold',(p->>'passingThreshold')::integer);
  insert into public.lesson_definitions (lesson_id,content_version,expected_activity_count,passing_threshold,prerequisite_lesson_id,presentation)
  values(p->>'id',v,jsonb_array_length(p->'activities'),(p->>'passingThreshold')::integer,nullif(p->>'prerequisiteLessonId',''),presentation)
  on conflict(lesson_id,content_version) do update set presentation = excluded.presentation;
  for a in select value from jsonb_array_elements(p->'activities') loop
    choice_based := a->>'type' in ('find-word','choose-correct-translation');
    insert into public.lesson_activity_keys (lesson_id,content_version,activity_id,activity_type,answer_options,correct_answer,feedback)
    values(p->>'id',v,a->>'id',a->>'type',
      (select jsonb_agg(c->'id') from jsonb_array_elements(case when choice_based then a->'choices' else a->'tokens' end) c),
      case when choice_based then a->'correctChoiceId' else a->'correctTokenSequence' end,
      jsonb_build_object('explanation',a->'explanation') || case when a ? 'characterDialogue' then jsonb_build_object('characterDialogue',a->'characterDialogue') else '{}'::jsonb end
    ) on conflict(lesson_id,content_version,activity_id) do update set feedback = excluded.feedback;
  end loop;
end;
$$;
revoke all on function public.compile_legacy_lesson(jsonb,integer) from public, anon, authenticated;

-- Retain the current per-lesson assessment publishing flow around the updated chapter compiler.
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

create or replace function public.get_lesson_content(p_lesson_id text, p_attempt_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; doc jsonb; activities jsonb := '[]'; a jsonb; response jsonb; answer jsonb;
begin
  if (select auth.uid()) is null or public.is_researcher() then raise exception 'Student access required.' using errcode='42501'; end if;
  if p_attempt_id is not null then
    select content_version into v from public.lesson_attempts where id=p_attempt_id and lesson_id=p_lesson_id and user_id=(select auth.uid());
  else
    select published_version into v from public.lesson_catalog where lesson_id=p_lesson_id and published;
  end if;
  select presentation into doc from public.lesson_definitions where lesson_id=p_lesson_id and content_version=v;
  if doc is null then raise exception 'This lesson is unavailable.'; end if;
  for a in select value from jsonb_array_elements(doc->'activities') loop
    if p_attempt_id is not null and exists(select 1 from public.attempt_answers where attempt_id=p_attempt_id and activity_id=a->>'id') then
      select feedback,correct_answer into response,answer from public.lesson_activity_keys where lesson_id=p_lesson_id and content_version=v and activity_id=a->>'id';
      a := a || response;
      if a->>'type' in ('find-word','choose-correct-translation') then a := a || jsonb_build_object('correctChoiceId',answer); end if;
    end if;
    activities := activities || jsonb_build_array(a);
  end loop;
  return doc || jsonb_build_object('activities',activities);
end;
$$;

-- The chapter-runtime wrapper still performs stage/order checks, then delegates here.
create or replace function public.submit_legacy_lesson_activity_answer(
  p_attempt_id uuid,
  p_activity_id text,
  p_submitted_answer jsonb
)
returns public.attempt_answers
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  attempt public.lesson_attempts;
  activity public.lesson_activity_keys;
  result public.attempt_answers;
  answer_is_valid boolean := false;
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  select * into attempt from public.lesson_attempts
  where id = p_attempt_id and user_id = caller_id
  for update;
  if attempt.id is null or attempt.status <> 'active' then
    raise exception 'Active attempt not found.';
  end if;

  select * into activity from public.lesson_activity_keys
  where lesson_id = attempt.lesson_id
    and content_version = attempt.content_version
    and activity_id = p_activity_id;
  if activity.activity_id is null then raise exception 'Activity not found.'; end if;

  if activity.activity_type in ('find-word', 'choose-correct-translation')
    and jsonb_typeof(p_submitted_answer) = 'string' then
    select exists (
      select 1 from jsonb_array_elements(activity.answer_options) option
      where option = p_submitted_answer
    ) into answer_is_valid;
  elsif activity.activity_type = 'organize-translate'
    and jsonb_typeof(p_submitted_answer) = 'array'
    and jsonb_array_length(p_submitted_answer) = jsonb_array_length(activity.answer_options) then
    select count(*) = jsonb_array_length(p_submitted_answer)
      and count(distinct answer.value) = jsonb_array_length(p_submitted_answer)
      and coalesce(bool_and(activity.answer_options ? answer.value), false)
    into answer_is_valid
    from jsonb_array_elements_text(p_submitted_answer) answer(value);
  end if;
  if not answer_is_valid then raise exception 'Invalid activity answer.'; end if;

  insert into public.attempt_answers
    (attempt_id, activity_id, activity_type, submitted_answer, is_correct)
  values (
    attempt.id, activity.activity_id, activity.activity_type,
    p_submitted_answer, p_submitted_answer = activity.correct_answer
  )
  on conflict (attempt_id, activity_id) do nothing
  returning * into result;

  if result.id is null then
    select * into result from public.attempt_answers
    where attempt_id = attempt.id and activity_id = activity.activity_id;
  end if;
  return result;
end;
$$;

commit;
