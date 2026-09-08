-- Support Auth-dashboard provisioning while keeping explicit application metadata strict.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_display_name text;
  fallback_username_base text;
  fallback_display_name text;
  candidate_username text;
  candidate_suffix text;
  resolved_username text;
  resolved_display_name text;
  attempt integer;
begin
  if coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'username' then
    requested_username := lower(trim(new.raw_user_meta_data ->> 'username'));
    if requested_username is null or requested_username !~ '^[a-z0-9_-]{3,24}$' then
      raise exception 'A valid username is required.';
    end if;
  else
    fallback_username_base := left(
      trim(
        both '_' from regexp_replace(
          lower(split_part(coalesce(new.email, ''), '@', 1)),
          '[^a-z0-9_-]+',
          '_',
          'g'
        )
      ),
      24
    );
    if fallback_username_base !~ '^[a-z0-9_-]{3,24}$' then
      fallback_username_base := 'user';
    end if;
  end if;

  if coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'display_name' then
    requested_display_name := trim(new.raw_user_meta_data ->> 'display_name');
    if requested_display_name is null
      or char_length(requested_display_name) not between 2 and 40 then
      raise exception 'A valid display name is required.';
    end if;
  else
    fallback_display_name := left(
      trim(
        regexp_replace(
          split_part(coalesce(new.email, ''), '@', 1),
          '[^[:alnum:] _-]+',
          ' ',
          'g'
        )
      ),
      40
    );
    if char_length(fallback_display_name) not between 2 and 40 then
      fallback_display_name := 'Manual user';
    end if;
  end if;

  resolved_display_name := coalesce(requested_display_name, fallback_display_name);

  if requested_username is not null then
    resolved_username := requested_username;
    insert into public.profiles (user_id, username, display_name)
    values (
      new.id,
      resolved_username,
      resolved_display_name
    );
  else
    for attempt in 0..9999 loop
      if attempt = 0 then
        candidate_username := fallback_username_base;
      else
        candidate_suffix := substring(replace(new.id::text, '-', '') from 1 for 12) || attempt::text;
        candidate_username := left(
          fallback_username_base,
          24 - char_length(candidate_suffix) - 1
        ) || '_' || candidate_suffix;
      end if;

      resolved_username := candidate_username;

      begin
        insert into public.profiles (user_id, username, display_name)
        values (
          new.id,
          resolved_username,
          resolved_display_name
        );
        exit;
      exception
        when unique_violation then
          if attempt = 9999 then
            raise exception 'Unable to generate a unique username.';
          end if;
      end;
    end loop;
  end if;

  insert into public.user_settings (user_id)
  values (new.id);

  if not (coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'username')
    or not (coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'display_name') then
    update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
      'username', resolved_username,
      'display_name', resolved_display_name
    )
    where id = new.id;
  end if;

  return new;
end;
$$;
