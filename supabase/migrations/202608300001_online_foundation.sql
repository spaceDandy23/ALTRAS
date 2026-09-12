-- ALTRAS online foundation
-- Lesson content remains packaged with the application. This database stores
-- accounts, preferences, progress, attempts, and research results only.

create extension if not exists pgcrypto;

create type public.app_role as enum ('student', 'researcher');
create type public.lesson_progress_status as enum ('locked', 'available', 'in-progress', 'cleared');
create type public.lesson_attempt_status as enum ('active', 'completed', 'abandoned');
create type public.assessment_kind as enum ('pre-test', 'post-test');
create type public.assessment_attempt_status as enum ('active', 'submitted');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username = lower(username)),
  display_name text not null check (char_length(display_name) between 2 and 40),
  age smallint check (age between 5 and 120),
  role public.app_role not null default 'student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  theme text not null default 'dark' check (theme in ('light', 'dark', 'system')),
  master_volume smallint not null default 80 check (master_volume between 0 and 100),
  sound_effects_volume smallint not null default 80 check (sound_effects_volume between 0 and 100),
  music_volume smallint not null default 60 check (music_volume between 0 and 100),
  animations_enabled boolean not null default true,
  readability_scale numeric(3, 2) not null default 1.00 check (readability_scale between 1.00 and 1.30),
  updated_at timestamptz not null default now()
);

create table public.lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  status public.lesson_progress_status not null default 'locked',
  best_score smallint not null default 0 check (best_score between 0 and 100),
  best_star_count smallint not null default 0 check (best_star_count between 0 and 3),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  xp_awarded integer not null default 0 check (xp_awarded >= 0),
  first_started_at timestamptz,
  last_attempted_at timestamptz,
  cleared_at timestamptz,
  primary key (user_id, lesson_id)
);

create table public.lesson_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  content_version integer not null check (content_version > 0),
  status public.lesson_attempt_status not null default 'active',
  started_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  completed_at timestamptz,
  abandoned_at timestamptz,
  final_score smallint check (final_score between 0 and 100),
  star_count smallint check (star_count between 0 and 3),
  cleared boolean,
  xp_improvement integer not null default 0 check (xp_improvement >= 0)
);

create index lesson_attempts_user_lesson_idx
  on public.lesson_attempts (user_id, lesson_id, started_at desc);

create unique index lesson_attempts_one_active_idx
  on public.lesson_attempts (user_id, lesson_id)
  where status = 'active';

create table public.attempt_answers (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references public.lesson_attempts (id) on delete cascade,
  activity_id text not null,
  activity_type text not null,
  submitted_answer jsonb not null,
  is_correct boolean not null,
  submitted_at timestamptz not null default now(),
  unique (attempt_id, activity_id)
);

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  assessment public.assessment_kind not null,
  status public.assessment_attempt_status not null default 'active',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score smallint check (score between 0 and 100),
  completion_seconds integer check (completion_seconds >= 0),
  unique (user_id, assessment)
);

create or replace function public.is_researcher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = (select auth.uid())
      and role = 'researcher'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := lower(trim(new.raw_user_meta_data ->> 'username'));
  requested_display_name := trim(new.raw_user_meta_data ->> 'display_name');

  if requested_username is null or requested_username !~ '^[a-z0-9_-]{3,24}$' then
    raise exception 'A valid username is required.';
  end if;

  if requested_display_name is null or char_length(requested_display_name) not between 2 and 40 then
    raise exception 'A valid display name is required.';
  end if;

  insert into public.profiles (user_id, username, display_name)
  values (new.id, requested_username, requested_display_name);

  insert into public.user_settings (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.lesson_attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.assessment_attempts enable row level security;

create policy "Students read their profile; researchers read all"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id or public.is_researcher());

create policy "Students update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Students manage their own settings"
  on public.user_settings for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Students read progress; researchers read all"
  on public.lesson_progress for select to authenticated
  using ((select auth.uid()) = user_id or public.is_researcher());

create policy "Students create their own progress"
  on public.lesson_progress for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Students update their own progress"
  on public.lesson_progress for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Students read attempts; researchers read all"
  on public.lesson_attempts for select to authenticated
  using ((select auth.uid()) = user_id or public.is_researcher());

create policy "Students create their own attempts"
  on public.lesson_attempts for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Students update their own attempts"
  on public.lesson_attempts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Students read answers; researchers read all"
  on public.attempt_answers for select to authenticated
  using (
    exists (
      select 1 from public.lesson_attempts
      where id = attempt_id
        and (user_id = (select auth.uid()) or public.is_researcher())
    )
  );

create policy "Students add answers to their attempts"
  on public.attempt_answers for insert to authenticated
  with check (
    exists (
      select 1 from public.lesson_attempts
      where id = attempt_id and user_id = (select auth.uid())
    )
  );

create policy "Students read assessments; researchers read all"
  on public.assessment_attempts for select to authenticated
  using ((select auth.uid()) = user_id or public.is_researcher());

create policy "Students create their own assessment"
  on public.assessment_attempts for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Students update their own active assessment"
  on public.assessment_attempts for update to authenticated
  using ((select auth.uid()) = user_id and status = 'active')
  with check ((select auth.uid()) = user_id);

-- Students may change only these profile fields. Role and username changes are
-- intentionally excluded so a student cannot promote their own account.
revoke update on public.profiles from authenticated;
grant update (display_name, age, updated_at) on public.profiles to authenticated;

grant select on public.profiles, public.user_settings, public.lesson_progress,
  public.lesson_attempts, public.attempt_answers, public.assessment_attempts to authenticated;
grant insert, update on public.user_settings, public.lesson_progress,
  public.lesson_attempts, public.attempt_answers, public.assessment_attempts to authenticated;
