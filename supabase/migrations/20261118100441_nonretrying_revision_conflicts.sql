-- Deterministic revision conflicts must not trigger PostgREST 14 transaction retries.
-- CREATE OR REPLACE preserves the existing function grants and ownership.

CREATE OR REPLACE FUNCTION public.complete_assessment_revision(p_attempt_id uuid, p_revision bigint, p_answering_seconds integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_attempt public.assessment_attempts;
begin
  if (select auth.uid()) is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt from public.assessment_attempts
  where id = p_attempt_id and user_id = (select auth.uid()) for update;
  if current_attempt.id is null then raise exception 'Assessment not found.'; end if;
  if current_attempt.status = 'submitted' then return; end if;
  if p_revision is null or current_attempt.accepted_revision <> p_revision then
    raise exception 'Assessment revision conflict.' using errcode = 'P0001';
  end if;
  if p_answering_seconds is null or p_answering_seconds < 0 or p_answering_seconds > 86400 then
    raise exception 'Invalid assessment answering time.';
  end if;

  update public.assessment_attempts
  set answering_seconds = p_answering_seconds
  where id = p_attempt_id;

  perform public.complete_assessment_revision(p_attempt_id, p_revision);
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_assessment_revision(p_attempt_id uuid, p_revision bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_attempt public.assessment_attempts;
begin
  if (select auth.uid()) is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt from public.assessment_attempts
    where id = p_attempt_id and user_id = (select auth.uid()) for update;
  if current_attempt.id is null then raise exception 'Assessment not found.'; end if;
  if p_revision is null or current_attempt.accepted_revision <> p_revision then
    raise exception 'Assessment revision conflict.' using errcode = 'P0001';
  end if;
  if current_attempt.status = 'submitted' then return; end if;
  -- Existing server-owned scoring, under the SAME attempt lock as snapshot writes.
  perform public.complete_assessment(p_attempt_id);
  update public.assessment_attempts set submitted_revision = p_revision where id = p_attempt_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_admin_lesson(p_lesson jsonb, p_revision bigint)
 RETURNS lesson_catalog
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare existing public.lesson_catalog; result public.lesson_catalog; prereq text; path text[]; cursor_id text;
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;

  -- Reject malformed input and revisions that are already stale before joining
  -- the global authoring lock queue.
  if p_lesson is null or jsonb_typeof(p_lesson) <> 'object' or length(p_lesson::text) > 100000 then raise exception 'Invalid or oversized lesson.'; end if;
  if coalesce(p_lesson->>'id','') !~ '^[a-z0-9-]{3,80}$' or coalesce(length(btrim(p_lesson->>'title')),0) = 0 then raise exception 'Lesson ID and title are required.'; end if;
  if coalesce(p_lesson->>'displayOrder','') !~ '^[0-9]{1,5}$' or (p_lesson->>'displayOrder')::integer < 1 then raise exception 'Lesson order must be a positive integer.'; end if;
  if jsonb_typeof(p_lesson->'activities') is distinct from 'array' then raise exception 'Activities must be an array.'; end if;
  if jsonb_array_length(p_lesson->'activities') > 10 then raise exception 'A lesson supports at most 10 activities.'; end if;
  select * into existing from public.lesson_catalog where lesson_id = p_lesson->>'id';
  if (existing.lesson_id is null and p_revision is distinct from 0) or (existing.lesson_id is not null and p_revision is distinct from existing.revision) then
    raise exception 'This lesson changed in another session. Reload before saving.' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(20260912, 2);

  -- Another save can win the lock after the precheck, so re-read and enforce
  -- optimistic concurrency while holding the same lock used by publication.
  select * into existing from public.lesson_catalog where lesson_id = p_lesson->>'id' for update;
  if (existing.lesson_id is null and p_revision is distinct from 0) or (existing.lesson_id is not null and p_revision is distinct from existing.revision) then
    raise exception 'This lesson changed in another session. Reload before saving.' using errcode = 'P0001'; end if;

  prereq := nullif(p_lesson->>'prerequisiteLessonId','');
  path := array[p_lesson->>'id']; cursor_id := prereq;
  while cursor_id is not null loop
    if cursor_id = any(path) then raise exception 'Prerequisites cannot contain a cycle or the lesson itself.'; end if;
    path := array_append(path,cursor_id);
    if not exists(select 1 from public.lesson_catalog where lesson_id = cursor_id) then raise exception 'Prerequisite lesson does not exist.'; end if;
    select nullif(draft->>'prerequisiteLessonId','') into cursor_id from public.lesson_catalog where lesson_id = cursor_id;
  end loop;
  insert into public.lesson_catalog(lesson_id,draft) values(p_lesson->>'id',p_lesson)
    on conflict(lesson_id) do update set draft = excluded.draft, revision = public.lesson_catalog.revision + 1, updated_at = now()
    returning * into result;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_lesson_publication(p_lesson_id text, p_publish boolean, p_revision bigint)
 RETURNS lesson_catalog
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  item public.lesson_catalog;
  result public.lesson_catalog;
  v integer;
  prereq text;
  current_prereq text;
  cursor_id text;
  path text[];
  conflicting_title text;
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(20260912, 2);
  select * into item from public.lesson_catalog where lesson_id = p_lesson_id for update;
  if item.lesson_id is null or p_publish is null then raise exception 'Lesson not found.'; end if;
  if p_revision is distinct from item.revision then raise exception 'This lesson changed in another session. Reload before publishing.' using errcode = 'P0001'; end if;
  if not p_publish then
    if exists(select 1 from public.lesson_catalog c join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
      where c.published and d.prerequisite_lesson_id = p_lesson_id) then raise exception 'Unpublish dependent lessons first.'; end if;
  else
    perform public.validate_authored_lesson(item.draft);
    prereq := nullif(item.draft->>'prerequisiteLessonId','');
    path := array[p_lesson_id]; cursor_id := prereq;
    while cursor_id is not null loop
      if cursor_id = any(path) then raise exception 'Prerequisites cannot contain a cycle.'; end if;
      path := array_append(path,cursor_id);
      if not exists(select 1 from public.lesson_catalog where lesson_id=cursor_id and published) then raise exception 'Publish the prerequisite first.'; end if;
      select d.prerequisite_lesson_id into cursor_id from public.lesson_catalog c join public.lesson_definitions d
        on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version) where c.lesson_id=cursor_id;
    end loop;
    select d.presentation->>'title' into conflicting_title
    from public.lesson_catalog c
    join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
    where c.published
      and c.lesson_id <> p_lesson_id
      and (d.presentation->>'displayOrder')::integer = (item.draft->>'displayOrder')::integer
    order by c.lesson_id
    limit 1;
    if conflicting_title is not null then
      raise exception 'Lesson order % is already used by "%".', (item.draft->>'displayOrder')::integer, conflicting_title;
    end if;
    if exists(select 1 from public.lesson_catalog c join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
      where c.published and ((c.lesson_id=prereq and (d.presentation->>'displayOrder')::integer >= (item.draft->>'displayOrder')::integer)
      or (d.prerequisite_lesson_id=p_lesson_id and (d.presentation->>'displayOrder')::integer <= (item.draft->>'displayOrder')::integer))) then raise exception 'Prerequisites must appear before their dependent lessons.'; end if;
    select prerequisite_lesson_id into current_prereq from public.lesson_definitions where lesson_id=p_lesson_id and content_version=item.published_version;
    if current_prereq is distinct from prereq and exists(select 1 from public.lesson_attempts where lesson_id=p_lesson_id) then raise exception 'Cannot change the prerequisite after students have started this lesson.'; end if;
    select coalesce(max(content_version),0)+1 into v from public.lesson_definitions where lesson_id=p_lesson_id;
    perform public.compile_lesson(item.draft,v);
  end if;
  update public.lesson_catalog set published=p_publish, published_version=case when p_publish then v else published_version end,
    revision=revision+1, updated_at=now() where lesson_id=p_lesson_id returning * into result;
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_assessment_draft(p_attempt_id uuid, p_base_revision bigint, p_revision bigint, p_mutation_id uuid, p_answers jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'Assessment revision conflict.' using errcode = 'P0001';
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
$function$;

