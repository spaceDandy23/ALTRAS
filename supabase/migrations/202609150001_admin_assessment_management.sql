-- Admin assessment authoring with immutable published versions.
begin;

create table public.assessment_catalog (
  assessment public.assessment_kind primary key,
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  published_version integer not null check (published_version > 0),
  updated_at timestamptz not null default now()
);

alter table public.assessment_catalog enable row level security;
revoke all on public.assessment_catalog from public, anon, authenticated;

insert into public.assessment_catalog (assessment, draft, published_version)
select versions.assessment,
  jsonb_build_object(
    'assessment', versions.assessment,
    'questions', jsonb_agg(
      jsonb_build_object(
        'id', questions.id,
        'prompt', questions.prompt,
        'choices', questions.choices,
        'correctChoiceId', questions.correct_choice_id,
        'isPlaceholder', questions.is_placeholder
      ) order by questions.display_order
    )
  ),
  versions.content_version
from (
  select assessment, max(content_version) as content_version
  from public.assessment_questions
  group by assessment
) versions
join public.assessment_questions questions
  on questions.assessment = versions.assessment
 and questions.content_version = versions.content_version
group by versions.assessment, versions.content_version;

create function public.validate_admin_assessment_draft(
  p_assessment public.assessment_kind,
  p_draft jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  question_count integer;
begin
  if p_draft is null or jsonb_typeof(p_draft) <> 'object'
    or p_draft ->> 'assessment' is distinct from p_assessment::text
    or jsonb_typeof(p_draft -> 'questions') is distinct from 'array' then
    raise exception 'Invalid assessment draft.';
  end if;
  question_count := jsonb_array_length(p_draft -> 'questions');
  if question_count > 100 then
    raise exception 'An assessment supports at most 100 questions.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_draft -> 'questions') question
    where jsonb_typeof(question) <> 'object'
      or nullif(btrim(question ->> 'id'), '') is null
  ) or (
    select count(distinct question ->> 'id')
    from jsonb_array_elements(p_draft -> 'questions') question
  ) <> question_count then
    raise exception 'Every draft question requires a unique identifier.';
  end if;
end;
$$;

create function public.validate_publishable_assessment(
  p_assessment public.assessment_kind,
  p_draft jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  question jsonb;
  choices jsonb;
  choice_count integer;
begin
  perform public.validate_admin_assessment_draft(p_assessment, p_draft);
  if jsonb_array_length(p_draft -> 'questions') = 0 then
    raise exception 'Add at least one question before publishing.';
  end if;
  for question in select value from jsonb_array_elements(p_draft -> 'questions') loop
    if char_length(btrim(coalesce(question ->> 'prompt', ''))) not between 1 and 2000 then
      raise exception 'Every question requires valid question text.';
    end if;
    choices := question -> 'choices';
    if jsonb_typeof(choices) is distinct from 'array' then
      raise exception 'Every question requires answer choices.';
    end if;
    choice_count := jsonb_array_length(choices);
    if choice_count not between 2 and 10 then
      raise exception 'Every question requires 2 to 10 answer choices.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(choices) choice
      where jsonb_typeof(choice) <> 'object'
        or nullif(btrim(choice ->> 'id'), '') is null
        or char_length(btrim(coalesce(choice ->> 'label', ''))) not between 1 and 1000
    ) or (
      select count(distinct choice ->> 'id') from jsonb_array_elements(choices) choice
    ) <> choice_count then
      raise exception 'Answer choices require unique identifiers and valid labels.';
    end if;
    if (
      select count(*) from jsonb_array_elements(choices) choice
      where choice ->> 'id' = question ->> 'correctChoiceId'
    ) <> 1 then
      raise exception 'Select exactly one valid correct answer for every question.';
    end if;
    if question ? 'isPlaceholder'
      and jsonb_typeof(question -> 'isPlaceholder') <> 'boolean' then
      raise exception 'Invalid placeholder state.';
    end if;
  end loop;
end;
$$;

create function public.admin_assessment_snapshot(p_assessment public.assessment_kind)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'assessment', catalog.assessment,
    'draft', catalog.draft,
    'revision', catalog.revision,
    'published_version', catalog.published_version,
    'published_attempt_count', (
      select count(*) from public.assessment_attempts attempt
      where attempt.assessment = catalog.assessment
        and attempt.content_version = catalog.published_version
    ),
    'updated_at', catalog.updated_at
  )
  from public.assessment_catalog catalog
  where catalog.assessment = p_assessment;
$$;

create function public.get_admin_assessments()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(public.admin_assessment_snapshot(catalog.assessment)
    order by catalog.assessment), '[]'::jsonb)
  into result from public.assessment_catalog catalog;
  return result;
end;
$$;

create function public.save_admin_assessment(
  p_assessment public.assessment_kind,
  p_draft jsonb,
  p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare current_revision bigint;
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  perform public.validate_admin_assessment_draft(p_assessment, p_draft);
  select revision into current_revision from public.assessment_catalog
  where assessment = p_assessment for update;
  if current_revision is null then raise exception 'Assessment not found.'; end if;
  if p_revision is null or p_revision <> current_revision then
    raise exception 'This assessment changed in another session. Reload before saving.'
      using errcode = '40001';
  end if;
  update public.assessment_catalog
  set draft = p_draft, revision = revision + 1, updated_at = now()
  where assessment = p_assessment;
  return public.admin_assessment_snapshot(p_assessment);
end;
$$;

create function public.publish_admin_assessment(
  p_assessment public.assessment_kind,
  p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  catalog public.assessment_catalog;
  next_version integer;
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  select * into catalog from public.assessment_catalog
  where assessment = p_assessment for update;
  if catalog.assessment is null then raise exception 'Assessment not found.'; end if;
  if p_revision is null or p_revision <> catalog.revision then
    raise exception 'This assessment changed in another session. Reload before publishing.'
      using errcode = '40001';
  end if;
  perform public.validate_publishable_assessment(p_assessment, catalog.draft);
  select coalesce(max(content_version), 0) + 1 into next_version
  from public.assessment_questions where assessment = p_assessment;

  insert into public.assessment_questions
    (id, assessment, display_order, prompt, choices, correct_choice_id, content_version, is_placeholder)
  select
    p_assessment::text || '-v' || next_version::text || '-' || gen_random_uuid()::text,
    p_assessment,
    question_number::integer,
    btrim(question ->> 'prompt'),
    (
      select jsonb_agg(jsonb_build_object(
        'id', choice ->> 'id', 'label', btrim(choice ->> 'label')
      ) order by choice_number)
      from jsonb_array_elements(question -> 'choices') with ordinality choices(choice, choice_number)
    ),
    question ->> 'correctChoiceId',
    next_version,
    coalesce((question ->> 'isPlaceholder')::boolean, false)
  from jsonb_array_elements(catalog.draft -> 'questions')
    with ordinality questions(question, question_number);

  update public.assessment_catalog
  set published_version = next_version, revision = revision + 1, updated_at = now()
  where assessment = p_assessment;
  return public.admin_assessment_snapshot(p_assessment);
end;
$$;

create or replace function public.start_assessment(p_assessment public.assessment_kind)
returns public.assessment_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.assessment_attempts;
  question_version integer;
  question_count integer;
begin
  if (select auth.uid()) is null or public.is_researcher() or public.is_admin() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;
  select * into result from public.assessment_attempts
  where user_id = (select auth.uid()) and assessment = p_assessment;
  if result.id is not null then return result; end if;
  select published_version into question_version from public.assessment_catalog
  where assessment = p_assessment;
  select count(*) into question_count from public.assessment_questions
  where assessment = p_assessment and content_version = question_version;
  if question_version is null or question_count = 0 then
    raise exception 'Assessment content is not available.';
  end if;
  insert into public.assessment_attempts
    (user_id, assessment, content_version, expected_question_count)
  values ((select auth.uid()), p_assessment, question_version, question_count)
  returning * into result;
  return result;
end;
$$;

create or replace function public.get_assessment_questions(p_assessment public.assessment_kind)
returns table (
  id text, assessment public.assessment_kind, display_order integer, prompt text,
  choices jsonb, content_version integer, is_placeholder boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select question.id, question.assessment, question.display_order, question.prompt,
    question.choices, question.content_version, question.is_placeholder
  from public.assessment_questions question
  where question.assessment = p_assessment
    and question.content_version = coalesce(
      (select attempt.content_version from public.assessment_attempts attempt
       where attempt.user_id = (select auth.uid()) and attempt.assessment = p_assessment),
      (select catalog.published_version from public.assessment_catalog catalog
       where catalog.assessment = p_assessment)
    )
    and (select auth.uid()) is not null
    and not public.is_researcher()
    and not public.is_admin()
  order by question.display_order;
$$;

create or replace function public.reject_researcher_learning_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_researcher() or public.is_admin() then
    raise exception 'Only student accounts can modify participant learning records.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_admin_assessment_draft(public.assessment_kind,jsonb),
  public.validate_publishable_assessment(public.assessment_kind,jsonb),
  public.admin_assessment_snapshot(public.assessment_kind),
  public.get_admin_assessments(),
  public.save_admin_assessment(public.assessment_kind,jsonb,bigint),
  public.publish_admin_assessment(public.assessment_kind,bigint)
from public, anon, authenticated;
grant execute on function public.get_admin_assessments(),
  public.save_admin_assessment(public.assessment_kind,jsonb,bigint),
  public.publish_admin_assessment(public.assessment_kind,bigint)
to authenticated;

revoke execute on function public.start_assessment(public.assessment_kind),
  public.get_assessment_questions(public.assessment_kind)
from public, anon;
grant execute on function public.start_assessment(public.assessment_kind),
  public.get_assessment_questions(public.assessment_kind)
to authenticated;

commit;
