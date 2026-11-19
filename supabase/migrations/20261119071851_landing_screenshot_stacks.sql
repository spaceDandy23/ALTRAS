-- Extend draft validation; published content, storage policies and legacy images are preserved.
create or replace function public.validate_public_content(p_page_key text, p_content jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare field text; section jsonb; slot text; image jsonb;
begin
  if p_page_key not in ('landing', 'privacy-policy', 'terms-and-conditions')
    or jsonb_typeof(p_content) is distinct from 'object'
    or pg_column_size(p_content) > 50000 then
    raise exception 'Invalid public page content.';
  end if;

  if p_page_key = 'landing' then
    if p_content ? 'showcaseImages' then
      if jsonb_typeof(p_content->'showcaseImages') is distinct from 'object' then
        raise exception 'Screenshot stacks must be an object.';
      end if;
      for slot in select jsonb_object_keys(p_content->'showcaseImages') loop
        if slot not in ('understand','apply','reflect') then raise exception 'Unknown screenshot section.'; end if;
        if jsonb_typeof(p_content->'showcaseImages'->slot) is distinct from 'array' then raise exception 'Screenshot stack must be an array.'; end if;
        if jsonb_array_length(p_content->'showcaseImages'->slot) > 8 then raise exception 'Use at most 8 screenshots per section.'; end if;
        for image in select value from jsonb_array_elements(p_content->'showcaseImages'->slot) loop
          if jsonb_typeof(image) is distinct from 'object'
            or jsonb_typeof(image->'path') is distinct from 'string'
            or length(image->>'path') > 300
            or image->>'path' !~ ('^landing/' || slot || '/[A-Za-z0-9._-]+$')
            or jsonb_typeof(image->'alt') is distinct from 'string'
            or length(image->>'alt') > 300 then raise exception 'Screenshot path or alternative text is invalid.'; end if;
        end loop;
        if (select count(distinct value->>'path') from jsonb_array_elements(p_content->'showcaseImages'->slot)) <> jsonb_array_length(p_content->'showcaseImages'->slot) then raise exception 'Screenshots must not be duplicated in a stack.'; end if;
      end loop;
    end if;
    foreach field in array array['heroHeading', 'heroEmphasis', 'heroDescription', 'aboutTitle', 'aboutDescription', 'closingHeading', 'learnHeading', 'learnDescription', 'practiceHeading', 'practiceDescription', 'progressHeading', 'progressDescription'] loop
      if jsonb_typeof(p_content -> field) is distinct from 'string'
        or length(btrim(p_content ->> field)) not between 1 and 4000 then
        raise exception 'Landing field % is required.', field;
      end if;
    end loop;
    foreach field in array array['understandImagePath', 'applyImagePath', 'reflectImagePath'] loop
      if p_content ? field and jsonb_typeof(p_content -> field) not in ('string', 'null') then
        raise exception 'Landing screenshot paths must be text or empty.';
      end if;
      if jsonb_typeof(p_content -> field) = 'string'
        and (length(p_content ->> field) > 300 or p_content ->> field !~ '^landing/(understand|apply|reflect)/[A-Za-z0-9._-]+$') then
        raise exception 'Landing screenshot path is invalid.';
      end if;
    end loop;
    foreach field in array array['understandImageAlt', 'applyImageAlt', 'reflectImageAlt'] loop
      if p_content ? field and (jsonb_typeof(p_content -> field) <> 'string' or length(p_content ->> field) > 300) then
        raise exception 'Landing screenshot alternative text is invalid.';
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
