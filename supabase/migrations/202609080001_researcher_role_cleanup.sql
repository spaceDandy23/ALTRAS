-- Retire the legacy profile role after researcher authorization moved to the
-- dedicated researcher_users allow-list in 202608310001_researcher_results.sql.

do $$
begin
  if to_regclass('public.researcher_users') is null then
    raise exception 'researcher_users must exist before removing profiles.role';
  end if;
end;
$$;

alter table public.profiles
  drop column if exists role;

drop type if exists public.app_role;
