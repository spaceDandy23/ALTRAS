begin;

-- Keep assessment copy in the lesson draft/published presentation while
-- retaining compatibility with older lessons that do not have this field.
alter function public.validate_authored_lesson(jsonb)
  rename to validate_authored_lesson_before_assessment_instructions;

create function public.validate_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  instructions jsonb;
  instruction jsonb;
  assessment text;
  field text;
  maximum integer;
begin
  perform public.validate_authored_lesson_before_assessment_instructions(p);
  if not (p ? 'assessmentInstructions') then return; end if;

  instructions := p->'assessmentInstructions';
  if jsonb_typeof(instructions) is distinct from 'object' then
    raise exception 'Assessment instructions must be an object.';
  end if;

  foreach assessment in array array['pre-test', 'post-test'] loop
    if not (instructions ? assessment) then continue; end if;
    instruction := instructions->assessment;
    if jsonb_typeof(instruction) is distinct from 'object' then
      raise exception 'Assessment % instructions must be an object.', assessment;
    end if;
    foreach field in array array['heading', 'body', 'dialogue'] loop
      if not (instruction ? field) then continue; end if;
      if jsonb_typeof(instruction->field) is distinct from 'string'
        or length(btrim(instruction->>field)) = 0 then
        raise exception 'Assessment % instruction % must contain text.', assessment, field;
      end if;
      maximum := case field when 'heading' then 160 when 'body' then 1000 else 500 end;
      if length(instruction->>field) > maximum then
        raise exception 'Assessment % instruction % is too long.', assessment, field;
      end if;
    end loop;
  end loop;
end;
$$;
revoke all on function public.validate_authored_lesson_before_assessment_instructions(jsonb),
  public.validate_authored_lesson(jsonb) from public, anon, authenticated;

alter function public.compile_lesson(jsonb, integer)
  rename to compile_lesson_before_assessment_instructions;

create function public.compile_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
begin
  perform public.validate_authored_lesson(p);
  perform public.compile_lesson_before_assessment_instructions(p, v);
  update public.lesson_definitions
  set presentation = presentation || case
    when p ? 'assessmentInstructions'
      then jsonb_build_object('assessmentInstructions', p->'assessmentInstructions')
    else '{}'::jsonb
  end
  where lesson_id = p->>'id' and content_version = v;
end;
$$;
revoke all on function public.compile_lesson_before_assessment_instructions(jsonb, integer),
  public.compile_lesson(jsonb, integer) from public, anon, authenticated;

commit;
