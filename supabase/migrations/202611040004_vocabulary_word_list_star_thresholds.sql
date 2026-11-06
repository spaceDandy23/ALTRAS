-- Vocabulary teaching tables, a CMS-managed global Math Word List, and revised lesson stars.
begin;

create table public.math_word_list_entries (
  id text primary key check (id ~ '^[a-z0-9-]{3,100}$'),
  display_order integer not null unique check (display_order > 0),
  term text not null check (length(btrim(term)) between 1 and 200),
  definition text not null default '' check (length(definition) <= 4000),
  example text not null default '' check (length(example) <= 4000),
  updated_at timestamptz not null default now()
);
alter table public.math_word_list_entries enable row level security;
create policy math_word_list_authenticated_read on public.math_word_list_entries
  for select to authenticated using (true);

insert into public.math_word_list_entries (id, display_order, term, definition, example) values
  ('plus',1,'plus','Addition','five more than a number → n + 5'),
  ('sum',2,'sum','Addition','five more than a number → n + 5'),
  ('added-to',3,'added to','Addition','five more than a number → n + 5'),
  ('more-than',4,'more than','Addition','five more than a number → n + 5'),
  ('increased-by',5,'increased by','Addition','five more than a number → n + 5'),
  ('minus',6,'minus','Subtraction','six less than a number → n − 6'),
  ('difference',7,'difference','Subtraction','the difference of A and B → A − B'),
  ('less-than',8,'less than','Subtraction','six less than a number → n − 6'),
  ('subtracted-from',9,'subtracted from','Subtraction','a number subtracted from twelve → 12 − n'),
  ('decreased-by',10,'decreased by','Subtraction','six decreased by a number → 6 − n'),
  ('times',11,'times','Multiplication','the product of three and a number → 3n'),
  ('product',12,'product','Multiplication','the product of three and a number → 3n'),
  ('multiplied-by',13,'multiplied by','Multiplication','the product of three and a number → 3n'),
  ('operation-of',14,'of','Multiplication','the product of three and a number → 3n'),
  ('divided-by',15,'divided by','Division','the quotient of a number and four → n ÷ 4'),
  ('quotient',16,'quotient','Division','the quotient of a number and four → n ÷ 4'),
  ('per',17,'per','Division','the quotient of a number and four → n ÷ 4'),
  ('ratio',18,'ratio','Division','the quotient of a number and four → n ÷ 4');

create or replace function public.get_math_word_list() returns jsonb
language sql security definer set search_path = '' stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'term', term, 'definition', definition, 'example', example
  ) order by display_order), '[]'::jsonb)
  from public.math_word_list_entries
  where (select auth.uid()) is not null;
$$;

create or replace function public.save_math_word_list(p_entries jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare entry jsonb; position integer := 0; ids text[] := array[]::text[];
begin
  if not public.is_admin() then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) > 500 then
    raise exception 'Math Word List entries must be an array of at most 500 rows.';
  end if;
  for entry in select value from jsonb_array_elements(p_entries) loop
    position := position + 1;
    if coalesce(entry->>'id','') !~ '^[a-z0-9-]{3,100}$'
      or jsonb_typeof(entry->'term') is distinct from 'string'
      or length(btrim(entry->>'term')) not between 1 and 200
      or jsonb_typeof(entry->'definition') is distinct from 'string'
      or length(entry->>'definition') > 4000
      or jsonb_typeof(entry->'example') is distinct from 'string'
      or length(entry->>'example') > 4000 then raise exception 'Invalid Math Word List row.'; end if;
    if entry->>'id' = any(ids) then raise exception 'Math Word List row IDs must be unique.'; end if;
    ids := array_append(ids, entry->>'id');
  end loop;
  delete from public.math_word_list_entries;
  position := 0;
  for entry in select value from jsonb_array_elements(p_entries) loop
    position := position + 1;
    insert into public.math_word_list_entries(id,display_order,term,definition,example)
    values(entry->>'id',position,btrim(entry->>'term'),entry->>'definition',entry->>'example');
  end loop;
  return public.get_math_word_list();
end;
$$;
revoke all on function public.get_math_word_list() from public, anon;
grant execute on function public.get_math_word_list() to authenticated;
revoke all on function public.save_math_word_list(jsonb) from public, anon;
grant execute on function public.save_math_word_list(jsonb) to authenticated;

-- Keep the existing validator as the trust-boundary implementation for all prior content types.
alter function public.validate_legacy_authored_lesson(jsonb) rename to validate_pre_vocabulary_authored_lesson;
create function public.validate_legacy_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare item jsonb; row jsonb; sanitized jsonb; safe_items jsonb;
begin
  for item in select value from jsonb_array_elements(p->'instructionalContent') loop
    if item->>'type' = 'vocabulary-table' then
      if jsonb_typeof(item->'id') is distinct from 'string' or length(btrim(item->>'id')) = 0
        or jsonb_typeof(item->'title') is distinct from 'string' or length(btrim(item->>'title')) = 0
        or jsonb_typeof(item->'rows') is distinct from 'array' or jsonb_array_length(item->'rows') = 0 then
        raise exception 'Vocabulary table title and rows are required.';
      end if;
      for row in select value from jsonb_array_elements(item->'rows') loop
        if jsonb_typeof(row->'id') is distinct from 'string' or length(btrim(row->>'id')) = 0
          or jsonb_typeof(row->'term') is distinct from 'string' or length(btrim(row->>'term')) = 0
          or jsonb_typeof(row->'definition') is distinct from 'string'
          or jsonb_typeof(row->'example') is distinct from 'string' then
          raise exception 'Each vocabulary row needs an ID and term; definition and example must be text.';
        end if;
      end loop;
    end if;
  end loop;
  select coalesce(jsonb_agg(case when value->>'type'='vocabulary-table'
    then jsonb_build_object('id',value->>'id','type','paragraph','title',value->>'title','body','Vocabulary table')
    else value end), '[]'::jsonb) into safe_items from jsonb_array_elements(p->'instructionalContent');
  sanitized := jsonb_set(p,'{instructionalContent}',safe_items);
  perform public.validate_pre_vocabulary_authored_lesson(sanitized);
end;
$$;
revoke all on function public.validate_legacy_authored_lesson(jsonb) from public, anon, authenticated;

alter function public.compile_legacy_lesson(jsonb,integer) rename to compile_pre_vocabulary_lesson;
create function public.compile_legacy_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare sanitized jsonb; safe_items jsonb;
begin
  select coalesce(jsonb_agg(case when value->>'type'='vocabulary-table'
    then jsonb_build_object('id',value->>'id','type','paragraph','title',value->>'title','body','Vocabulary table')
    else value end), '[]'::jsonb) into safe_items from jsonb_array_elements(p->'instructionalContent');
  sanitized := jsonb_set(p,'{instructionalContent}',safe_items);
  perform public.compile_pre_vocabulary_lesson(sanitized,v);
  select coalesce(jsonb_agg(public.lesson_public_fields(value,
    case when value->>'type'='example' then array['id','type','phrase','expression','note']
      when value->>'type'='vocabulary-table' then array['id','type','title','rows']
      else array['id','type','title','body'] end)), '[]'::jsonb)
  into safe_items from jsonb_array_elements(p->'instructionalContent');
  update public.lesson_definitions definition set presentation = definition.presentation || jsonb_build_object('instructionalContent',safe_items)
  where definition.lesson_id=p->>'id' and definition.content_version=v;
end;
$$;
revoke all on function public.compile_legacy_lesson(jsonb,integer) from public, anon, authenticated;

create or replace function public.compile_chapter_lesson(p jsonb, v integer) returns void
language plpgsql set search_path = '' as $$
declare chapter jsonb; safe_chapter jsonb; safe_chapters jsonb := '[]'; safe_instructions jsonb; safe_activities jsonb; presentation jsonb; flattened jsonb;
begin
  perform public.validate_chapter_authored_lesson(p);
  flattened := public.flatten_lesson_chapters(p);
  perform public.compile_legacy_lesson(flattened,v);
  select definition.presentation into presentation from public.lesson_definitions definition where definition.lesson_id=p->>'id' and definition.content_version=v;
  for chapter in select value from jsonb_array_elements(p->'chapters') order by (value->>'displayOrder')::integer loop
    select coalesce(jsonb_agg(public.lesson_public_fields(value,
      case when value->>'type'='example' then array['id','type','phrase','expression','note']
        when value->>'type'='vocabulary-table' then array['id','type','title','rows']
        else array['id','type','title','body'] end)), '[]'::jsonb)
    into safe_instructions from jsonb_array_elements(chapter->'instructionalContent');
    select coalesce(jsonb_agg(public_activity.value order by authored.ordinality),'[]'::jsonb)
    into safe_activities from jsonb_array_elements(chapter->'activities') with ordinality authored(value,ordinality)
    join jsonb_array_elements(presentation->'activities') public_activity(value) on public_activity.value->>'id'=authored.value->>'id';
    safe_chapter := public.lesson_public_fields(chapter,array['id','title','description','displayOrder'])
      || jsonb_build_object('instructionalContent',safe_instructions,'activities',safe_activities);
    safe_chapters := safe_chapters || jsonb_build_array(safe_chapter);
  end loop;
  update public.lesson_definitions definition set presentation=definition.presentation || jsonb_build_object('chapters',safe_chapters)
  where definition.lesson_id=p->>'id' and definition.content_version=v;
end;
$$;
revoke all on function public.compile_chapter_lesson(jsonb,integer) from public, anon, authenticated;

-- Add the supplied Lesson 1 vocabulary to the draft, then publish it as an immutable new version.
do $$
declare catalog public.lesson_catalog; chapters jsonb; vocabulary jsonb; next_version integer;
begin
  select * into catalog from public.lesson_catalog where lesson_id='lesson-operation-signals' for update;
  if catalog.lesson_id is null then return; end if;
  vocabulary := jsonb_build_object('id','lesson-one-vocabulary','type','vocabulary-table','title','Vocabulary','rows',jsonb_build_array(
    jsonb_build_object('id','constant','term','Constant','definition','A single fixed number','example','(-38, -20, -7, 0, 7, 20, 38)'),
    jsonb_build_object('id','variable','term','Variable','definition','A symbol (usually a letter) representing an unknown value','example','x, n, p'),
    jsonb_build_object('id','coefficient','term','Coefficient','definition','A number multiplied by a variable','example','7 is the coefficient in 7x\n1 is the coefficient in y'),
    jsonb_build_object('id','term','term','Term','definition','A single number, a single variable, or a product of numbers and variables. Terms are separated by addition (+) or subtraction (-) signs.','example','7x, y, and 4 are the terms in (7x + y - 4)'),
    jsonb_build_object('id','base-exponent','term','Base and Exponent','definition','Base represents the number that is multiplied by itself\nExponent represents how many times the base number is multiplied','example','In x³, x is the base and 3 is the exponent'),
    jsonb_build_object('id','quantity','term','Quantity','definition','','example',''),
    jsonb_build_object('id','consecutive-numbers','term','Consecutive numbers','definition','Numbers that follow each other in a regular counting order or pattern. They are written in a series where the difference between the numbers is fixed and where no numbers are skipped in between.','example','(1, 2, 3) are consecutive numbers\n(4, 6, 8) are consecutive even numbers\n(9, 11, 13) are consecutive odd numbers')
  ));
  select jsonb_agg(case when ordinality=1 then chapter || jsonb_build_object('instructionalContent',
    coalesce((select jsonb_agg(value) from jsonb_array_elements(chapter->'instructionalContent') where value->>'id'<>'lesson-one-vocabulary'),'[]'::jsonb) || jsonb_build_array(vocabulary))
    else chapter end order by ordinality)
  into chapters from jsonb_array_elements(catalog.draft->'chapters') with ordinality source(chapter,ordinality);
  update public.lesson_catalog set draft=catalog.draft || jsonb_build_object('chapters',chapters) where lesson_id=catalog.lesson_id returning * into catalog;
  select greatest(coalesce(catalog.published_version,0),coalesce(max(content_version),0))+1 into next_version from public.lesson_definitions where lesson_id=catalog.lesson_id;
  perform public.compile_lesson(catalog.draft,next_version);
  update public.lesson_catalog set published=true,published_version=next_version where lesson_id=catalog.lesson_id;
end;
$$;

create or replace function public.complete_legacy_lesson_attempt(p_attempt_id uuid) returns public.lesson_attempts
language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := (select auth.uid()); current_attempt public.lesson_attempts; definition public.lesson_definitions; current_progress public.lesson_progress; answer_count integer; correct_count integer; computed_score smallint; computed_stars smallint; computed_cleared boolean; next_best_score smallint; next_best_stars smallint; next_xp integer; xp_delta integer;
begin
  if caller_id is null or public.is_researcher() then raise exception 'Student access required.' using errcode='42501'; end if;
  select * into current_attempt from public.lesson_attempts where id=p_attempt_id and user_id=caller_id for update;
  if current_attempt.id is null then raise exception 'Attempt not found.'; end if;
  if current_attempt.status='completed' then return current_attempt; end if;
  if current_attempt.status<>'active' then raise exception 'Attempt cannot be completed.'; end if;
  select * into definition from public.lesson_definitions where lesson_id=current_attempt.lesson_id and content_version=current_attempt.content_version;
  if definition.lesson_id is null then raise exception 'Lesson definition not found.'; end if;
  select count(*),count(*) filter(where answer.submitted_answer=activity.correct_answer) into answer_count,correct_count
  from public.attempt_answers answer join public.lesson_activity_keys activity on activity.lesson_id=current_attempt.lesson_id and activity.content_version=current_attempt.content_version and activity.activity_id=answer.activity_id where answer.attempt_id=p_attempt_id;
  if answer_count<>definition.expected_activity_count then raise exception 'Complete every activity before finishing the lesson.'; end if;
  update public.attempt_answers answer set is_correct=answer.submitted_answer=activity.correct_answer from public.lesson_activity_keys activity
  where answer.attempt_id=p_attempt_id and activity.lesson_id=current_attempt.lesson_id and activity.content_version=current_attempt.content_version and activity.activity_id=answer.activity_id;
  computed_score:=round((correct_count::numeric/definition.expected_activity_count)*100);
  computed_stars:=case when computed_score=100 then 3 when computed_score>=76 then 2 when computed_score>=50 then 1 else 0 end;
  computed_cleared:=computed_score>=definition.passing_threshold;
  select * into current_progress from public.lesson_progress where user_id=caller_id and lesson_id=current_attempt.lesson_id for update;
  if current_progress.user_id is null then raise exception 'Lesson progress not found.'; end if;
  next_best_score:=greatest(current_progress.best_score,computed_score); next_best_stars:=greatest(current_progress.best_star_count,computed_stars); next_xp:=next_best_score+(next_best_stars*10); xp_delta:=greatest(0,next_xp-current_progress.xp_awarded);
  update public.lesson_attempts set status='completed',completed_at=now(),last_updated_at=now(),final_score=computed_score,star_count=computed_stars,cleared=computed_cleared,xp_improvement=xp_delta where id=p_attempt_id returning * into current_attempt;
  update public.lesson_progress set status=case when computed_cleared or current_progress.status='cleared' then 'cleared'::public.lesson_progress_status else 'available'::public.lesson_progress_status end,best_score=next_best_score,best_star_count=next_best_stars,attempt_count=current_progress.attempt_count+1,xp_awarded=greatest(current_progress.xp_awarded,next_xp),last_attempted_at=now(),cleared_at=coalesce(current_progress.cleared_at,case when computed_cleared then now() end) where user_id=caller_id and lesson_id=current_attempt.lesson_id;
  if computed_cleared then insert into public.lesson_progress(user_id,lesson_id,status)
    select caller_id,candidate.lesson_id,'available' from public.lesson_catalog catalog join public.lesson_definitions candidate on (candidate.lesson_id,candidate.content_version)=(catalog.lesson_id,catalog.published_version)
    where catalog.published and candidate.prerequisite_lesson_id=current_attempt.lesson_id
    on conflict(user_id,lesson_id) do update set status=case when public.lesson_progress.status='locked' then 'available'::public.lesson_progress_status else public.lesson_progress.status end;
  end if;
  return current_attempt;
end;
$$;

commit;
