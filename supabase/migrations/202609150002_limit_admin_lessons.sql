-- Keep the lesson-count cap at the database boundary so RPC callers cannot bypass it.
create or replace function public.enforce_admin_lesson_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (select count(*) from public.lesson_catalog) >= 8 then
    raise exception 'A maximum of 8 lessons is allowed.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists lesson_catalog_limit on public.lesson_catalog;
create trigger lesson_catalog_limit
before insert on public.lesson_catalog
for each row execute function public.enforce_admin_lesson_limit();

revoke all on function public.enforce_admin_lesson_limit() from public, anon, authenticated;
