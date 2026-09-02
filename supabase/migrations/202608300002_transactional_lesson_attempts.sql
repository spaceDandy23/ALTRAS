-- Transactional lesson completion and active-time tracking.
-- Run after 202608300001_online_foundation.sql.

alter table public.lesson_attempts
  add column expected_activity_count integer not null default 1
    check (expected_activity_count > 0),
  add column passing_threshold smallint not null default 70
    check (passing_threshold between 0 and 100),
  add column active_seconds integer not null default 0
    check (active_seconds >= 0);

alter table public.lesson_attempts
  add constraint lesson_attempts_valid_state check (
    (
      status = 'active'
      and completed_at is null
      and abandoned_at is null
      and final_score is null
      and star_count is null
      and cleared is null
      and xp_improvement = 0
    )
    or (
      status = 'completed'
      and completed_at is not null
      and abandoned_at is null
      and final_score is not null
      and star_count is not null
      and cleared is not null
    )
    or (
      status = 'abandoned'
      and abandoned_at is not null
      and completed_at is null
      and final_score is null
      and star_count is null
      and cleared is null
      and xp_improvement = 0
    )
  );

-- Answers belong only to an attempt that is still in progress. Refreshing and
-- retrying the same activity remains safe because (attempt_id, activity_id) is unique.
drop policy "Students add answers to their attempts" on public.attempt_answers;
create policy "Students add answers to active attempts"
  on public.attempt_answers for insert to authenticated
  with check (
    exists (
      select 1 from public.lesson_attempts
      where id = attempt_id
        and user_id = (select auth.uid())
        and status = 'active'
    )
  );

create or replace function public.add_attempt_active_seconds(
  p_attempt_id uuid,
  p_seconds integer
)
returns public.lesson_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.lesson_attempts;
begin
  if p_seconds < 0 or p_seconds > 3600 then
    raise exception 'Invalid active-time segment.';
  end if;

  update public.lesson_attempts
  set active_seconds = active_seconds + p_seconds,
      last_updated_at = now()
  where id = p_attempt_id
    and user_id = (select auth.uid())
    and status = 'active'
  returning * into result;

  if result.id is null then
    raise exception 'Active attempt not found.';
  end if;
  return result;
end;
$$;

create or replace function public.abandon_lesson_attempt(p_attempt_id uuid)
returns public.lesson_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.lesson_attempts;
begin
  update public.lesson_attempts
  set status = 'abandoned',
      abandoned_at = now(),
      last_updated_at = now()
  where id = p_attempt_id
    and user_id = (select auth.uid())
    and status = 'active'
  returning * into result;

  if result.id is null then
    select * into result
    from public.lesson_attempts
    where id = p_attempt_id and user_id = (select auth.uid());
  end if;
  if result.id is null then raise exception 'Attempt not found.'; end if;
  return result;
end;
$$;

create or replace function public.complete_lesson_attempt(
  p_attempt_id uuid,
  p_follow_up_lesson_ids text[] default array[]::text[]
)
returns public.lesson_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempt public.lesson_attempts;
  current_progress public.lesson_progress;
  answer_count integer;
  correct_count integer;
  computed_score smallint;
  computed_stars smallint;
  computed_cleared boolean;
  next_best_score smallint;
  next_best_stars smallint;
  next_xp integer;
  xp_delta integer;
  follow_up_id text;
begin
  select * into current_attempt
  from public.lesson_attempts
  where id = p_attempt_id and user_id = (select auth.uid())
  for update;

  if current_attempt.id is null then raise exception 'Attempt not found.'; end if;
  if current_attempt.status = 'completed' then return current_attempt; end if;
  if current_attempt.status <> 'active' then raise exception 'Attempt cannot be completed.'; end if;

  select count(*), count(*) filter (where is_correct)
  into answer_count, correct_count
  from public.attempt_answers
  where attempt_id = p_attempt_id;

  if answer_count <> current_attempt.expected_activity_count then
    raise exception 'Complete every activity before finishing the lesson.';
  end if;

  computed_score := round((correct_count::numeric / current_attempt.expected_activity_count) * 100);
  computed_stars := case
    when computed_score = 100 then 3
    when computed_score >= 85 then 2
    when computed_score >= current_attempt.passing_threshold then 1
    else 0
  end;
  computed_cleared := computed_score >= current_attempt.passing_threshold;

  select * into current_progress
  from public.lesson_progress
  where user_id = current_attempt.user_id and lesson_id = current_attempt.lesson_id
  for update;
  if current_progress.user_id is null then raise exception 'Lesson progress not found.'; end if;

  next_best_score := greatest(current_progress.best_score, computed_score);
  next_best_stars := greatest(current_progress.best_star_count, computed_stars);
  next_xp := next_best_score + (next_best_stars * 10);
  xp_delta := greatest(0, next_xp - current_progress.xp_awarded);

  update public.lesson_attempts
  set status = 'completed',
      completed_at = now(),
      last_updated_at = now(),
      final_score = computed_score,
      star_count = computed_stars,
      cleared = computed_cleared,
      xp_improvement = xp_delta
  where id = p_attempt_id
  returning * into current_attempt;

  update public.lesson_progress
  set status = case
        when computed_cleared or current_progress.status = 'cleared' then 'cleared'::public.lesson_progress_status
        else 'available'::public.lesson_progress_status
      end,
      best_score = next_best_score,
      best_star_count = next_best_stars,
      attempt_count = current_progress.attempt_count + 1,
      xp_awarded = next_xp,
      last_attempted_at = now(),
      cleared_at = coalesce(current_progress.cleared_at, case when computed_cleared then now() end)
  where user_id = current_attempt.user_id and lesson_id = current_attempt.lesson_id;

  if computed_cleared then
    foreach follow_up_id in array p_follow_up_lesson_ids loop
      insert into public.lesson_progress (user_id, lesson_id, status)
      values (current_attempt.user_id, follow_up_id, 'available')
      on conflict (user_id, lesson_id) do update
        set status = case
          when public.lesson_progress.status = 'locked' then 'available'::public.lesson_progress_status
          else public.lesson_progress.status
        end;
    end loop;
  end if;

  return current_attempt;
end;
$$;

-- Attempts can only be finalized, abandoned, or timed through the functions above.
revoke update on public.lesson_attempts from authenticated;
revoke execute on function public.add_attempt_active_seconds(uuid, integer) from public;
revoke execute on function public.abandon_lesson_attempt(uuid) from public;
revoke execute on function public.complete_lesson_attempt(uuid, text[]) from public;
grant execute on function public.add_attempt_active_seconds(uuid, integer) to authenticated;
grant execute on function public.abandon_lesson_attempt(uuid) to authenticated;
grant execute on function public.complete_lesson_attempt(uuid, text[]) to authenticated;
