-- Temporary visual-testing catalog. Existing Operation Signals / Order Matters
-- lesson content and historical versions are retained under their new positions.
begin;

select pg_advisory_xact_lock(20260912, 2);

create function pg_temp.demo_vocab(p_title text, p_rows jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', 'demo-vocabulary', 'type', 'vocabulary-table', 'title', p_title, 'rows', p_rows);
$$;

create function pg_temp.demo_question(p_id text, p_prompt text, p_correct text, p_wrong_a text, p_wrong_b text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_id,
    'prompt', p_prompt,
    'choices', jsonb_build_array(
      jsonb_build_object('id', p_id || '-correct', 'label', p_correct),
      jsonb_build_object('id', p_id || '-a', 'label', p_wrong_a),
      jsonb_build_object('id', p_id || '-b', 'label', p_wrong_b)
    ),
    'correctChoiceId', p_id || '-correct',
    'isPlaceholder', true
  );
$$;

create function pg_temp.demo_assessment(p_prefix text, p_topic text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_array(
    pg_temp.demo_question(p_prefix || '-signal', 'Temporary visual-test check: which operation does “sum” signal in ' || p_topic || '?', 'Addition', 'Division', 'Subtraction'),
    pg_temp.demo_question(p_prefix || '-expression', 'Temporary visual-test check: which expression represents a number increased by five?', 'n + 5', '5 - n', '5n')
  );
$$;

create function pg_temp.demo_find(p_id text, p_title text, p_prompt text, p_expression text, p_before text,
  p_after text, p_correct_id text, p_correct text, p_wrong_a text, p_wrong_b text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id',p_id,'type','find-word','title',p_title,'prompt',p_prompt,'mathStatement',p_expression,
    'sentenceBefore',p_before,'sentenceAfter',p_after,
    'choices',jsonb_build_array(jsonb_build_object('id',p_correct_id,'label',p_correct),
      jsonb_build_object('id',p_id || '-wrong-a','label',p_wrong_a),
      jsonb_build_object('id',p_id || '-wrong-b','label',p_wrong_b)),
    'correctChoiceId',p_correct_id,
    'explanation',jsonb_build_object('title','Temporary demo feedback','body','This temporary example is for visual testing and may be replaced with approved curriculum.')
  );
$$;

create function pg_temp.demo_translate(p_id text, p_title text, p_phrase text, p_correct text, p_wrong_a text, p_wrong_b text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id',p_id,'type','choose-correct-translation','title',p_title,'prompt',p_phrase,
    'choices',jsonb_build_array(jsonb_build_object('id',p_id || '-correct','label',p_correct),
      jsonb_build_object('id',p_id || '-wrong-a','label',p_wrong_a),
      jsonb_build_object('id',p_id || '-wrong-b','label',p_wrong_b)),
    'correctChoiceId',p_id || '-correct',
    'explanation',jsonb_build_object('title','Temporary demo feedback','body','This temporary example is for visual testing and may be replaced with approved curriculum.')
  );
$$;

create function pg_temp.demo_organize(p_id text, p_title text, p_prompt text, p_expression text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id',p_id,'type','organize-translate','title',p_title,'prompt',p_prompt,'mathStatement',p_expression,
    'tokens',jsonb_build_array(jsonb_build_object('id',p_id || '-number','label','a number'),
      jsonb_build_object('id',p_id || '-five','label','five'),jsonb_build_object('id',p_id || '-plus','label','plus')),
    'correctTokenSequence',jsonb_build_array(p_id || '-number',p_id || '-plus',p_id || '-five'),
    'explanation',jsonb_build_object('title','Temporary demo feedback','body','This temporary example is for visual testing and may be replaced with approved curriculum.')
  );
$$;

create function pg_temp.demo_chapter(p_id text, p_title text, p_description text, p_content jsonb, p_activities jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id',p_id,'title',p_title,'description',p_description,
    'displayOrder',1,'instructionalContent',p_content,'activities',p_activities);
$$;

create function pg_temp.rechapter(p_draft jsonb, p_title text, p_order integer, p_prerequisite text,
  p_vocab jsonb default null) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare content_items jsonb := coalesce(p_draft->'instructionalContent','[]'::jsonb);
  activity_items jsonb := coalesce(p_draft->'activities','[]'::jsonb);
  content_split integer; activity_split integer; first_content jsonb; second_content jsonb;
  first_activities jsonb; second_activities jsonb; chapters jsonb;
begin
  content_split := greatest(1, ceil(jsonb_array_length(content_items)::numeric / 2)::integer);
  activity_split := greatest(1, ceil(jsonb_array_length(activity_items)::numeric / 2)::integer);
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into first_content
    from jsonb_array_elements(content_items) with ordinality items(value,ordinal) where ordinal <= content_split;
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into second_content
    from jsonb_array_elements(content_items) with ordinality items(value,ordinal) where ordinal > content_split;
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into first_activities
    from jsonb_array_elements(activity_items) with ordinality items(value,ordinal) where ordinal <= activity_split;
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into second_activities
    from jsonb_array_elements(activity_items) with ordinality items(value,ordinal) where ordinal > activity_split;
  if p_vocab is not null then first_content := jsonb_build_array(p_vocab) || first_content; end if;
  chapters := jsonb_build_array(
    jsonb_build_object('id','chapter-' || (p_draft->>'id') || '-1','title','Chapter 1','description',p_draft->>'shortDescription',
      'displayOrder',1,'instructionalContent',first_content,'activities',first_activities),
    jsonb_build_object('id','chapter-' || (p_draft->>'id') || '-2','title','Chapter 2','description','Temporary visual-testing chapter content.',
      'displayOrder',2,'instructionalContent',second_content,'activities',second_activities)
  );
  return p_draft || jsonb_build_object('title',p_title,'displayOrder',p_order,'prerequisiteLessonId',p_prerequisite,'chapters',chapters);
end;
$$;

do $$
declare
  lesson_doc jsonb;
  lesson_row public.lesson_catalog;
  next_version integer;
begin
  -- Keep old authored rows and versions, but take any other old lesson out of the active catalog.
  update public.lesson_catalog set published=false, revision=revision+1, updated_at=now()
  where lesson_id not in ('lesson-foundational-concepts','lesson-operation-signals','lesson-order-matters',
    'lesson-writing-verbal-expressions','lesson-translating-mathematical-expressions');

  lesson_doc := jsonb_build_object(
    'id','lesson-foundational-concepts','sectionId','section-translating-verbal-expressions','unitId','unit-operation-words',
    'title','Foundational Concepts','shortDescription','Temporary demo lesson for visual and interaction testing.',
    'concepts',jsonb_build_array('Variables','Expressions','Operation words'),'displayOrder',1,
    'contentStatus','playable','passingThreshold',70,'contentVersion',1,
    'assessments',jsonb_build_object('preTest','pre-test','postTest','post-test'),
    'assessmentQuestions',jsonb_build_object('pre-test',pg_temp.demo_assessment('foundations-pre','foundational concepts'),
      'post-test',pg_temp.demo_assessment('foundations-post','foundational concepts')),
    'chapters',jsonb_build_array(
      jsonb_build_object('id','chapter-foundations-1','title','Symbols and values','description','Temporary demo chapter for visual testing.',
        'displayOrder',1,'instructionalContent',jsonb_build_array(
          pg_temp.demo_vocab('Foundational vocabulary',jsonb_build_array(
            jsonb_build_object('id','foundation-variable','term','Variable','definition','A symbol that represents an unknown value.','example','x, n, or p'),
            jsonb_build_object('id','foundation-constant','term','Constant','definition','A fixed value.','example','7 in x + 7'),
            jsonb_build_object('id','foundation-expression','term','Expression','definition','Numbers, variables, and operations written together.','example','2x + 3')
          )),
          jsonb_build_object('id','foundation-explain','type','paragraph','title','Reading an expression','body','Temporary demo content: expressions combine symbols, values, and operation signs.'),
          jsonb_build_object('id','foundation-example','type','example','phrase','twice a number plus three','expression','2x + 3','note','Temporary demo example for visual testing.')
        ),'activities',jsonb_build_array(
          pg_temp.demo_find('foundation-find','Find the operation word','Choose the word that signals addition.','x + 5','The','of a number and five','foundation-sum','sum','product','quotient'),
          pg_temp.demo_translate('foundation-translate','Choose a translation','The sum of a number and five','x + 5','x - 5','5x')
        )),
      jsonb_build_object('id','chapter-foundations-2','title','Build a phrase','description','Temporary demo chapter for visual testing.',
        'displayOrder',2,'instructionalContent',jsonb_build_array(
          jsonb_build_object('id','foundation-note','type','warning','title','Demo note','body','Temporary note: read the words and symbols carefully before choosing an operation.')
        ),'activities',jsonb_build_array(
          pg_temp.demo_organize('foundation-organize','Arrange the phrase','Arrange the tokens to match the expression.','x + 5')
        ))
    )
  );
  insert into public.lesson_catalog(lesson_id,draft,published,published_version)
  values('lesson-foundational-concepts',lesson_doc,false,null)
  on conflict(lesson_id) do update set draft=excluded.draft,published=false,published_version=null,
    revision=public.lesson_catalog.revision+1,updated_at=now();

  -- Reuse and preserve the current lesson source content, moving it to position 2.
  select * into lesson_row from public.lesson_catalog where lesson_id='lesson-operation-signals' for update;
  if lesson_row.lesson_id is null then raise exception 'Expected existing Operation Signals source lesson.'; end if;
  lesson_doc := pg_temp.rechapter(lesson_row.draft,'Operation Words',2,'lesson-foundational-concepts');
  lesson_doc := lesson_doc || jsonb_build_object('assessments',jsonb_build_object('preTest','pre-test','postTest','post-test'),
    'assessmentQuestions',jsonb_build_object(
      'pre-test',case when jsonb_array_length(coalesce(lesson_row.draft#>'{assessmentQuestions,pre-test}','[]'::jsonb))>0 then lesson_row.draft#>'{assessmentQuestions,pre-test}' else pg_temp.demo_assessment('operations-pre','operation words') end,
      'post-test',case when jsonb_array_length(coalesce(lesson_row.draft#>'{assessmentQuestions,post-test}','[]'::jsonb))>0 then lesson_row.draft#>'{assessmentQuestions,post-test}' else pg_temp.demo_assessment('operations-post','operation words') end));
  update public.lesson_catalog set draft=lesson_doc,published=false,revision=revision+1,updated_at=now() where lesson_id=lesson_row.lesson_id;

  -- Preserve Order Matters teaching/activity content and add the required reference table and order.
  select * into lesson_row from public.lesson_catalog where lesson_id='lesson-order-matters' for update;
  if lesson_row.lesson_id is null then raise exception 'Expected existing Order Matters source lesson.'; end if;
  lesson_doc := pg_temp.rechapter(lesson_row.draft,'Order Matters',3,'lesson-operation-signals',
    pg_temp.demo_vocab('Order vocabulary',jsonb_build_array(
      jsonb_build_object('id','order-less-than','term','Less than','definition','A phrase that reverses the spoken order for subtraction.','example','Six less than n → n - 6'),
      jsonb_build_object('id','order-subtracted-from','term','Subtracted from','definition','The quantity after “from” is written first.','example','n subtracted from 12 → 12 - n')
    )));
  lesson_doc := lesson_doc || jsonb_build_object('assessments',jsonb_build_object('preTest','pre-test','postTest','post-test'),
    'assessmentQuestions',jsonb_build_object(
      'pre-test',case when jsonb_array_length(coalesce(lesson_row.draft#>'{assessmentQuestions,pre-test}','[]'::jsonb))>0 then lesson_row.draft#>'{assessmentQuestions,pre-test}' else pg_temp.demo_assessment('order-pre','order matters') end,
      'post-test',case when jsonb_array_length(coalesce(lesson_row.draft#>'{assessmentQuestions,post-test}','[]'::jsonb))>0 then lesson_row.draft#>'{assessmentQuestions,post-test}' else pg_temp.demo_assessment('order-post','order matters') end));
  update public.lesson_catalog set draft=lesson_doc,published=false,revision=revision+1,updated_at=now() where lesson_id=lesson_row.lesson_id;

  lesson_doc := jsonb_build_object(
    'id','lesson-writing-verbal-expressions','sectionId','section-translating-verbal-expressions','unitId','unit-operation-words',
    'title','Writing Verbal Expressions','shortDescription','Temporary demo lesson for visual and interaction testing.',
    'concepts',jsonb_build_array('Verbal phrases','Expression structure'),'displayOrder',4,
    'prerequisiteLessonId','lesson-order-matters','contentStatus','playable','passingThreshold',70,'contentVersion',1,
    'assessments',jsonb_build_object('preTest','pre-test','postTest','post-test'),
    'assessmentQuestions',jsonb_build_object('pre-test',pg_temp.demo_assessment('writing-pre','writing verbal expressions'),
      'post-test',pg_temp.demo_assessment('writing-post','writing verbal expressions')),
    'chapters',jsonb_build_array(
      jsonb_build_object('id','chapter-writing-1','title','From words to operations','description','Temporary demo chapter.',
        'displayOrder',1,'instructionalContent',jsonb_build_array(
          pg_temp.demo_vocab('Expression vocabulary',jsonb_build_array(
            jsonb_build_object('id','writing-sum','term','Sum','definition','The result of addition.','example','The sum of x and 4 → x + 4'),
            jsonb_build_object('id','writing-product','term','Product','definition','The result of multiplication.','example','The product of 3 and n → 3n')
          )),
          jsonb_build_object('id','writing-example','type','example','phrase','three times a number increased by four','expression','3n + 4','note','Temporary demo example.')
        ),'activities',jsonb_build_array(
          pg_temp.demo_find('writing-find','Find the signal','Choose the operation word for x + 4.','x + 4','The','of x and four','writing-sum-word','sum','product','quotient'),
          pg_temp.demo_translate('writing-translate','Choose the expression','The product of three and a number','3n','n + 3','3 + n')
        )),
      jsonb_build_object('id','chapter-writing-2','title','Combine phrase parts','description','Temporary demo chapter.',
        'displayOrder',2,'instructionalContent',jsonb_build_array(
          jsonb_build_object('id','writing-note','type','warning','title','Demo note','body','Temporary note: identify the operation phrase before writing symbols.')
        ),'activities',jsonb_build_array(
          pg_temp.demo_organize('writing-organize','Arrange the phrase','Arrange the phrase to match x + 5.','x + 5')
        ))
    )
  );
  insert into public.lesson_catalog(lesson_id,draft,published,published_version)
  values('lesson-writing-verbal-expressions',lesson_doc,false,null)
  on conflict(lesson_id) do update set draft=excluded.draft,published=false,published_version=null,
    revision=public.lesson_catalog.revision+1,updated_at=now();

  lesson_doc := jsonb_build_object(
    'id','lesson-translating-mathematical-expressions','sectionId','section-translating-verbal-expressions','unitId','unit-operation-words',
    'title','Translating Mathematical Expressions','shortDescription','Temporary demo lesson for visual and interaction testing.',
    'concepts',jsonb_build_array('Translate phrases','Group operations','Check order'),'displayOrder',5,
    'prerequisiteLessonId','lesson-writing-verbal-expressions','contentStatus','playable','passingThreshold',70,'contentVersion',1,
    'assessments',jsonb_build_object('preTest','pre-test','postTest','post-test'),
    'assessmentQuestions',jsonb_build_object('pre-test',pg_temp.demo_assessment('translate-pre','translating expressions'),
      'post-test',pg_temp.demo_assessment('translate-post','translating expressions')),
    'chapters',jsonb_build_array(
      jsonb_build_object('id','chapter-translate-1','title','Translate the phrase','description','Temporary demo chapter.',
        'displayOrder',1,'instructionalContent',jsonb_build_array(
          pg_temp.demo_vocab('Translation vocabulary',jsonb_build_array(
            jsonb_build_object('id','translate-increased','term','Increased by','definition','Add the named amount to the quantity.','example','n increased by 6 → n + 6'),
            jsonb_build_object('id','translate-quotient','term','Quotient','definition','The result of division.','example','The quotient of n and 4 → n ÷ 4')
          )),
          jsonb_build_object('id','translate-example','type','example','phrase','twice the sum of a number and three','expression','2(n + 3)','note','Temporary demo example.')
        ),'activities',jsonb_build_array(
          pg_temp.demo_translate('translate-choice-1','Choose the translation','A number increased by six','n + 6','6 - n','6n'),
          pg_temp.demo_find('translate-find','Find the operation word','Choose the word for division.','n ÷ 4','The quotient','of n and four','translate-quotient-word','quotient','sum','product')
        )),
      jsonb_build_object('id','chapter-translate-2','title','Group the expression','description','Temporary demo chapter.',
        'displayOrder',2,'instructionalContent',jsonb_build_array(
          jsonb_build_object('id','translate-grouping','type','warning','title','Demo note','body','Temporary note: parentheses keep the grouped phrase together.')
        ),'activities',jsonb_build_array(
          pg_temp.demo_organize('translate-organize','Arrange a grouped phrase','Arrange the phrase to match 2(x + 3).','2(x + 3)')
        )),
      jsonb_build_object('id','chapter-translate-3','title','Review and compare','description','Temporary demo chapter.',
        'displayOrder',3,'instructionalContent',jsonb_build_array(
          jsonb_build_object('id','translate-review','type','paragraph','title','Temporary review','body','Compare the written expression with every phrase part before you finish.')
        ),'activities',jsonb_build_array(
          pg_temp.demo_translate('translate-choice-2','Choose another translation','The sum of a number and five','n + 5','n - 5','5n')
        ))
    )
  );
  insert into public.lesson_catalog(lesson_id,draft,published,published_version)
  values('lesson-translating-mathematical-expressions',lesson_doc,false,null)
  on conflict(lesson_id) do update set draft=excluded.draft,published=false,published_version=null,
    revision=public.lesson_catalog.revision+1,updated_at=now();

  -- Publish in order so every server definition has its prerequisite in place.
  for lesson_row in
    select * from public.lesson_catalog where lesson_id in ('lesson-foundational-concepts','lesson-operation-signals',
      'lesson-order-matters','lesson-writing-verbal-expressions','lesson-translating-mathematical-expressions')
    order by (draft->>'displayOrder')::integer
  loop
    select coalesce(max(content_version),0)+1 into next_version from public.lesson_definitions where lesson_id=lesson_row.lesson_id;
    perform public.compile_lesson(lesson_row.draft,next_version);
    update public.lesson_catalog set published=true,published_version=next_version where lesson_id=lesson_row.lesson_id;
  end loop;

  if (select count(*) from public.lesson_catalog where published and lesson_id in ('lesson-foundational-concepts',
      'lesson-operation-signals','lesson-order-matters','lesson-writing-verbal-expressions','lesson-translating-mathematical-expressions')) <> 5 then
    raise exception 'Visual testing lessons were not all published.';
  end if;
end;
$$;

commit;
