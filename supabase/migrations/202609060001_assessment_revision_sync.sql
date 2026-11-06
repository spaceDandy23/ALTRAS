-- Batch 2: logical snapshot revisions. Deploy with the revision-aware client.
-- Historical timestamps remain informational; they never arbitrate writes.
begin;
alter table public.assessment_attempts
  add column accepted_revision bigint not null default 0 check (accepted_revision between 0 and 9007199254740991),
  add column accepted_mutation_id uuid,
  add column submitted_revision bigint check (submitted_revision between 0 and 9007199254740991);
update public.assessment_attempts set submitted_revision = 0 where status = 'submitted';

drop function public.get_assessment_attempt(public.assessment_kind);
create function public.get_assessment_attempt(p_assessment public.assessment_kind)
returns table (
  id uuid, user_id uuid, assessment public.assessment_kind,
  status public.assessment_attempt_status, started_at timestamptz, submitted_at timestamptz,
  score smallint, completion_seconds integer, content_version integer,
  expected_question_count integer, accepted_revision bigint, accepted_mutation_id uuid,
  submitted_revision bigint, assessment_attempt_answers jsonb
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.user_id, a.assessment, a.status, a.started_at, a.submitted_at,
    a.score, a.completion_seconds, a.content_version, a.expected_question_count,
    a.accepted_revision, a.accepted_mutation_id, a.submitted_revision,
    coalesce(jsonb_agg(jsonb_build_object('question_id', b.question_id,
      'selected_choice_id', b.selected_choice_id, 'answered_at', b.answered_at)
      order by b.question_id) filter (where b.id is not null), '[]'::jsonb)
  from public.assessment_attempts a
  left join public.assessment_attempt_answers b on b.attempt_id = a.id
  where a.user_id = (select auth.uid()) and a.assessment = p_assessment and not public.is_researcher()
  group by a.id;
$$;

create function public.sync_assessment_draft(
  p_attempt_id uuid, p_base_revision bigint, p_revision bigint, p_mutation_id uuid, p_answers jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_attempt public.assessment_attempts;
  incoming jsonb;
  existing jsonb;
begin
  if (select auth.uid()) is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt from public.assessment_attempts
    where id = p_attempt_id and user_id = (select auth.uid()) for update;
  if current_attempt.id is null or current_attempt.status <> 'active' then
    raise exception 'Active assessment not found.';
  end if;
  if p_base_revision is null or p_revision is null or p_mutation_id is null
    or p_base_revision < 0 or p_revision <= p_base_revision or p_revision > 9007199254740991 then
    raise exception 'Invalid revision.';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then raise exception 'Invalid snapshot.'; end if;
  if jsonb_array_length(p_answers) > current_attempt.expected_question_count
    or exists (select 1 from jsonb_array_elements(p_answers) v
      where jsonb_typeof(v) <> 'object' or jsonb_typeof(v->'question_id') is distinct from 'string'
        or jsonb_typeof(v->'selected_choice_id') is distinct from 'string')
    or (select count(distinct v->>'question_id') from jsonb_array_elements(p_answers) v) <> jsonb_array_length(p_answers) then
    raise exception 'Invalid snapshot.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('question_id', v->>'question_id',
    'selected_choice_id', v->>'selected_choice_id') order by v->>'question_id'), '[]'::jsonb)
    into incoming from jsonb_array_elements(p_answers) v;
  select coalesce(jsonb_agg(jsonb_build_object('question_id', a.question_id,
    'selected_choice_id', a.selected_choice_id) order by a.question_id), '[]'::jsonb)
    into existing from public.assessment_attempt_answers a where a.attempt_id = p_attempt_id;
  -- Exact retry is idempotent. A reused revision/token with different data is not.
  if current_attempt.accepted_revision = p_revision and current_attempt.accepted_mutation_id = p_mutation_id and incoming = existing then return; end if;
  if current_attempt.accepted_revision <> p_base_revision or p_revision <= current_attempt.accepted_revision then
    raise exception 'Assessment revision conflict.' using errcode = '40001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_answers) v where not exists (
    select 1 from public.assessment_questions q where q.id = v->>'question_id'
      and q.assessment = current_attempt.assessment and q.content_version = current_attempt.content_version
      and exists (select 1 from jsonb_array_elements(q.choices) c where c->>'id' = v->>'selected_choice_id')
  )) then raise exception 'Invalid question or choice.'; end if;
  -- A complete snapshot cannot silently discard a previously accepted answer.
  if exists (select 1 from public.assessment_attempt_answers a where a.attempt_id = p_attempt_id
    and not exists (select 1 from jsonb_array_elements(p_answers) v where v->>'question_id' = a.question_id)) then
    raise exception 'Snapshot omits accepted answers.';
  end if;
  insert into public.assessment_attempt_answers (attempt_id, question_id, selected_choice_id, is_correct)
    select p_attempt_id, q.id, v->>'selected_choice_id', (v->>'selected_choice_id') = q.correct_choice_id
    from jsonb_array_elements(p_answers) v join public.assessment_questions q on q.id = v->>'question_id'
    where q.assessment = current_attempt.assessment and q.content_version = current_attempt.content_version
    on conflict on constraint assessment_attempt_answers_attempt_id_question_id_key do update
      set selected_choice_id = excluded.selected_choice_id, is_correct = excluded.is_correct, answered_at = now();
  update public.assessment_attempts set accepted_revision = p_revision, accepted_mutation_id = p_mutation_id
    where id = p_attempt_id;
end;
$$;

create function public.complete_assessment_revision(p_attempt_id uuid, p_revision bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare current_attempt public.assessment_attempts;
begin
  if (select auth.uid()) is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into current_attempt from public.assessment_attempts
    where id = p_attempt_id and user_id = (select auth.uid()) for update;
  if current_attempt.id is null then raise exception 'Assessment not found.'; end if;
  if p_revision is null or current_attempt.accepted_revision <> p_revision then
    raise exception 'Assessment revision conflict.' using errcode = '40001';
  end if;
  if current_attempt.status = 'submitted' then return; end if;
  -- Existing server-owned scoring, under the SAME attempt lock as snapshot writes.
  perform public.complete_assessment(p_attempt_id);
  update public.assessment_attempts set submitted_revision = p_revision where id = p_attempt_id;
end;
$$;

-- Resume pinned content, not a newly published version of the question set.
create or replace function public.get_assessment_questions(p_assessment public.assessment_kind)
returns table (id text, assessment public.assessment_kind, display_order integer, prompt text,
  choices jsonb, content_version integer, is_placeholder boolean)
language sql stable security definer set search_path = '' as $$
  select q.id, q.assessment, q.display_order, q.prompt, q.choices, q.content_version, q.is_placeholder
  from public.assessment_questions q where q.assessment = p_assessment
    and q.content_version = coalesce(
      (select a.content_version from public.assessment_attempts a where a.user_id = (select auth.uid()) and a.assessment = p_assessment),
      (select max(v.content_version) from public.assessment_questions v where v.assessment = p_assessment))
    and (select auth.uid()) is not null and not public.is_researcher()
  order by q.display_order;
$$;

-- Old clients must not bypass the revision contract. The legacy completion
-- function remains callable by the SECURITY DEFINER wrapper, not API users.
revoke execute on function public.submit_assessment_answer(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.complete_assessment(uuid) from public, anon, authenticated;
revoke execute on function public.get_assessment_attempt(public.assessment_kind) from public, anon;
revoke execute on function public.sync_assessment_draft(uuid, bigint, bigint, uuid, jsonb) from public, anon;
revoke execute on function public.complete_assessment_revision(uuid, bigint) from public, anon;
grant execute on function public.get_assessment_attempt(public.assessment_kind) to authenticated;
grant execute on function public.sync_assessment_draft(uuid, bigint, bigint, uuid, jsonb) to authenticated;
grant execute on function public.complete_assessment_revision(uuid, bigint) to authenticated;
commit;
