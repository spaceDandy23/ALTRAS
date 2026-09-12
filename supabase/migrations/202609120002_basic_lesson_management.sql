-- Basic authoring; immutable published definitions preserve in-flight attempts.
begin;
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated;
grant select on public.admin_users to authenticated;
create policy "Admins read own membership" on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));
create function public.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table public.lesson_catalog (
  lesson_id text primary key check (lesson_id ~ '^[a-z0-9-]{3,80}$'),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  revision bigint not null default 1,
  published_version integer,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  check (draft ? 'activities' and jsonb_typeof(draft->'activities') = 'array' and jsonb_array_length(draft->'activities') <= 10),
  foreign key (lesson_id, published_version) references public.lesson_definitions(lesson_id, content_version)
);
alter table public.lesson_catalog enable row level security;
revoke all on public.lesson_catalog from public, anon, authenticated;
-- Private presentation snapshot and post-answer feedback accompany existing scoring keys.
alter table public.lesson_definitions add column presentation jsonb;
alter table public.lesson_activity_keys add column feedback jsonb;

create function public.validate_authored_lesson(p jsonb) returns void
language plpgsql set search_path = '' as $$
declare a jsonb; o jsonb; ids text[]; field text; choices jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Invalid lesson.'; end if;
  foreach field in array array['id','title','shortDescription','sectionId','unitId'] loop
    if jsonb_typeof(p->field) is distinct from 'string' or length(btrim(p->>field)) = 0
      or length(p->>field) > 2000 then raise exception 'Lesson % is required (maximum 2000 characters).', field; end if;
  end loop;
  if p->>'id' !~ '^[a-z0-9-]{3,80}$'
    or p->>'sectionId' <> 'section-translating-verbal-expressions'
    or p->>'unitId' <> 'unit-operation-words' then raise exception 'Invalid lesson identity or unit.'; end if;
  if jsonb_typeof(p->'displayOrder') is distinct from 'number' or coalesce(p->>'displayOrder','') !~ '^[0-9]{1,5}$' or (p->>'displayOrder')::integer < 1 then
    raise exception 'Lesson order must be a positive integer.'; end if;
  if jsonb_typeof(p->'passingThreshold') is distinct from 'number' or coalesce(p->>'passingThreshold','') !~ '^[0-9]{1,3}$' or (p->>'passingThreshold')::integer > 100 then
    raise exception 'Passing score must be from 0 to 100.'; end if;
  if jsonb_typeof(p->'activities') is distinct from 'array' then raise exception 'Activities must be an array.'; end if;
  if jsonb_array_length(p->'activities') not between 1 and 10 then raise exception 'A published lesson requires 1 to 10 activities.'; end if;
  if jsonb_typeof(p->'instructionalContent') is distinct from 'array'
    or jsonb_typeof(p->'concepts') is distinct from 'array' or jsonb_array_length(p->'concepts') = 0 then
    raise exception 'Invalid lesson instructions or concepts.'; end if;
  if exists(select 1 from jsonb_array_elements(p->'concepts') c where jsonb_typeof(c) <> 'string' or length(btrim(c#>>'{}')) = 0) then
    raise exception 'Concepts must contain text.'; end if;
  if p ? 'prerequisiteLessonId' and (jsonb_typeof(p->'prerequisiteLessonId') is distinct from 'string' or coalesce(p->>'prerequisiteLessonId','') !~ '^[a-z0-9-]{3,80}$') then
    raise exception 'Invalid prerequisite ID.'; end if;
  if p ? 'characterId' and (jsonb_typeof(p->'characterId') is distinct from 'string' or length(btrim(p->>'characterId')) = 0) then
    raise exception 'Invalid character ID.'; end if;
  -- Optional dialogue must also satisfy the player contract. No new dialogue system.
  for o in select value from jsonb_array_elements(jsonb_build_array(p) || (p->'activities')) loop
    if o ? 'characterDialogue' then
      if jsonb_typeof(o->'characterDialogue') is distinct from 'object' then raise exception 'Invalid character dialogue.'; end if;
      if exists(select 1 from jsonb_each(o->'characterDialogue') d where jsonb_typeof(d.value) <> 'string' or length(btrim(d.value#>>'{}')) = 0) then
        raise exception 'Character dialogue must contain text.'; end if;
    end if;
  end loop;
  ids := array[]::text[];
  for a in select value from jsonb_array_elements(p->'instructionalContent') loop
    if coalesce(a->>'type','') not in ('paragraph','example','warning') then raise exception 'Invalid instruction type.'; end if;
    foreach field in array case when a->>'type' = 'example' then array['id','phrase','expression','note'] else array['id','title','body'] end loop
      if jsonb_typeof(a->field) is distinct from 'string' or length(btrim(a->>field)) = 0 then raise exception 'Instruction % is required.', field; end if;
    end loop;
    if a->>'id' = any(ids) then raise exception 'Content IDs must be unique.'; end if;
    ids := array_append(ids, a->>'id');
  end loop;
  for a in select value from jsonb_array_elements(p->'activities') loop
    if coalesce(a->>'type','') not in ('find-word','organize-translate') then raise exception 'Unsupported activity type.'; end if;
    foreach field in array array['id','title','prompt','mathStatement'] loop
      if jsonb_typeof(a->field) is distinct from 'string' or length(btrim(a->>field)) = 0 or length(a->>field) > 2000 then
        raise exception 'Activity % is required (maximum 2000 characters).', field; end if;
    end loop;
    if a->>'id' = any(ids) then raise exception 'Content IDs must be unique.'; end if;
    ids := array_append(ids, a->>'id');
    if jsonb_typeof(a#>'{explanation,title}') is distinct from 'string' or jsonb_typeof(a#>'{explanation,body}') is distinct from 'string'
      or coalesce(length(btrim(a#>>'{explanation,title}')),0) = 0 or coalesce(length(btrim(a#>>'{explanation,body}')),0) = 0 then
      raise exception 'Feedback title and explanation are required.'; end if;
    if a ? 'hint' and (jsonb_typeof(a#>'{hint,body}') is distinct from 'string' or coalesce(length(btrim(a#>>'{hint,body}')),0) = 0) then raise exception 'Hint must contain text.'; end if;
    choices := case when a->>'type' = 'find-word' then a->'choices' else a->'tokens' end;
    if jsonb_typeof(choices) is distinct from 'array' then raise exception 'Choices or tokens are required.'; end if;
    if jsonb_array_length(choices) not between 2 and 20 then raise exception 'Use 2 to 20 choices or tokens.'; end if;
    for o in select value from jsonb_array_elements(choices) loop
      if jsonb_typeof(o->'id') is distinct from 'string' or coalesce(length(btrim(o->>'id')),0) = 0
        or jsonb_typeof(o->'label') is distinct from 'string' or coalesce(length(btrim(o->>'label')),0) = 0 then raise exception 'Each choice/token needs an ID and label.'; end if;
    end loop;
    if (select count(distinct value->>'id') from jsonb_array_elements(choices)) <> jsonb_array_length(choices) then raise exception 'Choice/token IDs must be unique.'; end if;
    if a->>'type' = 'find-word' then
      if jsonb_typeof(a->'sentenceBefore') is distinct from 'string' or jsonb_typeof(a->'sentenceAfter') is distinct from 'string'
        or jsonb_typeof(a->'correctChoiceId') is distinct from 'string'
        or not exists(select 1 from jsonb_array_elements(choices) c where c->>'id' = a->>'correctChoiceId') then raise exception 'Choose a valid correct answer and sentence.'; end if;
    else
      if jsonb_typeof(a->'correctTokenSequence') is distinct from 'array' then raise exception 'Correct token order is required.'; end if;
      if jsonb_array_length(a->'correctTokenSequence') <> jsonb_array_length(choices)
        or (select count(distinct value) from jsonb_array_elements(a->'correctTokenSequence')) <> jsonb_array_length(choices)
        or exists(select 1 from jsonb_array_elements(a->'correctTokenSequence') s where jsonb_typeof(s) <> 'string'
          or not exists(select 1 from jsonb_array_elements(choices) c where c->>'id' = s#>>'{}')) then raise exception 'Correct order must use every token exactly once.'; end if;
    end if;
  end loop;
end;
$$;
revoke all on function public.validate_authored_lesson(jsonb) from public, anon, authenticated;

-- Private compiler is also used once to seed the unchanged Lessons 1–2.
create function public.lesson_public_fields(doc jsonb, fields text[]) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(doc) where key = any(fields);
$$;
revoke all on function public.lesson_public_fields(jsonb,text[]) from public, anon, authenticated;

create function public.compile_lesson(p jsonb, v integer) returns void language plpgsql set search_path = '' as $$
declare a jsonb; safe_activity jsonb; safe_activities jsonb := '[]'; presentation jsonb;
begin
  perform public.validate_authored_lesson(p);
  for a in select value from jsonb_array_elements(p->'activities') loop
    select jsonb_object_agg(key,value) into safe_activity from jsonb_each(a)
      where key in ('id','type','title','prompt','mathStatement','sentenceBefore','sentenceAfter');
    safe_activity := safe_activity || jsonb_build_object(
      case when a->>'type'='find-word' then 'choices' else 'tokens' end,
      (select jsonb_agg(public.lesson_public_fields(value,array['id','label'])) from jsonb_array_elements(
        case when a->>'type'='find-word' then a->'choices' else a->'tokens' end))
    ) || case when a ? 'hint' then jsonb_build_object('hint',public.lesson_public_fields(a->'hint',array['body'])) else '{}'::jsonb end;
    safe_activities := safe_activities || jsonb_build_array(
      safe_activity
      || jsonb_build_object('explanation', jsonb_build_object('title','Answer feedback','body','Submit your answer to see the explanation.'))
      || case when a ? 'characterDialogue' then jsonb_build_object('characterDialogue', public.lesson_public_fields(a->'characterDialogue',array['introduction','hint','encouragement'])) else '{}'::jsonb end
    );
  end loop;
  select jsonb_object_agg(key,value) into presentation from jsonb_each(p)
    where key in ('id','title','shortDescription','sectionId','unitId','concepts','displayOrder','prerequisiteLessonId','characterId');
  presentation := presentation || jsonb_build_object('instructionalContent',
    coalesce((select jsonb_agg(public.lesson_public_fields(value,
      case when value->>'type'='example' then array['id','type','phrase','expression','note'] else array['id','type','title','body'] end))
      from jsonb_array_elements(p->'instructionalContent')),'[]'::jsonb))
    || case when p ? 'characterDialogue' then jsonb_build_object('characterDialogue',public.lesson_public_fields(p->'characterDialogue',array['introduction','completion'])) else '{}'::jsonb end;
  presentation := presentation || jsonb_build_object('activities',safe_activities,'contentVersion',v,'contentStatus','playable','passingThreshold',(p->>'passingThreshold')::integer);
  insert into public.lesson_definitions (lesson_id,content_version,expected_activity_count,passing_threshold,prerequisite_lesson_id,presentation)
  values(p->>'id',v,jsonb_array_length(p->'activities'),(p->>'passingThreshold')::integer,nullif(p->>'prerequisiteLessonId',''),presentation)
  on conflict(lesson_id,content_version) do update set presentation = excluded.presentation;
  for a in select value from jsonb_array_elements(p->'activities') loop
    insert into public.lesson_activity_keys (lesson_id,content_version,activity_id,activity_type,answer_options,correct_answer,feedback)
    values(p->>'id',v,a->>'id',a->>'type',
      (select jsonb_agg(c->'id') from jsonb_array_elements(case when a->>'type' = 'find-word' then a->'choices' else a->'tokens' end) c),
      case when a->>'type' = 'find-word' then a->'correctChoiceId' else a->'correctTokenSequence' end,
      jsonb_build_object('explanation',a->'explanation') || case when a ? 'characterDialogue' then jsonb_build_object('characterDialogue',a->'characterDialogue') else '{}'::jsonb end
    ) on conflict(lesson_id,content_version,activity_id) do update set feedback = excluded.feedback;
  end loop;
end;
$$;
revoke all on function public.compile_lesson(jsonb,integer) from public, anon, authenticated;

select public.compile_lesson('{"id":"lesson-operation-signals","sectionId":"section-translating-verbal-expressions","unitId":"unit-operation-words","title":"Words That Signal Operations","shortDescription":"Connect common verbal phrases with addition, subtraction, multiplication, and division.","concepts":["Operation keywords","Verbal expressions","Order-sensitive phrases"],"displayOrder":1,"contentStatus":"playable","passingThreshold":70,"contentVersion":1,"instructionalContent":[{"id":"intro-operation-signals","type":"paragraph","title":"Words can signal an operation","body":"A verbal expression describes mathematics using words. Signal words help us decide which operation to use, but we must also read the order carefully."},{"id":"example-sum","type":"example","phrase":"the sum of a number and five","expression":"n + 5","note":"Sum, plus, added to, and increased by commonly signal addition."},{"id":"example-difference","type":"example","phrase":"the difference of twelve and a number","expression":"12 − n","note":"Difference and minus signal subtraction. Keep the named order."},{"id":"example-product","type":"example","phrase":"the product of three and a number","expression":"3n","note":"Product, times, multiplied by, and of can signal multiplication."},{"id":"example-quotient","type":"example","phrase":"the quotient of a number and four","expression":"n ÷ 4","note":"Quotient, divided by, and per can signal division. Order matters."},{"id":"warning-less-than","type":"warning","title":"Watch “less than” and “subtracted from”","body":"These phrases reverse the apparent order: “six less than a number” is n − 6, and “a number subtracted from twelve” is 12 − n."}],"activities":[{"id":"find-sum","type":"find-word","title":"Find the addition word","prompt":"Choose the word that makes the verbal phrase match the expression.","mathStatement":"8 + n","sentenceBefore":"The","sentenceAfter":"of eight and a number","choices":[{"id":"sum","label":"sum"},{"id":"difference","label":"difference"},{"id":"product","label":"product"}],"correctChoiceId":"sum","hint":{"body":"Which operation does the plus sign show?"},"explanation":{"title":"Correct word: sum","body":"“Sum” names the result of addition, so the sum of eight and a number is 8 + n."}},{"id":"find-product","type":"find-word","title":"Find the multiplication word","prompt":"Choose the operation word that describes the expression.","mathStatement":"5x","sentenceBefore":"The","sentenceAfter":"of five and a number","choices":[{"id":"quotient","label":"quotient"},{"id":"product","label":"product"},{"id":"difference","label":"difference"}],"correctChoiceId":"product","hint":{"body":"A number written beside a variable means multiplication."},"explanation":{"title":"Correct word: product","body":"“Product” signals multiplication. The product of five and x is 5x."}},{"id":"find-quotient","type":"find-word","title":"Find the division word","prompt":"Complete the phrase so it describes the expression precisely.","mathStatement":"n ÷ 4","sentenceBefore":"The","sentenceAfter":"of a number and four","choices":[{"id":"sum","label":"sum"},{"id":"quotient","label":"quotient"},{"id":"product","label":"product"}],"correctChoiceId":"quotient","hint":{"body":"The expression divides a number by four."},"explanation":{"title":"Correct word: quotient","body":"“Quotient” names a division result. The quotient of n and 4 keeps n first: n ÷ 4."}},{"id":"organize-less-than","type":"organize-translate","title":"Put “less than” in order","prompt":"Build the verbal phrase that matches the expression.","mathStatement":"n − 6","tokens":[{"id":"number","label":"a number"},{"id":"six","label":"six"},{"id":"less-than","label":"less than"}],"correctTokenSequence":["six","less-than","number"],"hint":{"body":"Read n − 6 as six fewer than n."},"explanation":{"title":"Order reversed correctly","body":"“Six less than a number” means begin with the number, then subtract six: n − 6."}},{"id":"organize-subtracted-from","type":"organize-translate","title":"Translate “subtracted from”","prompt":"Arrange every token into a mathematically precise phrase.","mathStatement":"12 − y","tokens":[{"id":"twelve","label":"twelve"},{"id":"a-number","label":"a number"},{"id":"subtracted-from","label":"subtracted from"}],"correctTokenSequence":["a-number","subtracted-from","twelve"],"hint":{"body":"The quantity after “from” is written first in the expression."},"explanation":{"title":"“From” changes the order","body":"“A number subtracted from twelve” starts with twelve and removes the number: 12 − y."}},{"id":"organize-sum-product","type":"organize-translate","title":"Combine two operation signals","prompt":"Build the complete phrase for the expression.","mathStatement":"3m + 7","tokens":[{"id":"seven","label":"seven"},{"id":"and","label":"and"},{"id":"three-times","label":"three times a number"},{"id":"sum-of","label":"the sum of"}],"correctTokenSequence":["sum-of","three-times","and","seven"],"hint":{"body":"Name the outer addition first, then describe both terms."},"explanation":{"title":"Two signals, one expression","body":"“The sum of” joins 3m and 7. “Three times a number” describes the product 3m."}}]}'::jsonb, 1);
insert into public.lesson_catalog(lesson_id,draft,published_version,published) values ('lesson-operation-signals','{"id":"lesson-operation-signals","sectionId":"section-translating-verbal-expressions","unitId":"unit-operation-words","title":"Words That Signal Operations","shortDescription":"Connect common verbal phrases with addition, subtraction, multiplication, and division.","concepts":["Operation keywords","Verbal expressions","Order-sensitive phrases"],"displayOrder":1,"contentStatus":"playable","passingThreshold":70,"contentVersion":1,"instructionalContent":[{"id":"intro-operation-signals","type":"paragraph","title":"Words can signal an operation","body":"A verbal expression describes mathematics using words. Signal words help us decide which operation to use, but we must also read the order carefully."},{"id":"example-sum","type":"example","phrase":"the sum of a number and five","expression":"n + 5","note":"Sum, plus, added to, and increased by commonly signal addition."},{"id":"example-difference","type":"example","phrase":"the difference of twelve and a number","expression":"12 − n","note":"Difference and minus signal subtraction. Keep the named order."},{"id":"example-product","type":"example","phrase":"the product of three and a number","expression":"3n","note":"Product, times, multiplied by, and of can signal multiplication."},{"id":"example-quotient","type":"example","phrase":"the quotient of a number and four","expression":"n ÷ 4","note":"Quotient, divided by, and per can signal division. Order matters."},{"id":"warning-less-than","type":"warning","title":"Watch “less than” and “subtracted from”","body":"These phrases reverse the apparent order: “six less than a number” is n − 6, and “a number subtracted from twelve” is 12 − n."}],"activities":[{"id":"find-sum","type":"find-word","title":"Find the addition word","prompt":"Choose the word that makes the verbal phrase match the expression.","mathStatement":"8 + n","sentenceBefore":"The","sentenceAfter":"of eight and a number","choices":[{"id":"sum","label":"sum"},{"id":"difference","label":"difference"},{"id":"product","label":"product"}],"correctChoiceId":"sum","hint":{"body":"Which operation does the plus sign show?"},"explanation":{"title":"Correct word: sum","body":"“Sum” names the result of addition, so the sum of eight and a number is 8 + n."}},{"id":"find-product","type":"find-word","title":"Find the multiplication word","prompt":"Choose the operation word that describes the expression.","mathStatement":"5x","sentenceBefore":"The","sentenceAfter":"of five and a number","choices":[{"id":"quotient","label":"quotient"},{"id":"product","label":"product"},{"id":"difference","label":"difference"}],"correctChoiceId":"product","hint":{"body":"A number written beside a variable means multiplication."},"explanation":{"title":"Correct word: product","body":"“Product” signals multiplication. The product of five and x is 5x."}},{"id":"find-quotient","type":"find-word","title":"Find the division word","prompt":"Complete the phrase so it describes the expression precisely.","mathStatement":"n ÷ 4","sentenceBefore":"The","sentenceAfter":"of a number and four","choices":[{"id":"sum","label":"sum"},{"id":"quotient","label":"quotient"},{"id":"product","label":"product"}],"correctChoiceId":"quotient","hint":{"body":"The expression divides a number by four."},"explanation":{"title":"Correct word: quotient","body":"“Quotient” names a division result. The quotient of n and 4 keeps n first: n ÷ 4."}},{"id":"organize-less-than","type":"organize-translate","title":"Put “less than” in order","prompt":"Build the verbal phrase that matches the expression.","mathStatement":"n − 6","tokens":[{"id":"number","label":"a number"},{"id":"six","label":"six"},{"id":"less-than","label":"less than"}],"correctTokenSequence":["six","less-than","number"],"hint":{"body":"Read n − 6 as six fewer than n."},"explanation":{"title":"Order reversed correctly","body":"“Six less than a number” means begin with the number, then subtract six: n − 6."}},{"id":"organize-subtracted-from","type":"organize-translate","title":"Translate “subtracted from”","prompt":"Arrange every token into a mathematically precise phrase.","mathStatement":"12 − y","tokens":[{"id":"twelve","label":"twelve"},{"id":"a-number","label":"a number"},{"id":"subtracted-from","label":"subtracted from"}],"correctTokenSequence":["a-number","subtracted-from","twelve"],"hint":{"body":"The quantity after “from” is written first in the expression."},"explanation":{"title":"“From” changes the order","body":"“A number subtracted from twelve” starts with twelve and removes the number: 12 − y."}},{"id":"organize-sum-product","type":"organize-translate","title":"Combine two operation signals","prompt":"Build the complete phrase for the expression.","mathStatement":"3m + 7","tokens":[{"id":"seven","label":"seven"},{"id":"and","label":"and"},{"id":"three-times","label":"three times a number"},{"id":"sum-of","label":"the sum of"}],"correctTokenSequence":["sum-of","three-times","and","seven"],"hint":{"body":"Name the outer addition first, then describe both terms."},"explanation":{"title":"Two signals, one expression","body":"“The sum of” joins 3m and 7. “Three times a number” describes the product 3m."}}]}'::jsonb,1,true);
select public.compile_lesson('{"id":"lesson-order-matters","sectionId":"section-translating-verbal-expressions","unitId":"unit-operation-words","title":"Order Matters","shortDescription":"Practice phrases whose word order changes the mathematical expression.","concepts":["Less than","Subtracted from","More than","Difference in named order"],"displayOrder":2,"prerequisiteLessonId":"lesson-operation-signals","contentStatus":"playable","passingThreshold":70,"contentVersion":2,"instructionalContent":[{"id":"intro-order-sensitive-phrases","type":"paragraph","title":"Read order-sensitive phrases carefully","body":"Some verbal phrases name quantities in a different order from the mathematical expression. Identify the operation phrase, then decide which quantity must be written first."},{"id":"example-six-less-than","type":"example","phrase":"six less than a number","expression":"n − 6","note":"“Less than” subtracts the first quantity from the quantity named afterward."},{"id":"example-subtracted-from-twelve","type":"example","phrase":"a number subtracted from twelve","expression":"12 − n","note":"“Subtracted from” reverses the apparent spoken order."},{"id":"example-four-more-than-twice","type":"example","phrase":"four more than twice a number","expression":"2n + 4","note":"“More than” adds to the quantity named afterward."},{"id":"example-difference-twelve-number","type":"example","phrase":"the difference of twelve and a number","expression":"12 − n","note":"“The difference of A and B” preserves the named order as A − B."},{"id":"warning-check-subtraction-order","type":"warning","title":"Check which quantity comes first","body":"For “less than” and “subtracted from,” the quantity named afterward is written first. “More than” adds to the quantity named afterward. “The difference of A and B” keeps A first and B second."}],"activities":[{"id":"order-find-less-than","type":"find-word","title":"Find the order-sensitive word","prompt":"Choose the word that makes the phrase match the expression.","mathStatement":"n − 6","sentenceBefore":"Six","sentenceAfter":"than a number","choices":[{"id":"less","label":"less"},{"id":"more","label":"more"},{"id":"times","label":"times"}],"correctChoiceId":"less","hint":{"body":"Start with n and subtract six."},"explanation":{"title":"Correct word: less","body":"“Six less than a number” means start with n and subtract six: n − 6."}},{"id":"order-find-subtracted-from","type":"find-word","title":"Find the reversal phrase","prompt":"Choose the word that makes the phrase match the expression.","mathStatement":"12 − n","sentenceBefore":"A number","sentenceAfter":"from twelve","choices":[{"id":"added","label":"added"},{"id":"subtracted","label":"subtracted"},{"id":"multiplied","label":"multiplied"}],"correctChoiceId":"subtracted","hint":{"body":"The quantity after “from” is written first."},"explanation":{"title":"Correct word: subtracted","body":"“A number subtracted from twelve” starts with twelve and removes n, so it is 12 − n, not n − 12."}},{"id":"order-organize-less-than","type":"organize-translate","title":"Order a less-than phrase","prompt":"Arrange the tokens into the phrase that matches the expression.","mathStatement":"n − 5","tokens":[{"id":"number","label":"a number"},{"id":"less-than","label":"less than"},{"id":"five","label":"five"}],"correctTokenSequence":["five","less-than","number"],"hint":{"body":"The phrase begins with the amount being subtracted."},"explanation":{"title":"The number after “less than” comes first","body":"“Five less than a number” is n − 5 because the value following “less than” comes first in the expression."}},{"id":"order-organize-subtracted-from","type":"organize-translate","title":"Order a subtracted-from phrase","prompt":"Arrange the tokens into the phrase that matches the expression.","mathStatement":"12 − n","tokens":[{"id":"twelve","label":"twelve"},{"id":"subtracted-from","label":"subtracted from"},{"id":"a-number","label":"a number"}],"correctTokenSequence":["a-number","subtracted-from","twelve"],"hint":{"body":"“From twelve” tells you that twelve is written first."},"explanation":{"title":"“Subtracted from” reverses the order","body":"“A number subtracted from twelve” means begin with twelve, then subtract n: 12 − n."}},{"id":"order-organize-more-than","type":"organize-translate","title":"Order a more-than phrase","prompt":"Arrange the tokens into the phrase that matches the expression.","mathStatement":"2n + 4","tokens":[{"id":"twice-number","label":"twice a number"},{"id":"four","label":"four"},{"id":"more-than","label":"more than"}],"correctTokenSequence":["four","more-than","twice-number"],"hint":{"body":"First identify 2n, then add four."},"explanation":{"title":"Add four to twice the number","body":"“Twice a number” is 2n. “Four more than” tells us to add four, giving 2n + 4."}}]}'::jsonb, 2);
insert into public.lesson_catalog(lesson_id,draft,published_version,published) values ('lesson-order-matters','{"id":"lesson-order-matters","sectionId":"section-translating-verbal-expressions","unitId":"unit-operation-words","title":"Order Matters","shortDescription":"Practice phrases whose word order changes the mathematical expression.","concepts":["Less than","Subtracted from","More than","Difference in named order"],"displayOrder":2,"prerequisiteLessonId":"lesson-operation-signals","contentStatus":"playable","passingThreshold":70,"contentVersion":2,"instructionalContent":[{"id":"intro-order-sensitive-phrases","type":"paragraph","title":"Read order-sensitive phrases carefully","body":"Some verbal phrases name quantities in a different order from the mathematical expression. Identify the operation phrase, then decide which quantity must be written first."},{"id":"example-six-less-than","type":"example","phrase":"six less than a number","expression":"n − 6","note":"“Less than” subtracts the first quantity from the quantity named afterward."},{"id":"example-subtracted-from-twelve","type":"example","phrase":"a number subtracted from twelve","expression":"12 − n","note":"“Subtracted from” reverses the apparent spoken order."},{"id":"example-four-more-than-twice","type":"example","phrase":"four more than twice a number","expression":"2n + 4","note":"“More than” adds to the quantity named afterward."},{"id":"example-difference-twelve-number","type":"example","phrase":"the difference of twelve and a number","expression":"12 − n","note":"“The difference of A and B” preserves the named order as A − B."},{"id":"warning-check-subtraction-order","type":"warning","title":"Check which quantity comes first","body":"For “less than” and “subtracted from,” the quantity named afterward is written first. “More than” adds to the quantity named afterward. “The difference of A and B” keeps A first and B second."}],"activities":[{"id":"order-find-less-than","type":"find-word","title":"Find the order-sensitive word","prompt":"Choose the word that makes the phrase match the expression.","mathStatement":"n − 6","sentenceBefore":"Six","sentenceAfter":"than a number","choices":[{"id":"less","label":"less"},{"id":"more","label":"more"},{"id":"times","label":"times"}],"correctChoiceId":"less","hint":{"body":"Start with n and subtract six."},"explanation":{"title":"Correct word: less","body":"“Six less than a number” means start with n and subtract six: n − 6."}},{"id":"order-find-subtracted-from","type":"find-word","title":"Find the reversal phrase","prompt":"Choose the word that makes the phrase match the expression.","mathStatement":"12 − n","sentenceBefore":"A number","sentenceAfter":"from twelve","choices":[{"id":"added","label":"added"},{"id":"subtracted","label":"subtracted"},{"id":"multiplied","label":"multiplied"}],"correctChoiceId":"subtracted","hint":{"body":"The quantity after “from” is written first."},"explanation":{"title":"Correct word: subtracted","body":"“A number subtracted from twelve” starts with twelve and removes n, so it is 12 − n, not n − 12."}},{"id":"order-organize-less-than","type":"organize-translate","title":"Order a less-than phrase","prompt":"Arrange the tokens into the phrase that matches the expression.","mathStatement":"n − 5","tokens":[{"id":"number","label":"a number"},{"id":"less-than","label":"less than"},{"id":"five","label":"five"}],"correctTokenSequence":["five","less-than","number"],"hint":{"body":"The phrase begins with the amount being subtracted."},"explanation":{"title":"The number after “less than” comes first","body":"“Five less than a number” is n − 5 because the value following “less than” comes first in the expression."}},{"id":"order-organize-subtracted-from","type":"organize-translate","title":"Order a subtracted-from phrase","prompt":"Arrange the tokens into the phrase that matches the expression.","mathStatement":"12 − n","tokens":[{"id":"twelve","label":"twelve"},{"id":"subtracted-from","label":"subtracted from"},{"id":"a-number","label":"a number"}],"correctTokenSequence":["a-number","subtracted-from","twelve"],"hint":{"body":"“From twelve” tells you that twelve is written first."},"explanation":{"title":"“Subtracted from” reverses the order","body":"“A number subtracted from twelve” means begin with twelve, then subtract n: 12 − n."}},{"id":"order-organize-more-than","type":"organize-translate","title":"Order a more-than phrase","prompt":"Arrange the tokens into the phrase that matches the expression.","mathStatement":"2n + 4","tokens":[{"id":"twice-number","label":"twice a number"},{"id":"four","label":"four"},{"id":"more-than","label":"more than"}],"correctTokenSequence":["four","more-than","twice-number"],"hint":{"body":"First identify 2n, then add four."},"explanation":{"title":"Add four to twice the number","body":"“Twice a number” is 2n. “Four more than” tells us to add four, giving 2n + 4."}}]}'::jsonb,2,true);

create function public.get_admin_lessons() returns setof public.lesson_catalog
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  return query select * from public.lesson_catalog order by (draft->>'displayOrder')::integer,lesson_id;
end;
$$;

create function public.save_admin_lesson(p_lesson jsonb, p_revision bigint) returns public.lesson_catalog
language plpgsql security definer set search_path = '' as $$
declare existing public.lesson_catalog; result public.lesson_catalog; prereq text; path text[]; cursor_id text;
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(20260912, 2);
  if p_lesson is null or jsonb_typeof(p_lesson) <> 'object' or length(p_lesson::text) > 100000 then raise exception 'Invalid or oversized lesson.'; end if;
  if coalesce(p_lesson->>'id','') !~ '^[a-z0-9-]{3,80}$' or coalesce(length(btrim(p_lesson->>'title')),0) = 0 then raise exception 'Lesson ID and title are required.'; end if;
  if coalesce(p_lesson->>'displayOrder','') !~ '^[0-9]{1,5}$' or (p_lesson->>'displayOrder')::integer < 1 then raise exception 'Lesson order must be a positive integer.'; end if;
  if jsonb_typeof(p_lesson->'activities') is distinct from 'array' then raise exception 'Activities must be an array.'; end if;
  if jsonb_array_length(p_lesson->'activities') > 10 then raise exception 'A lesson supports at most 10 activities.'; end if;
  select * into existing from public.lesson_catalog where lesson_id = p_lesson->>'id';
  if (existing.lesson_id is null and p_revision is distinct from 0) or (existing.lesson_id is not null and p_revision is distinct from existing.revision) then
    raise exception 'This lesson changed in another session. Reload before saving.' using errcode = '40001'; end if;
  prereq := nullif(p_lesson->>'prerequisiteLessonId','');
  path := array[p_lesson->>'id']; cursor_id := prereq;
  while cursor_id is not null loop
    if cursor_id = any(path) then raise exception 'Prerequisites cannot contain a cycle or the lesson itself.'; end if;
    path := array_append(path,cursor_id);
    if not exists(select 1 from public.lesson_catalog where lesson_id = cursor_id) then raise exception 'Prerequisite lesson does not exist.'; end if;
    select nullif(draft->>'prerequisiteLessonId','') into cursor_id from public.lesson_catalog where lesson_id = cursor_id;
  end loop;
  insert into public.lesson_catalog(lesson_id,draft) values(p_lesson->>'id',p_lesson)
    on conflict(lesson_id) do update set draft = excluded.draft, revision = public.lesson_catalog.revision + 1, updated_at = now()
    returning * into result;
  return result;
end;
$$;

create function public.set_lesson_publication(p_lesson_id text, p_publish boolean, p_revision bigint) returns public.lesson_catalog
language plpgsql security definer set search_path = '' as $$
declare item public.lesson_catalog; result public.lesson_catalog; v integer; prereq text; current_prereq text; cursor_id text; path text[];
begin
  if (select auth.uid()) is null or not public.is_admin() then raise exception 'Admin access required.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(20260912, 2);
  select * into item from public.lesson_catalog where lesson_id = p_lesson_id for update;
  if item.lesson_id is null or p_publish is null then raise exception 'Lesson not found.'; end if;
  if p_revision is distinct from item.revision then raise exception 'This lesson changed in another session. Reload before publishing.' using errcode = '40001'; end if;
  if not p_publish then
    if exists(select 1 from public.lesson_catalog c join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
      where c.published and d.prerequisite_lesson_id = p_lesson_id) then raise exception 'Unpublish dependent lessons first.'; end if;
  else
    perform public.validate_authored_lesson(item.draft);
    prereq := nullif(item.draft->>'prerequisiteLessonId','');
    path := array[p_lesson_id]; cursor_id := prereq;
    while cursor_id is not null loop
      if cursor_id = any(path) then raise exception 'Prerequisites cannot contain a cycle.'; end if;
      path := array_append(path,cursor_id);
      if not exists(select 1 from public.lesson_catalog where lesson_id=cursor_id and published) then raise exception 'Publish the prerequisite first.'; end if;
      select d.prerequisite_lesson_id into cursor_id from public.lesson_catalog c join public.lesson_definitions d
        on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version) where c.lesson_id=cursor_id;
    end loop;
    if exists(select 1 from public.lesson_catalog c join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
      where c.published and c.lesson_id <> p_lesson_id and (d.presentation->>'displayOrder')::integer = (item.draft->>'displayOrder')::integer) then raise exception 'Published lesson order must be unique.'; end if;
    if exists(select 1 from public.lesson_catalog c join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
      where c.published and ((c.lesson_id=prereq and (d.presentation->>'displayOrder')::integer >= (item.draft->>'displayOrder')::integer)
      or (d.prerequisite_lesson_id=p_lesson_id and (d.presentation->>'displayOrder')::integer <= (item.draft->>'displayOrder')::integer))) then raise exception 'Prerequisites must appear before their dependent lessons.'; end if;
    select prerequisite_lesson_id into current_prereq from public.lesson_definitions where lesson_id=p_lesson_id and content_version=item.published_version;
    if current_prereq is distinct from prereq and exists(select 1 from public.lesson_attempts where lesson_id=p_lesson_id) then raise exception 'Cannot change the prerequisite after students have started this lesson.'; end if;
    select coalesce(max(content_version),0)+1 into v from public.lesson_definitions where lesson_id=p_lesson_id;
    perform public.compile_lesson(item.draft,v);
  end if;
  update public.lesson_catalog set published=p_publish, published_version=case when p_publish then v else published_version end,
    revision=revision+1, updated_at=now() where lesson_id=p_lesson_id returning * into result;
  return result;
end;
$$;

create function public.get_lesson_catalog() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or public.is_researcher() then raise exception 'Student access required.' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(d.presentation order by (d.presentation->>'displayOrder')::integer,c.lesson_id)
    from public.lesson_catalog c join public.lesson_definitions d on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
    where c.published),'[]'::jsonb);
end;
$$;

create function public.get_lesson_content(p_lesson_id text, p_attempt_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v integer; doc jsonb; activities jsonb := '[]'; a jsonb; response jsonb; answer jsonb;
begin
  if (select auth.uid()) is null or public.is_researcher() then raise exception 'Student access required.' using errcode='42501'; end if;
  if p_attempt_id is not null then
    select content_version into v from public.lesson_attempts where id=p_attempt_id and lesson_id=p_lesson_id and user_id=(select auth.uid());
  else
    select published_version into v from public.lesson_catalog where lesson_id=p_lesson_id and published;
  end if;
  select presentation into doc from public.lesson_definitions where lesson_id=p_lesson_id and content_version=v;
  if doc is null then raise exception 'This lesson is unavailable.'; end if;
  for a in select value from jsonb_array_elements(doc->'activities') loop
    -- Release only this student's already-submitted activity feedback, never a key list.
    if p_attempt_id is not null and exists(select 1 from public.attempt_answers where attempt_id=p_attempt_id and activity_id=a->>'id') then
      select feedback,correct_answer into response,answer from public.lesson_activity_keys where lesson_id=p_lesson_id and content_version=v and activity_id=a->>'id';
      a := a || response;
      if a->>'type'='find-word' then a := a || jsonb_build_object('correctChoiceId',answer); end if;
    end if;
    activities := activities || jsonb_build_array(a);
  end loop;
  return doc || jsonb_build_object('activities',activities);
end;
$$;

revoke all on function public.get_admin_lessons(), public.save_admin_lesson(jsonb,bigint), public.set_lesson_publication(text,boolean,bigint), public.get_lesson_catalog(), public.get_lesson_content(text,uuid) from public, anon;
grant execute on function public.get_admin_lessons(), public.save_admin_lesson(jsonb,bigint), public.set_lesson_publication(text,boolean,bigint), public.get_lesson_catalog(), public.get_lesson_content(text,uuid) to authenticated;

create or replace function public.initialize_lesson_progress()
returns setof public.lesson_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  insert into public.lesson_progress (user_id, lesson_id, status)
  select
    caller_id,
    lesson.lesson_id,
    case
      when lesson.prerequisite_lesson_id is null then 'available'::public.lesson_progress_status
      when exists (
        select 1 from public.lesson_progress prerequisite
        where prerequisite.user_id = caller_id
          and prerequisite.lesson_id = lesson.prerequisite_lesson_id
          and prerequisite.status = 'cleared'
      ) then 'available'::public.lesson_progress_status
      else 'locked'::public.lesson_progress_status
    end
  from (
    select definition.* from public.lesson_catalog catalog join public.lesson_definitions definition
      on (definition.lesson_id,definition.content_version)=(catalog.lesson_id,catalog.published_version)
    where catalog.published
  ) lesson
  on conflict (user_id, lesson_id) do nothing;

  update public.lesson_progress progress
  set status = case when lesson.prerequisite_lesson_id is null or exists (
    select 1 from public.lesson_progress prerequisite
    where prerequisite.user_id = caller_id and prerequisite.lesson_id = lesson.prerequisite_lesson_id
      and prerequisite.status = 'cleared'
  ) then 'available'::public.lesson_progress_status else 'locked'::public.lesson_progress_status end
  from (
    select definition.* from public.lesson_catalog catalog join public.lesson_definitions definition
      on (definition.lesson_id,definition.content_version)=(catalog.lesson_id,catalog.published_version)
    where catalog.published
  ) lesson
  where progress.user_id = caller_id
    and progress.lesson_id = lesson.lesson_id
    and progress.status in ('locked', 'available')
    and progress.first_started_at is null
    and progress.attempt_count = 0;

  return query
  select progress.* from public.lesson_progress progress
  where progress.user_id = caller_id
  order by progress.lesson_id;
end;
$$;

create or replace function public.start_lesson_attempt(p_lesson_id text)
returns public.lesson_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  definition public.lesson_definitions;
  progress public.lesson_progress;
  result public.lesson_attempts;
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  -- Lock publication while choosing the version for a new start.
  perform 1 from public.lesson_catalog where lesson_id=p_lesson_id and published for share;
  select d.* into definition from public.lesson_catalog c join public.lesson_definitions d
    on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
    where c.lesson_id=p_lesson_id and c.published;
  if definition.lesson_id is null then raise exception 'Lesson not found.'; end if;

  perform public.initialize_lesson_progress();
  select * into progress from public.lesson_progress
  where user_id = caller_id and lesson_id = p_lesson_id
  for update;
  if progress.status = 'locked' or (definition.prerequisite_lesson_id is not null and not exists(
    select 1 from public.lesson_progress where user_id=caller_id and lesson_id=definition.prerequisite_lesson_id and status='cleared'
  )) then raise exception 'Lesson is locked.'; end if;

  select * into result from public.lesson_attempts
  where user_id = caller_id and lesson_id = p_lesson_id and status = 'active';
  if result.id is not null then return result; end if;

  insert into public.lesson_attempts
    (user_id, lesson_id, content_version, expected_activity_count, passing_threshold)
  values (
    caller_id, definition.lesson_id, definition.content_version,
    definition.expected_activity_count, definition.passing_threshold
  )
  returning * into result;

  update public.lesson_progress
  set status = case when status = 'cleared' then status else 'in-progress' end,
      first_started_at = coalesce(first_started_at, now())
  where user_id = caller_id and lesson_id = p_lesson_id;
  return result;
end;
$$;

create or replace function public.complete_lesson_attempt(p_attempt_id uuid)
returns public.lesson_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_attempt public.lesson_attempts;
  definition public.lesson_definitions;
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
begin
  if caller_id is null or public.is_researcher() then
    raise exception 'Student access required.' using errcode = '42501';
  end if;

  select * into current_attempt from public.lesson_attempts
  where id = p_attempt_id and user_id = caller_id
  for update;
  if current_attempt.id is null then raise exception 'Attempt not found.'; end if;
  if current_attempt.status = 'completed' then return current_attempt; end if;
  if current_attempt.status <> 'active' then raise exception 'Attempt cannot be completed.'; end if;

  select * into definition from public.lesson_definitions
  where lesson_id = current_attempt.lesson_id
    and content_version = current_attempt.content_version;
  if definition.lesson_id is null then raise exception 'Lesson definition not found.'; end if;

  select count(*), count(*) filter (where answer.submitted_answer = activity.correct_answer)
  into answer_count, correct_count
  from public.attempt_answers answer
  join public.lesson_activity_keys activity
    on activity.lesson_id = current_attempt.lesson_id
    and activity.content_version = current_attempt.content_version
    and activity.activity_id = answer.activity_id
  where answer.attempt_id = p_attempt_id;
  if answer_count <> definition.expected_activity_count then
    raise exception 'Complete every activity before finishing the lesson.';
  end if;

  update public.attempt_answers answer
  set is_correct = answer.submitted_answer = activity.correct_answer
  from public.lesson_activity_keys activity
  where answer.attempt_id = p_attempt_id
    and activity.lesson_id = current_attempt.lesson_id
    and activity.content_version = current_attempt.content_version
    and activity.activity_id = answer.activity_id;

  computed_score := round((correct_count::numeric / definition.expected_activity_count) * 100);
  computed_stars := case
    when computed_score = 100 then 3
    when computed_score >= 85 then 2
    when computed_score >= definition.passing_threshold then 1
    else 0
  end;
  computed_cleared := computed_score >= definition.passing_threshold;

  select * into current_progress from public.lesson_progress
  where user_id = caller_id and lesson_id = current_attempt.lesson_id
  for update;
  if current_progress.user_id is null then raise exception 'Lesson progress not found.'; end if;

  next_best_score := greatest(current_progress.best_score, computed_score);
  next_best_stars := greatest(current_progress.best_star_count, computed_stars);
  next_xp := next_best_score + (next_best_stars * 10);
  xp_delta := greatest(0, next_xp - current_progress.xp_awarded);

  update public.lesson_attempts
  set status = 'completed', completed_at = now(), last_updated_at = now(),
      final_score = computed_score, star_count = computed_stars,
      cleared = computed_cleared, xp_improvement = xp_delta
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
      xp_awarded = greatest(current_progress.xp_awarded, next_xp),
      last_attempted_at = now(),
      cleared_at = coalesce(current_progress.cleared_at, case when computed_cleared then now() end)
  where user_id = caller_id and lesson_id = current_attempt.lesson_id;

  if computed_cleared then
    insert into public.lesson_progress (user_id, lesson_id, status)
    select caller_id, follow_up.lesson_id, 'available'
    from (
      select candidate.* from public.lesson_catalog catalog join public.lesson_definitions candidate
        on (candidate.lesson_id,candidate.content_version)=(catalog.lesson_id,catalog.published_version)
      where catalog.published and candidate.prerequisite_lesson_id=current_attempt.lesson_id
    ) follow_up
    on conflict (user_id, lesson_id) do update
      set status = case
        when public.lesson_progress.status = 'locked' then 'available'::public.lesson_progress_status
        else public.lesson_progress.status
      end;
  end if;
  return current_attempt;
end;
$$;
commit;
