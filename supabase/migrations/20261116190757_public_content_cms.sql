-- Public-page drafts remain private. Only the explicit public reader returns published content.
begin;

create table public.public_content_pages (
  page_key text primary key check (page_key in ('landing', 'privacy-policy', 'terms-and-conditions')),
  draft_content jsonb not null check (jsonb_typeof(draft_content) = 'object'),
  published_content jsonb,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  check (published_content is null or jsonb_typeof(published_content) = 'object')
);

alter table public.public_content_pages enable row level security;
revoke all on public.public_content_pages from public, anon, authenticated;

create or replace function public.is_public_content_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or public.is_researcher();
$$;

create or replace function public.validate_public_content(p_page_key text, p_content jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare field text; section jsonb;
begin
  if p_page_key not in ('landing', 'privacy-policy', 'terms-and-conditions')
    or jsonb_typeof(p_content) is distinct from 'object'
    or pg_column_size(p_content) > 50000 then
    raise exception 'Invalid public page content.';
  end if;

  if p_page_key = 'landing' then
    foreach field in array array['heroHeading', 'heroEmphasis', 'heroDescription', 'aboutTitle', 'aboutDescription', 'closingHeading', 'learnHeading', 'learnDescription', 'practiceHeading', 'practiceDescription', 'progressHeading', 'progressDescription'] loop
      if jsonb_typeof(p_content -> field) is distinct from 'string'
        or length(btrim(p_content ->> field)) not between 1 and 4000 then
        raise exception 'Landing field % is required.', field;
      end if;
    end loop;
  else
    foreach field in array array['title', 'versionLabel', 'summary', 'childFriendlyNotice', 'sections'] loop
      if field = 'sections' then
        if jsonb_typeof(p_content -> field) is distinct from 'array'
          or jsonb_array_length(p_content -> field) > 20 then
          raise exception 'Legal page sections are required.';
        end if;
        for section in select value from jsonb_array_elements(p_content -> field) loop
          if jsonb_typeof(section) <> 'object'
            or jsonb_typeof(section -> 'heading') is distinct from 'string'
            or jsonb_typeof(section -> 'body') is distinct from 'string'
            or length(btrim(section ->> 'heading')) not between 1 and 4000
            or length(btrim(section ->> 'body')) not between 1 and 8000 then
            raise exception 'Each legal page section needs a heading and body.';
          end if;
        end loop;
      elsif jsonb_typeof(p_content -> field) is distinct from 'string'
        or length(btrim(p_content ->> field)) not between 1 and 8000 then
        raise exception 'Legal page field % is required.', field;
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.get_public_content(p_page_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'content', page.published_content,
    'publishedAt', page.published_at,
    'revision', page.revision
  )
  from public.public_content_pages page
  where page.page_key = p_page_key;
$$;

create or replace function public.get_public_content_cms()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_public_content_manager() then coalesce(jsonb_agg(jsonb_build_object(
    'pageKey', page_key,
    'draftContent', draft_content,
    'publishedContent', published_content,
    'revision', revision,
    'updatedAt', updated_at,
    'publishedAt', published_at
  ) order by page_key), '[]'::jsonb) else '[]'::jsonb end
  from public.public_content_pages;
$$;

create or replace function public.save_public_content_draft(
  p_page_key text,
  p_content jsonb,
  p_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result public.public_content_pages;
begin
  if not public.is_public_content_manager() then
    raise exception 'Content management access required.' using errcode = '42501';
  end if;
  perform public.validate_public_content(p_page_key, p_content);
  update public.public_content_pages
  set draft_content = p_content, revision = revision + 1, updated_at = now(), updated_by = (select auth.uid())
  where page_key = p_page_key and revision = p_revision
  returning * into result;
  if result.page_key is null then
    raise exception 'This content was updated elsewhere. Reload before saving.';
  end if;
  return jsonb_build_object('pageKey', result.page_key, 'draftContent', result.draft_content,
    'publishedContent', result.published_content, 'revision', result.revision,
    'updatedAt', result.updated_at, 'publishedAt', result.published_at);
end;
$$;

create or replace function public.publish_public_content(p_page_key text, p_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result public.public_content_pages;
begin
  if not public.is_public_content_manager() then
    raise exception 'Content management access required.' using errcode = '42501';
  end if;
  select * into result from public.public_content_pages where page_key = p_page_key for update;
  if result.page_key is null or result.revision <> p_revision then
    raise exception 'This content was updated elsewhere. Reload before publishing.';
  end if;
  perform public.validate_public_content(result.page_key, result.draft_content);
  update public.public_content_pages
  set published_content = draft_content, published_at = now(), published_by = (select auth.uid()),
      updated_at = now(), updated_by = (select auth.uid()), revision = revision + 1
  where page_key = p_page_key
  returning * into result;
  return jsonb_build_object('pageKey', result.page_key, 'draftContent', result.draft_content,
    'publishedContent', result.published_content, 'revision', result.revision,
    'updatedAt', result.updated_at, 'publishedAt', result.published_at);
end;
$$;

insert into public.public_content_pages(page_key, draft_content) values
('landing', jsonb_build_object(
  'heroHeading', 'Math is a language.',
  'heroEmphasis', 'Learn to translate it.',
  'heroDescription', 'Discover how everyday words become algebraic expressions through guided lessons and interactive practice.',
  'aboutTitle', 'About ALTRAS',
  'aboutDescription', 'ALTRAS is an educational application for algebraic translation, developed in connection with a student research project at Benguet State University. It supports learning and practicing mathematical expressions; it is not an official university service or endorsement.',
  'closingHeading', 'Ready to start translating?',
  'learnHeading', 'Learn',
  'learnDescription', 'Understand algebraic translation with structured explanations and worked examples.',
  'practiceHeading', 'Practice',
  'practiceDescription', 'Apply what you learn through interactive translation activities that build confidence.',
  'progressHeading', 'Progress',
  'progressDescription', 'Review your results and follow your learning progress as you prepare for assessments.'
)),
('privacy-policy', jsonb_build_object(
  'title', 'Privacy Policy',
  'versionLabel', 'Draft — researcher approval required before publication',
  'summary', 'This draft describes the information ALTRAS uses to provide lessons and research reporting. Researchers must confirm the data controller, contact details, retention period, and any required approvals before this policy is published.',
  'childFriendlyNotice', 'ALTRAS uses your account and lesson progress to help you learn and to support the research project. Ask a parent, guardian, teacher, or researcher if you have questions. This notice is a draft until the full policy is approved.',
  'sections', jsonb_build_array(
    jsonb_build_object('heading', 'Information used by ALTRAS', 'body', 'ALTRAS uses account profile information, lesson answers, assessment results, progress, and settings needed to operate the learning application and support the student research project.'),
    jsonb_build_object('heading', 'Research and student information', 'body', 'Researchers manage participant information and view study-related results through authorized researcher tools. The final policy must state the approved research purpose, lawful basis, and any consent or guardian arrangements.'),
    jsonb_build_object('heading', 'Your choices and questions', 'body', 'The final policy must explain how to ask questions, request access or correction, and contact the responsible researcher or institution.')
  )
)),
('terms-and-conditions', jsonb_build_object(
  'title', 'Terms and Conditions',
  'versionLabel', 'Draft — researcher approval required before publication',
  'summary', 'These draft terms describe respectful use of ALTRAS. Researchers must confirm the final terms version, contact details, and any participant requirements before publication.',
  'childFriendlyNotice', 'Use ALTRAS for learning. Keep your account details private, be respectful, and ask a teacher, parent, guardian, or researcher for help if something does not seem right. These terms are a draft until approved.',
  'sections', jsonb_build_array(
    jsonb_build_object('heading', 'Using ALTRAS', 'body', 'Use ALTRAS for its intended learning and research activities. Do not share an account or try to access another person''s information.'),
    jsonb_build_object('heading', 'Accounts and learning records', 'body', 'Keep your sign-in details private. Learning records are managed through the application and its authorized research processes.'),
    jsonb_build_object('heading', 'Approval needed before use', 'body', 'Researchers must review and approve the final terms before publication, including any requirements that apply to student participants.')
  )
))
on conflict (page_key) do nothing;

revoke all on function public.is_public_content_manager(),
  public.validate_public_content(text,jsonb),
  public.get_public_content(text),
  public.get_public_content_cms(),
  public.save_public_content_draft(text,jsonb,bigint),
  public.publish_public_content(text,bigint) from public, anon, authenticated;
grant execute on function public.get_public_content(text) to anon, authenticated;
grant execute on function public.get_public_content_cms(),
  public.save_public_content_draft(text,jsonb,bigint),
  public.publish_public_content(text,bigint) to authenticated;

commit;
