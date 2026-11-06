-- Repair the live auth-user trigger function after retiring the profile authorization field.
-- The original trigger remains attached to auth.users and continues to create
-- a profile and default user settings for every new authenticated account.

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
