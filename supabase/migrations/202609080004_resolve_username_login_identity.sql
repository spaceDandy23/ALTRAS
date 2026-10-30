-- Resolve a non-synthetic Auth identity only after validating the supplied
-- credential. This keeps profiles and Auth emails non-enumerable to callers.

create or replace function public.resolve_login_email(p_username text, p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_username text := lower(trim(p_username));
  resolved_email text;
  password_hash text;
  verified_hash text;
begin
  if normalized_username is null
    or normalized_username !~ '^[a-z0-9_-]{3,24}$'
    or p_password is null
    or char_length(p_password) = 0 then
    return null;
  end if;

  select auth_user.email, auth_user.encrypted_password
  into resolved_email, password_hash
  from public.profiles profile
  join auth.users auth_user on auth_user.id = profile.user_id
  where profile.username = normalized_username;

  if resolved_email is null or password_hash is null then
    return null;
  end if;

  if pg_catalog.to_regprocedure('extensions.crypt(text,text)') is not null then
    execute 'select extensions.crypt($1, $2)'
      into verified_hash
      using p_password, password_hash;
  elsif pg_catalog.to_regprocedure('public.crypt(text,text)') is not null then
    execute 'select public.crypt($1, $2)'
      into verified_hash
      using p_password, password_hash;
  else
    return null;
  end if;

  if verified_hash is distinct from password_hash then
    return null;
  end if;

  return resolved_email;
end;
$$;

revoke all on function public.resolve_login_email(text, text) from public;
grant execute on function public.resolve_login_email(text, text) to anon, authenticated;
