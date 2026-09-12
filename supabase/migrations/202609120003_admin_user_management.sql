-- Controlled account visibility and privilege mutations for the dedicated admin workspace.
begin;

-- Banned administrators must lose access to every existing admin RPC immediately,
-- even while an access token issued before the ban remains unexpired.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.admin_users membership
    join auth.users account on account.id = membership.user_id
    where membership.user_id = (select auth.uid())
      and (account.banned_until is null or account.banned_until <= now())
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create function public.admin_list_users(
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if p_page is null or p_page < 1 then
    raise exception 'Page must be a positive integer.';
  end if;
  if p_page_size is null or p_page_size not between 1 and 100 then
    raise exception 'Page size must be from 1 to 100.';
  end if;

  with filtered as materialized (
    select
      account.id,
      profile.username,
      profile.display_name,
      account.email,
      account.created_at,
      account.last_sign_in_at,
      account.banned_until is not null and account.banned_until > now() as banned,
      researcher.user_id is not null as researcher,
      administrator.user_id is not null as administrator
    from auth.users account
    left join public.profiles profile on profile.user_id = account.id
    left join public.researcher_users researcher on researcher.user_id = account.id
    left join public.admin_users administrator on administrator.user_id = account.id
    where normalized_search is null
      or lower(coalesce(profile.username, '')) like '%' || normalized_search || '%'
      or lower(coalesce(profile.display_name, '')) like '%' || normalized_search || '%'
      or lower(coalesce(account.email, '')) like '%' || normalized_search || '%'
  ), page_rows as (
    select * from filtered
    order by created_at desc, id
    limit p_page_size offset ((p_page - 1) * p_page_size)
  )
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', row.id,
        'username', row.username,
        'displayName', row.display_name,
        'email', row.email,
        'createdAt', row.created_at,
        'lastSignInAt', row.last_sign_in_at,
        'banned', row.banned,
        'researcher', row.researcher,
        'admin', row.administrator
      ) order by row.created_at desc, row.id)
      from page_rows row
    ), '[]'::jsonb),
    'page', p_page,
    'pageSize', p_page_size,
    'total', (select count(*) from filtered)
  ) into result;
  return result;
end;
$$;

create function public.admin_set_researcher_access(p_user_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if p_user_id is null or p_enabled is null or not exists(select 1 from auth.users where id = p_user_id) then
    raise exception 'Account not found.';
  end if;
  if p_enabled then
    insert into public.researcher_users(user_id) values(p_user_id) on conflict(user_id) do nothing;
  else
    delete from public.researcher_users where user_id = p_user_id;
  end if;
  return p_enabled;
end;
$$;

create function public.admin_set_admin_access(p_user_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if p_user_id is null or p_enabled is null or not exists(select 1 from auth.users where id = p_user_id) then
    raise exception 'Account not found.';
  end if;
  perform pg_advisory_xact_lock(20260912, 3);
  if p_enabled then
    if exists(select 1 from auth.users where id = p_user_id and banned_until is not null and banned_until > now()) then
      raise exception 'Reactivate this account before granting admin access.';
    end if;
    insert into public.admin_users(user_id) values(p_user_id) on conflict(user_id) do nothing;
  elsif exists(select 1 from public.admin_users where user_id = p_user_id) then
    if not exists(
      select 1 from public.admin_users membership
      join auth.users account on account.id = membership.user_id
      where membership.user_id <> p_user_id
        and (account.banned_until is null or account.banned_until <= now())
    ) then
      raise exception 'The final active admin cannot be removed.';
    end if;
    delete from public.admin_users where user_id = p_user_id;
  end if;
  return p_enabled;
end;
$$;

-- The Edge Function calls this through the requesting admin's JWT before using
-- the server-only Auth Admin API. An admin must be revoked first, which makes the
-- final-admin rule impossible to bypass through banning.
create function public.admin_assert_user_can_be_banned(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  if p_user_id is null or not exists(select 1 from auth.users where id = p_user_id) then
    raise exception 'Account not found.';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'You cannot deactivate your own account.';
  end if;
  if exists(select 1 from public.admin_users where user_id = p_user_id) then
    raise exception 'Revoke admin access before deactivating this account.';
  end if;
  return true;
end;
$$;

revoke all on function public.admin_list_users(text,integer,integer),
  public.admin_set_researcher_access(uuid,boolean),
  public.admin_set_admin_access(uuid,boolean),
  public.admin_assert_user_can_be_banned(uuid)
from public, anon;
grant execute on function public.admin_list_users(text,integer,integer),
  public.admin_set_researcher_access(uuid,boolean),
  public.admin_set_admin_access(uuid,boolean),
  public.admin_assert_user_can_be_banned(uuid)
to authenticated;

commit;
