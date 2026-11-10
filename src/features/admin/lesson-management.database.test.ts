// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import {
  newChapter,
  normalizeAuthoredLesson,
  type AuthoredLesson,
  type ManagedLesson,
} from './lesson-management.service';
import { activitySchema, publicLessonSchema, type ContentTable } from '@/features/lessons/domain/content.schemas';

let pg: PGlite;
const adminId = randomUUID(),
  studentId = randomUUID(),
  researcherId = randomUUID(),
  adminOnlyId = randomUUID(),
  dualRoleId = randomUUID();
const migration = '202610300001_lesson_chapters.sql';
const phase2Migration = '202610300002_lesson_chapter_runtime.sql';
const phase3Migration = '202610300003_lesson_offline_transitions.sql';
const offlineAssessmentMigration = '202610310001_offline_assessment_start.sql';
const lessonScopedAssessmentMigration = '202611040001_lesson_scoped_assessments.sql';
const completedActiveTimeMigration = '202611040002_reconcile_completed_attempt_active_time.sql';
const chooseTranslationMigration = '202611040003_choose_correct_translation_activity.sql';
const vocabularyMigration = '202611040004_vocabulary_word_list_star_thresholds.sql';
const acceptedTokenSequencesMigration = '202611050002_multi_accepted_organize_answers.sql';
const lessonAttemptLimitsMigration = '202611100001_lesson_attempt_limits.sql';
async function asUser(id: string, role = 'authenticated') {
  await pg.exec(`reset role; set role ${role};`);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function rpc<T>(name: string, args: unknown[] = []): Promise<T> {
  // Names are fixed test code, never user input.
  if (name === 'submit_lesson_activity_answer')
    args = args.map((value, index) => (index === 2 ? JSON.stringify(value) : value));
  if (name === 'sync_assessment_draft')
    args = args.map((value, index) => (index === 4 ? JSON.stringify(value) : value));
  return (
    await pg.query<{ result: T }>(
      `select to_jsonb(public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})) as result`,
      args,
    )
  ).rows[0].result;
}
function draft(overrides: Partial<AuthoredLesson> = {}): AuthoredLesson {
  const legacy = structuredClone(packagedContent.lessons[0]);
  const chapter = newChapter(1, 'Chapter 1');
  chapter.description = legacy.shortDescription;
  chapter.instructionalContent = overrides.instructionalContent ?? legacy.instructionalContent;
  chapter.activities = overrides.activities ?? [structuredClone(legacy.activities[0])];
  return normalizeAuthoredLesson({
    ...legacy,
    id: `lesson-${randomUUID()}`,
    title: 'Test authoring lesson',
    displayOrder: 3,
    contentVersion: 1,
    prerequisiteLessonId: 'lesson-order-matters',
    ...overrides,
    chapters: overrides.chapters ?? [chapter],
  });
}
function withActivities(
  lesson: AuthoredLesson,
  activities: AuthoredLesson['activities'],
): AuthoredLesson {
  return normalizeAuthoredLesson({
    ...lesson,
    chapters: [{ ...lesson.chapters[0], activities }],
  });
}
async function save(lesson: AuthoredLesson, revision = 0) {
  return rpc<ManagedLesson>('save_admin_lesson', [lesson, revision]);
}
async function publish(item: ManagedLesson, visible = true) {
  return rpc<ManagedLesson>('set_lesson_publication', [item.lesson_id, visible, item.revision]);
}
async function completeLesson(id: string) {
  const attempt = await rpc<{ id: string; content_version: number }>('start_lesson_attempt', [id]);
  await pg.exec('reset role');
  const keys = await pg.query<{ activity_id: string; correct_answer: unknown }>(
    'select activity_id,correct_answer from public.lesson_activity_keys where lesson_id=$1 and content_version=$2',
    [id, attempt.content_version],
  );
  await asUser(studentId);
  for (const key of keys.rows)
    await rpc('submit_lesson_activity_answer', [attempt.id, key.activity_id, key.correct_answer]);
  await rpc('complete_lesson_attempt', [attempt.id]);
  return attempt;
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,encrypted_password text,raw_user_meta_data jsonb default '{}',
      created_at timestamptz not null default now(), last_sign_in_at timestamptz, banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of readdirSync(resolve('supabase/migrations'))
    .filter((f) => f.endsWith('.sql') && f < migration)
    .sort()) {
    await pg.exec(
      readFileSync(resolve('supabase/migrations', file), 'utf8').replace(
        'create extension if not exists pgcrypto;',
        '',
      ),
    );
  }
  for (const [id, username] of [
    [adminId, 'author'],
    [studentId, 'learner'],
    [researcherId, 'observer'],
    [adminOnlyId, 'admin_only'],
    [dualRoleId, 'dual_role'],
  ]) {
    await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      id,
      `${username}@example.invalid`,
      { username, display_name: username },
    ]);
  }
  await asUser(studentId);
  await completeLesson('lesson-operation-signals');
  const before = await pg.query('select * from public.lesson_progress order by lesson_id');
  const attemptsBefore = await pg.query('select * from public.lesson_attempts order by id');
  const daysBefore = await pg.query(
    'select * from public.student_activity_days order by activity_day',
  );
  await pg.exec('reset role');
  await pg.exec(readFileSync(resolve('supabase/migrations', migration), 'utf8'));
  await asUser(studentId);
  const after = await pg.query('select * from public.lesson_progress order by lesson_id');
  expect(after.rows).toEqual(before.rows);
  expect((await pg.query('select * from public.lesson_attempts order by id')).rows).toEqual(
    attemptsBefore.rows,
  );
  expect(
    (await pg.query('select * from public.student_activity_days order by activity_day')).rows,
  ).toEqual(daysBefore.rows);
  await pg.exec('reset role');
  await pg.exec(readFileSync(resolve('supabase/migrations', phase2Migration), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations', phase3Migration), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations', offlineAssessmentMigration), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations', lessonScopedAssessmentMigration), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations', completedActiveTimeMigration), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations', chooseTranslationMigration), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations', vocabularyMigration), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations', acceptedTokenSequencesMigration), 'utf8'));
  const versionsBeforeTables = await pg.query('select * from public.lesson_definitions order by lesson_id,content_version');
  await pg.exec(readFileSync(resolve('supabase/migrations/202611070001_dynamic_content_tables.sql'), 'utf8'));
  expect((await pg.query('select * from public.lesson_definitions order by lesson_id,content_version')).rows).toEqual(versionsBeforeTables.rows);
  await pg.exec(readFileSync(resolve('supabase/migrations/202611070002_chapter_vocabulary_tables.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations/202611070003_revert_chapter_vocabulary_tables.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations/202611070004_optional_chapter_teaching_tables.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations/202611090001_optional_lesson_activity_feedback.sql'), 'utf8'));
  await pg.exec(readFileSync(resolve('supabase/migrations', lessonAttemptLimitsMigration), 'utf8'));
  await pg.exec("update public.lesson_definitions set pre_assessment_version=null where lesson_id='lesson-order-matters'");
  await pg.query('insert into public.admin_users(user_id) values($1)', [adminId]);
  await pg.query('insert into public.admin_users(user_id) values($1),($2)', [
    adminOnlyId,
    dualRoleId,
  ]);
  await pg.query('insert into public.researcher_users(user_id) values($1)', [researcherId]);
  await pg.query('insert into public.researcher_users(user_id) values($1)', [dualRoleId]);
}, 30000);
beforeEach(async () => {
  await pg.exec('reset role; begin');
  await asUser(adminId);
});
afterEach(async () => {
  await pg.exec('rollback');
});
afterAll(async () => {
  await pg?.close();
});

describe('Basic Lesson Management SQL and RLS', () => {
  it('publishes mixed chapter teaching tables without moving the Overview, and skips empty teaching', async () => {
    const base = structuredClone(packagedContent.lessons[0]);
    const overview = { id: 'overview-reference', type: 'vocabulary-table' as const, title: 'Vocabulary', rows: [], tables: [{
      id: 'overview-table', columns: [{ id: 'term', label: 'Term' }], rows: [{ id: 'row', cells: { term: 'Variable' } }],
    }] };
    const chapterOne = newChapter(1, 'Activities first');
    chapterOne.instructionalContent = [overview];
    chapterOne.activities = [structuredClone(base.activities[0])];
    const chapterTwo = newChapter(2, 'Teaching tables');
    chapterTwo.instructionalContent = [
      { id: 'explanation', type: 'paragraph', title: 'Read the phrase', body: 'Then translate.' },
      { id: 'tables', type: 'content-table', tables: [
        { id: 'operations', title: 'Operations', columns: [{ id: 'word', label: 'Word' }], rows: [{ id: 'sum', cells: { word: 'sum' } }] },
        { id: 'translations', columns: [{ id: 'verbal', label: 'Verbal' }, { id: 'symbolic', label: 'Symbolic' }], rows: [{ id: 'example', cells: { verbal: 'five more', symbolic: 'n + 5' } }] },
      ] },
      { id: 'warning', type: 'warning', title: 'Mind the order', body: 'Read carefully.' },
    ];
    chapterTwo.activities = [structuredClone(base.activities[1])];
    const authored = draft({ prerequisiteLessonId: undefined, chapters: [chapterOne, chapterTwo] });
    const saved = await save(authored);
    const published = await publish(saved);
    await asUser(studentId);
    const attempt = await rpc<{ id: string; flow_stage: string }>('start_lesson_attempt', [published.lesson_id]);
    expect(attempt.flow_stage).toBe('chapter-activity');
    const content = await rpc<AuthoredLesson>('get_lesson_content', [published.lesson_id, attempt.id]);
    expect(content.chapters[0].instructionalContent).toEqual([overview]);
    expect(content.chapters[1].instructionalContent).toEqual(chapterTwo.instructionalContent);
    expect(content.instructionalContent).toContainEqual(overview);
    expect(publicLessonSchema.safeParse(content).success).toBe(true);
  });
  it('saves, publishes and restores ordered configurable tables without changing published versions or private keys', async () => {
    const tables: ContentTable[] = [
      { id: 'operations', title: 'Operation words', columns: [
        { id: 'operation', label: 'Operation' }, { id: 'symbol', label: 'Symbol' }, { id: 'words', label: 'Words/Phrases' },
      ], rows: [
        { id: 'add', cells: { operation: 'Addition', symbol: '+', words: 'sum\nmore than' } },
        { id: 'subtract', cells: { operation: 'Subtraction', symbol: '-', words: '' } },
      ] },
      { id: 'translate', columns: [{ id: 'verbal', label: 'Verbal' }, { id: 'symbolic', label: 'Symbolic' }],
        rows: [{ id: 'translation', cells: { verbal: 'Five more than a number', symbolic: 'n + 5' } }] },
    ];
    const authored = draft({ prerequisiteLessonId: undefined, instructionalContent: [
      { id: 'references', type: 'vocabulary-table', title: 'Vocabulary', rows: [], tables },
    ] });
    const saved = await save(authored);
    expect(saved.draft.chapters[0].instructionalContent).toEqual(authored.chapters[0].instructionalContent);
    const first = await publish(saved);
    await asUser(studentId);
    const attempt = await rpc<{ id: string }>('start_lesson_attempt', [first.lesson_id]);
    const initialContent = await rpc<AuthoredLesson>('get_lesson_content', [first.lesson_id, attempt.id]);
    expect(initialContent.instructionalContent).toEqual(authored.instructionalContent);
    expect(initialContent.chapters[0].instructionalContent).toEqual(authored.instructionalContent);
    expect(publicLessonSchema.safeParse(initialContent).success).toBe(true);
    expect(initialContent.activities[0]).not.toHaveProperty('correctChoiceId');

    await asUser(adminId);
    const reordered = [tables[1], { ...tables[0], columns: [...tables[0].columns].reverse(), rows: [...tables[0].rows].reverse() }];
    const updated = normalizeAuthoredLesson({ ...first.draft, chapters: [{ ...first.draft.chapters[0],
      instructionalContent: [{ id: 'references', type: 'vocabulary-table', title: 'Vocabulary', rows: [], tables: reordered }],
    }] });
    const second = await publish(await save(updated, first.revision));
    await asUser(studentId);
    const latest = await rpc<AuthoredLesson>('get_lesson_content', [second.lesson_id, null]);
    expect(latest.instructionalContent).toEqual(updated.instructionalContent);
    expect(await rpc('get_lesson_content', [first.lesson_id, attempt.id])).toEqual(initialContent);
    expect(second.published_version).toBe(first.published_version! + 1);
  });

  it.each([
    { id: 't', columns: [], rows: [] },
    { id: 't', columns: [{ id: 'c', label: 'Column' }, { id: 'c', label: 'Duplicate' }], rows: [] },
    { id: 't', columns: [{ id: 'c', label: 'Column' }], rows: [{ id: 'r', cells: {} }] },
    { id: 't', columns: [{ id: 'c', label: 'Column' }], rows: [{ id: 'r', cells: { c: '', unknown: '' } }] },
    { id: 't', columns: [{ id: 'c', label: 'Column' }], rows: [{ id: 'r', cells: { c: 1 } }] },
    { id: 't', columns: [{ id: 'c', label: 'Column' }], rows: [{ id: 'r', cells: { c: '' } }, { id: 'r', cells: { c: '' } }] },
    { id: 't', columns: [{ id: 'c', label: 'Column' }], rows: [], secret: 'unexpected field' },
  ])('rejects malformed configurable tables at publication: %j', async (table) => {
    const authored = draft({ instructionalContent: [{ id: 'table-content', type: 'vocabulary-table', title: 'Tables', rows: [] }] });
    // Simulate untrusted RPC input rather than bypassing TypeScript in application code.
    const instructions = authored.instructionalContent.map((block) => ({ ...block, tables: [table] }));
    const payload = { ...authored, instructionalContent: instructions,
      chapters: [{ ...authored.chapters[0], instructionalContent: instructions }] };
    const saved = await rpc<ManagedLesson>('save_admin_lesson', [payload, 0]);
    await expect(publish(saved)).rejects.toThrow();
  });

  it('privately grades any explicitly accepted Arrange Words sequence and rejects others', async () => {
    const activity = activitySchema.parse({
      id: 'arrange-accepted-orders',
      type: 'organize-translate',
      title: 'Arrange the phrase',
      prompt: 'Build the phrase for the expression.',
      mathStatement: 'n - 6',
      tokens: [
        { id: 'number', label: 'a number' },
        { id: 'six', label: 'six' },
        { id: 'less-than', label: 'less than' },
      ],
      correctTokenSequence: ['six', 'less-than', 'number'],
      acceptedTokenSequences: [
        ['six', 'less-than', 'number'],
        ['number', 'less-than', 'six'],
      ],
      explanation: { title: 'Accepted order', body: 'This order was explicitly configured.' },
    });
    if (activity.type !== 'organize-translate') throw new Error('Invalid activity fixture.');
    const authored = draft({ prerequisiteLessonId: undefined, activities: [activity] });
    const published = await publish(await save(authored));

    await asUser(studentId);
    const content = await rpc<AuthoredLesson>('get_lesson_content', [published.lesson_id, null]);
    expect(content.activities[0]).not.toHaveProperty('acceptedTokenSequences');
    expect(content.activities[0]).not.toHaveProperty('correctTokenSequence');
    expect(publicLessonSchema.safeParse(content).success).toBe(true);

    const firstAttempt = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    const accepted = await rpc<{ is_correct: boolean }>('submit_lesson_activity_answer', [
      firstAttempt.id,
      activity.id,
      ['number', 'less-than', 'six'],
    ]);
    expect(accepted.is_correct).toBe(true);
    const firstCompletion = await rpc<{ final_score: number }>('complete_lesson_attempt', [firstAttempt.id]);
    expect(firstCompletion.final_score).toBe(100);

    const secondAttempt = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    const unconfigured = await rpc<{ is_correct: boolean }>('submit_lesson_activity_answer', [
      secondAttempt.id,
      activity.id,
      ['number', 'six', 'less-than'],
    ]);
    expect(unconfigured.is_correct).toBe(false);
    const secondCompletion = await rpc<{ final_score: number }>('complete_lesson_attempt', [secondAttempt.id]);
    expect(secondCompletion.final_score).toBe(0);
  });

  it('saves, publishes, restores, and privately grades translation choices', async () => {
    const activity = activitySchema.parse({
      id: 'translate-sum-five',
      type: 'choose-correct-translation',
      title: 'Choose the correct translation',
      prompt: 'The sum of a number and five',
      choices: [
        { id: 'sum-expression', label: 'n + 5' },
        { id: 'difference-expression', label: 'n - 5' },
        { id: 'reversed-expression', label: '5 - n' },
      ],
      correctChoiceId: 'sum-expression',
      explanation: { title: 'Sum means addition', body: 'Add five to n.' },
    });
    if (activity.type !== 'choose-correct-translation') throw new Error('Invalid activity fixture.');
    const authored = draft({ prerequisiteLessonId: undefined, activities: [activity] });
    const saved = await save(authored);
    expect(saved.draft.activities[0]).toMatchObject({
      type: 'choose-correct-translation',
      prompt: 'The sum of a number and five',
    });
    const published = await publish(saved);
    await asUser(studentId);
    const content = await rpc<AuthoredLesson>('get_lesson_content', [published.lesson_id, null]);
    expect(content.activities[0]).toMatchObject({
      type: 'choose-correct-translation',
      choices: expect.arrayContaining([{ id: 'sum-expression', label: 'n + 5' }]),
    });
    expect(content.activities[0]).not.toHaveProperty('correctChoiceId');
    expect(publicLessonSchema.safeParse(content).success).toBe(true);

    let attempt = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    const correct = await rpc<{ is_correct: boolean }>('submit_lesson_activity_answer', [
      attempt.id,
      activity.id,
      'sum-expression',
    ]);
    expect(correct.is_correct).toBe(true);
    const restored = await rpc<AuthoredLesson>('get_lesson_content', [published.lesson_id, attempt.id]);
    expect(restored.activities[0]).toHaveProperty('correctChoiceId', 'sum-expression');
    await rpc('complete_lesson_attempt', [attempt.id]);

    attempt = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    const incorrect = await rpc<{ is_correct: boolean }>('submit_lesson_activity_answer', [
      attempt.id,
      activity.id,
      'difference-expression',
    ]);
    expect(incorrect.is_correct).toBe(false);
  });

  it('starts a new attempt on the latest published pre-test after restart', async () => {
    const authored = draft({
      prerequisiteLessonId: undefined,
      assessments: { preTest: 'pre-test' },
      assessmentQuestions: {
        'pre-test': [{
          id: 'restart-question', prompt: 'Original pre-test question',
          choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
          correctChoiceId: 'a', isPlaceholder: false,
        }],
        'post-test': [],
      },
    });
    const firstPublished = await publish(await save(authored));
    await asUser(studentId);
    const first = await rpc<{ id: string; content_version: number }>('start_lesson_attempt', [authored.id]);
    expect(first.content_version).toBe(firstPublished.published_version);

    await asUser(adminId);
    authored.assessmentQuestions['pre-test'][0].prompt = 'Updated pre-test question';
    const latest = await publish(await save(authored, firstPublished.revision));
    await asUser(studentId);
    await rpc('abandon_lesson_attempt', [first.id]);
    const restarted = await rpc<{ id: string; content_version: number; pre_assessment_version: number }>(
      'start_lesson_attempt', [authored.id],
    );
    expect(restarted.id).not.toBe(first.id);
    expect(restarted.content_version).toBe(latest.published_version);
    expect(restarted.pre_assessment_version).toBe(latest.published_version);
    const questions = await pg.query<{ prompt: string }>(
      'select prompt from public.get_assessment_questions($1,$2)', ['pre-test', restarted.id],
    );
    expect(questions.rows).toEqual([{ prompt: 'Updated pre-test question' }]);
  });

  it('publishes authored pre-test questions for a fresh student before assessment start', async () => {
    const authored = draft({
      prerequisiteLessonId: undefined,
      assessments: { preTest: 'pre-test' },
      assessmentQuestions: {
        'pre-test': [{
          id: 'fresh-pre-question', prompt: 'Which expression represents five more than x?',
          choices: [{ id: 'a', label: 'x + 5' }, { id: 'b', label: 'x - 5' }],
          correctChoiceId: 'a', isPlaceholder: false,
        }],
        'post-test': [],
      },
    });
    const saved = await save(authored);
    expect(saved.draft.assessmentQuestions['pre-test'][0].prompt).toBe(authored.assessmentQuestions['pre-test'][0].prompt);
    const published = await publish(saved);

    await pg.exec('reset role');
    const freshStudent = randomUUID();
    await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      freshStudent, `${freshStudent}@example.invalid`,
      { username: `user_${freshStudent.slice(0, 8)}`, display_name: 'Fresh student' },
    ]);
    await asUser(freshStudent);
    const attempt = await rpc<{ id: string; content_version: number; pre_assessment_version: number; flow_stage: string }>(
      'start_lesson_attempt', [authored.id],
    );
    expect(attempt).toMatchObject({
      content_version: published.published_version,
      pre_assessment_version: published.published_version,
      flow_stage: 'pre-test',
    });
    const questions = await pg.query<Record<string, unknown>>(
      'select * from public.get_assessment_questions($1,$2)', ['pre-test', attempt.id],
    );
    expect(questions.rows).toHaveLength(1);
    expect(questions.rows[0]).toMatchObject({
      prompt: authored.assessmentQuestions['pre-test'][0].prompt,
      content_version: published.published_version,
    });
    expect(questions.rows[0]).not.toHaveProperty('correct_choice_id');
  });

  it('claims a stable client assessment ID idempotently without exposing answer keys', async () => {
    const item = await publish(await save(draft({
      prerequisiteLessonId: undefined,
      assessments: { preTest: 'pre-test' },
      assessmentQuestions: {
        'pre-test': [{
          id: 'stable-pre-question', prompt: 'Pre-test prompt',
          choices: [{ id: 'stable-a', label: 'A' }, { id: 'stable-b', label: 'B' }],
          correctChoiceId: 'stable-a', isPlaceholder: false,
        }],
        'post-test': [],
      },
    })));
    await asUser(studentId);
    const attempt = await rpc<{ id: string }>('start_lesson_attempt', [item.lesson_id]);
    const freshQuestions = await pg.query<{ prompt: string }>(
      'select prompt from public.get_assessment_questions($1,$2)',
      ['pre-test', attempt.id],
    );
    expect(freshQuestions.rows).toEqual([{ prompt: 'Pre-test prompt' }]);
    const clientId = randomUUID();
    const first = await rpc<{ id: string }>('start_assessment', ['pre-test', attempt.id, clientId]);
    const retry = await rpc<{ id: string }>('start_assessment', ['pre-test', attempt.id, clientId]);
    const questions = await pg.query<Record<string, unknown>>(
      "select * from public.get_assessment_questions($1,$2)",
      ['pre-test', attempt.id],
    );
    expect(first.id).toBe(clientId);
    expect(retry.id).toBe(clientId);
    expect(questions.rows.length).toBeGreaterThan(0);
    expect(questions.rows.some((question) => 'correct_choice_id' in question)).toBe(false);
    await completeScopedAssessment(attempt.id, 'pre-test');
    await rpc('advance_lesson_attempt_stage', [attempt.id]);
    const recovered = await rpc<{ id: string }>('start_assessment', ['pre-test', attempt.id, clientId]);
    expect(recovered.id).toBe(clientId);
  });

  async function completeScopedAssessment(lessonAttemptId: string, kind: 'pre-test' | 'post-test') {
    const assessment = await rpc<{ id: string }>('start_assessment', [kind, lessonAttemptId]);
    const questions = await pg.query<{ id: string; choices: Array<{ id: string }> }>(
      'select id,choices from public.get_assessment_questions($1,$2)',
      [kind, lessonAttemptId],
    );
    const answers = questions.rows.map((question) => ({
      question_id: question.id,
      selected_choice_id: question.choices[0].id,
    }));
    await rpc('sync_assessment_draft', [assessment.id, 0, 1, randomUUID(), answers]);
    await rpc('complete_assessment_revision', [assessment.id, 1]);
  }

  it('enforces pre-test, ordered chapters, post-test, and final lesson completion', async () => {
    const lesson = draft({
      prerequisiteLessonId: undefined,
      assessments: { preTest: 'pre-test', postTest: 'post-test' },
      assessmentQuestions: {
        'pre-test': [{
          id: 'pre-question', prompt: 'Pre-test prompt',
          choices: [{ id: 'pre-a', label: 'A' }, { id: 'pre-b', label: 'B' }],
          correctChoiceId: 'pre-a', isPlaceholder: false,
        }],
        'post-test': [{
          id: 'post-question', prompt: 'Post-test prompt',
          choices: [{ id: 'post-a', label: 'A' }, { id: 'post-b', label: 'B' }],
          correctChoiceId: 'post-a', isPlaceholder: false,
        }],
      },
    });
    const first = newChapter(1, 'Foundations');
    const second = newChapter(2, 'Applications');
    first.instructionalContent = [{ id: 'first-teaching', type: 'paragraph', title: 'First', body: 'Read first.' }];
    second.instructionalContent = [{ id: 'second-teaching', type: 'paragraph', title: 'Second', body: 'Read next.' }];
    first.activities = structuredClone(packagedContent.lessons[0].activities.slice(0, 2));
    second.activities = [structuredClone(packagedContent.lessons[0].activities[2])];
    lesson.chapters = [first, second];
    const item = await publish(await save(normalizeAuthoredLesson(lesson)));

    await asUser(studentId);
    let attempt = await rpc<{
      id: string;
      flow_stage: string;
      current_chapter_id: string;
    }>('start_lesson_attempt', [item.lesson_id]);
    expect(attempt).toMatchObject({ flow_stage: 'pre-test', current_chapter_id: first.id });
    await pg.exec('savepoint pretest_required');
    await expect(rpc('advance_lesson_attempt_stage', [attempt.id])).rejects.toThrow(
      'Complete the lesson pre-test first',
    );
    await pg.exec('rollback to savepoint pretest_required');

    await completeScopedAssessment(attempt.id, 'pre-test');
    attempt = await rpc('sync_lesson_attempt_stage', [attempt.id, 'pre-test', first.id]);
    expect(attempt.flow_stage).toBe('chapter-teaching');
    expect((await rpc<typeof attempt>('start_lesson_attempt', [item.lesson_id])).flow_stage).toBe(
      'chapter-teaching',
    );
    attempt = await rpc('sync_lesson_attempt_stage', [attempt.id, 'chapter-teaching', first.id]);
    expect(attempt.flow_stage).toBe('chapter-activity');

    const duplicateTeachingTransition = await rpc<typeof attempt>('sync_lesson_attempt_stage', [
      attempt.id,
      'chapter-teaching',
      first.id,
    ]);
    expect(duplicateTeachingTransition).toMatchObject({
      flow_stage: 'chapter-activity',
      current_chapter_id: first.id,
    });

    await pg.exec('reset role');
    const keys = await pg.query<{ activity_id: string; correct_answer: unknown }>(
      'select activity_id,correct_answer from public.lesson_activity_keys where lesson_id=$1 and content_version=$2 order by activity_id',
      [item.lesson_id, item.published_version],
    );
    await asUser(studentId);
    const firstKey = keys.rows.find((key) => key.activity_id === first.activities[0].id)!;
    const nextFirstChapterKey = keys.rows.find(
      (key) => key.activity_id === first.activities[1].id,
    )!;
    const secondKey = keys.rows.find((key) => key.activity_id === second.activities[0].id)!;
    await pg.exec('savepoint chapter_order_required');
    await expect(
      rpc('submit_lesson_activity_answer', [
        attempt.id,
        secondKey.activity_id,
        secondKey.correct_answer,
      ]),
    ).rejects.toThrow('current chapter');
    await pg.exec('rollback to savepoint chapter_order_required');
    await pg.exec('savepoint activity_order_required');
    await expect(
      rpc('submit_lesson_activity_answer', [
        attempt.id,
        nextFirstChapterKey.activity_id,
        nextFirstChapterKey.correct_answer,
      ]),
    ).rejects.toThrow('Complete activities in order');
    await pg.exec('rollback to savepoint activity_order_required');
    await rpc('submit_lesson_activity_answer', [
      attempt.id,
      firstKey.activity_id,
      firstKey.correct_answer,
    ]);
    await rpc('submit_lesson_activity_answer', [
      attempt.id,
      nextFirstChapterKey.activity_id,
      nextFirstChapterKey.correct_answer,
    ]);
    attempt = await rpc('advance_lesson_attempt_stage', [attempt.id]);
    expect(attempt).toMatchObject({
      flow_stage: 'chapter-teaching',
      current_chapter_id: second.id,
    });
    attempt = await rpc('advance_lesson_attempt_stage', [attempt.id]);
    await rpc('submit_lesson_activity_answer', [
      attempt.id,
      secondKey.activity_id,
      secondKey.correct_answer,
    ]);
    attempt = await rpc('advance_lesson_attempt_stage', [attempt.id]);
    expect(attempt.flow_stage).toBe('post-test');
    await pg.exec('savepoint posttest_required');
    await expect(rpc('complete_lesson_attempt', [attempt.id])).rejects.toThrow(
      'required lesson step',
    );
    await pg.exec('rollback to savepoint posttest_required');
    await completeScopedAssessment(attempt.id, 'post-test');
    attempt = await rpc('advance_lesson_attempt_stage', [attempt.id]);
    expect(attempt.flow_stage).toBe('ready-to-complete');
    expect(await rpc('complete_lesson_attempt', [attempt.id])).toMatchObject({
      status: 'completed',
    });
    const progressAfterCompletion = (
      await pg.query<{ attempt_count: number; xp_awarded: number }>(
        'select attempt_count,xp_awarded from public.lesson_progress where user_id=$1 and lesson_id=$2',
        [studentId, item.lesson_id],
      )
    ).rows[0];
    expect(await rpc('complete_lesson_attempt', [attempt.id])).toMatchObject({
      status: 'completed',
    });
    expect(
      (
        await pg.query<{ attempt_count: number; xp_awarded: number }>(
          'select attempt_count,xp_awarded from public.lesson_progress where user_id=$1 and lesson_id=$2',
          [studentId, item.lesson_id],
        )
      ).rows[0],
    ).toEqual(progressAfterCompletion);

    await pg.exec('savepoint lesson_attempt_required');
    await expect(rpc('start_assessment', ['pre-test'])).rejects.toThrow('Lesson attempt is required.');
    await pg.exec('rollback to savepoint lesson_attempt_required');
    await asUser(researcherId);
    const researcherResult = await pg.query<{ pre_test_status: string; post_test_status: string }>(
      "select pre_test_status,post_test_status from public.get_researcher_lesson_assessment_results() where username=$1 and lesson_id=$2",
      ['learner', item.lesson_id],
    );
    expect(researcherResult.rows[0]).toEqual({ pre_test_status: 'completed', post_test_status: 'completed' });
  });

  it('enforces the eight-lesson limit at the database boundary', async () => {
    for (let index = 0; index < 6; index += 1) await save(draft({ displayOrder: index + 3 }));
    await pg.exec('savepoint lesson_limit');
    await expect(save(draft({ displayOrder: 9 }))).rejects.toThrow('maximum of 8 lessons');
    await pg.exec('rollback to savepoint lesson_limit');
    const lessonCount = await pg.query<{ count: number }>(
      'select count(*)::int as count from public.get_admin_lessons()',
    );
    expect(lessonCount.rows[0].count).toBe(8);
  });
  it('seeds exact original authoring content and scoring versions without remapping IDs', async () => {
    const rows = (await pg.query<ManagedLesson>('select * from public.get_admin_lessons()')).rows;
    expect(rows.map((row) => row.draft.id)).toEqual(
      packagedContent.lessons.map((lesson) => lesson.id),
    );
    expect(rows.every((row) => row.draft.chapters.length === 1)).toBe(true);
    expect(rows.map((row) => row.published_version)).toEqual([2, 2]);
    expect(rows[0].draft.chapters[0].instructionalContent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'vocabulary-table',
          rows: expect.arrayContaining([
            expect.objectContaining({ term: 'Quantity', definition: '', example: '' }),
          ]),
        }),
      ]),
    );
    await asUser(studentId);
    const catalog = await rpc<unknown[]>('get_lesson_catalog');
    for (const lesson of catalog) expect(publicLessonSchema.safeParse(lesson).success).toBe(true);
  });
  it('migrates existing lessons into one chapter without changing progress or attempt ownership', async () => {
    await pg.exec('reset role');
    const chapters = await pg.query<{
      lesson_id: string;
      chapter_id: string;
      activity_count: number;
    }>(`
      select lesson_id, draft->'chapters'->0->>'id' as chapter_id,
        jsonb_array_length(draft->'chapters'->0->'activities')::int as activity_count
      from public.lesson_catalog order by lesson_id
    `);
    expect(chapters.rows).toEqual([
      {
        lesson_id: 'lesson-operation-signals',
        chapter_id: 'chapter-lesson-operation-signals',
        activity_count: 6,
      },
      {
        lesson_id: 'lesson-order-matters',
        chapter_id: 'chapter-lesson-order-matters',
        activity_count: 5,
      },
    ]);
    expect(
      (
        await pg.query<{ count: number }>(
          'select count(*)::int as count from public.lesson_attempts where user_id=$1',
          [studentId],
        )
      ).rows[0].count,
    ).toBeGreaterThan(0);
  });
  it('publishes multiple ordered chapters with isolated teaching content and activity order', async () => {
    const lesson = draft({ prerequisiteLessonId: undefined });
    const first = newChapter(1, 'Foundations');
    const second = newChapter(2, 'Applications');
    first.instructionalContent = [structuredClone(lesson.instructionalContent[0])];
    first.activities = [structuredClone(packagedContent.lessons[0].activities[1])];
    second.instructionalContent = [structuredClone(lesson.instructionalContent[1])];
    second.activities = [structuredClone(packagedContent.lessons[0].activities[0])];
    const authored = normalizeAuthoredLesson({ ...lesson, chapters: [second, first] });
    const item = await publish(await save(authored));

    await asUser(studentId);
    const published = await rpc<AuthoredLesson>('get_lesson_content', [item.lesson_id, null]);
    expect(published.chapters.map((chapter) => chapter.title)).toEqual([
      'Foundations',
      'Applications',
    ]);
    expect(published.chapters[0].activities.map((activity) => activity.id)).toEqual([
      first.activities[0].id,
    ]);
    expect(published.chapters[1].activities.map((activity) => activity.id)).toEqual([
      second.activities[0].id,
    ]);
    expect(published.activities.map((activity) => activity.id)).toEqual([
      first.activities[0].id,
      second.activities[0].id,
    ]);
  });
  it('keeps chapters isolated inside their owning lesson draft', async () => {
    const first = await save(draft({ prerequisiteLessonId: undefined }));
    const second = await save(draft({ displayOrder: 4, prerequisiteLessonId: undefined }));
    expect(first.draft.chapters[0].id).not.toBe(second.draft.chapters[0].id);
    expect(first.draft.chapters[0].activities[0].id).toBe(
      second.draft.chapters[0].activities[0].id,
    );
    expect(first.lesson_id).not.toBe(second.lesson_id);
  });
  it('creates and edits a draft with revision conflict protection and unchanged public content', async () => {
    const original = draft();
    const saved = await save(original);
    const edited = await save({ ...original, title: 'Edited title' }, saved.revision);
    expect(edited.draft.title).toBe('Edited title');
    await expect(save(original, saved.revision)).rejects.toThrow('changed in another session');
  });
  it('adds, edits, deletes and reorders both supported activity types', async () => {
    const lesson = draft({
      activities: structuredClone(packagedContent.lessons[0].activities.slice(0, 4)),
    });
    let item = await save(lesson);
    item = await save(
      withActivities(lesson, [
        { ...lesson.activities[3], title: 'Reordered' },
        lesson.activities[0],
      ]),
      item.revision,
    );
    item = await publish(item);
    expect(item.draft.activities.map((a) => a.type)).toEqual(['organize-translate', 'find-word']);
    await asUser(studentId);
    const published = await rpc<AuthoredLesson>('get_lesson_content', [item.lesson_id, null]);
    expect(published.activities[0].title).toBe('Reordered');
    expect(published.activities).toHaveLength(2);
  });
  it('hides drafts, publishes configured order/prerequisite, and unpublishes without deleting history', async () => {
    const item = await save(draft());
    await asUser(studentId);
    expect((await rpc<AuthoredLesson[]>('get_lesson_catalog')).map((l) => l.id)).not.toContain(
      item.lesson_id,
    );
    await expect(rpc('get_lesson_content', [item.lesson_id, null])).rejects.toThrow('unavailable');
  });
  it('publishes and unpublishes a lesson without resetting existing student scores', async () => {
    let item = await publish(await save(draft()));
    await asUser(studentId);
    const catalog = await rpc<AuthoredLesson[]>('get_lesson_catalog');
    expect(catalog.map((l) => l.displayOrder)).toEqual([1, 2, 3]);
    expect(catalog[2].prerequisiteLessonId).toBe('lesson-order-matters');
    await asUser(adminId);
    item = await publish(item, false);
    await asUser(studentId);
    expect((await rpc<AuthoredLesson[]>('get_lesson_catalog')).map((l) => l.id)).not.toContain(
      item.lesson_id,
    );
    expect(
      (
        await pg.query<{ best_score: number }>(
          "select best_score from public.lesson_progress where lesson_id='lesson-operation-signals'",
        )
      ).rows[0].best_score,
    ).toBe(100);
  });
  it('enforces 10 activities on the server and table constraint', async () => {
    const lesson = draft();
    const activities = Array.from({ length: 11 }, (_, i) => ({
      ...lesson.activities[0],
      id: `activity-${i}`,
    }));
    await expect(save(withActivities(lesson, activities))).rejects.toThrow('at most 10');
  });
  it('prevents an owner-level direct insert with 11 chapter activities', async () => {
    await pg.exec('reset role');
    const lesson = draft();
    const oversized = withActivities(
      lesson,
      Array.from({ length: 11 }, (_, index) => ({
        ...lesson.activities[0],
        id: `activity-${index}`,
      })),
    );
    await expect(
      pg.query('insert into public.lesson_catalog(lesson_id,draft) values($1,$2)', [
        lesson.id,
        oversized,
      ]),
    ).rejects.toThrow('at most 10 activities');
  });
  it.each(['title', 'shortDescription', 'passingThreshold', 'displayOrder'] as const)(
    'rejects invalid publication field %s',
    async (field) => {
      const lesson = draft();
      if (field === 'title' || field === 'shortDescription') lesson[field] = ' ';
      else lesson[field] = -1;
      // Some malformed metadata is rejected while saving already; either way publication cannot occur.
      await expect((async () => publish(await save(lesson)))()).rejects.toThrow();
    },
  );
  it('rejects incomplete activities, unsupported types and invalid correct answers at publication', async () => {
    const lesson = draft();
    const item = await save(withActivities(lesson, []));
    await expect(publish(item)).rejects.toThrow('1 to 10');
  });
  it('rejects an unknown activity engine type', async () => {
    const lesson = draft();
    (lesson.activities[0] as { type: string }).type = 'unsupported';
    const item = await save(lesson);
    await expect(publish(item)).rejects.toThrow('Unsupported');
  });
  it('rejects a correct choice missing from the options', async () => {
    const lesson = draft();
    if (lesson.activities[0].type === 'find-word') lesson.activities[0].correctChoiceId = 'missing';
    const item = await save(lesson);
    await expect(publish(item)).rejects.toThrow('valid correct answer');
  });
  it('rejects self prerequisites and draft cycles', async () => {
    const a = draft({ prerequisiteLessonId: undefined });
    await expect(save({ ...a, prerequisiteLessonId: a.id })).rejects.toThrow('cycle');
  });
  it('rejects circular prerequisite chains', async () => {
    const a = await save(draft({ prerequisiteLessonId: undefined }));
    const b = await save(draft({ displayOrder: 4, prerequisiteLessonId: a.lesson_id }));
    await expect(
      save({ ...a.draft, prerequisiteLessonId: b.lesson_id }, a.revision),
    ).rejects.toThrow('cycle');
  });
  it('rejects missing prerequisites', async () => {
    await expect(save(draft({ prerequisiteLessonId: 'lesson-missing' }))).rejects.toThrow(
      'does not exist',
    );
  });
  it('requires a published prerequisite and cannot archive a live dependency', async () => {
    const a = await save(draft());
    const b = await save(draft({ displayOrder: 4, prerequisiteLessonId: a.lesson_id }));
    await expect(publish(b)).rejects.toThrow('Publish the prerequisite');
  });
  it('prevents unpublishing Lesson 1 while published Lesson 2 depends on it', async () => {
    const item = (
      await pg.query<ManagedLesson>(
        "select * from public.get_admin_lessons() where lesson_id='lesson-operation-signals'",
      )
    ).rows[0];
    await expect(publish(item, false)).rejects.toThrow('dependent lessons');
  });
  it('keeps drafts out of progression and unlocks published successors with completion/streak intact', async () => {
    const unpublished = await save(draft({ displayOrder: 4 }));
    const item = await publish(await save(draft()));
    await asUser(studentId);
    await rpc('initialize_lesson_progress');
    const before = await pg.query<{ lesson_id: string; status: string }>(
      'select lesson_id,status from public.lesson_progress',
    );
    expect(before.rows.find((r) => r.lesson_id === item.lesson_id)?.status).toBe('locked');
    expect(before.rows.find((r) => r.lesson_id === unpublished.lesson_id)).toBeUndefined();
    await completeLesson('lesson-order-matters');
    expect(
      (
        await pg.query<{ status: string }>(
          'select status from public.lesson_progress where lesson_id=$1',
          [item.lesson_id],
        )
      ).rows[0].status,
    ).toBe('available');
    const attempt = await completeLesson(item.lesson_id);
    expect(
      (
        await pg.query<{ final_score: number }>(
          'select final_score from public.lesson_attempts where id=$1',
          [attempt.id],
        )
      ).rows[0].final_score,
    ).toBe(100);
    expect(await rpc('get_student_streak')).toMatchObject({ current_streak: 1 });
  });
  it('pins resumed attempts to original activities, scoring, and feedback after a new publication', async () => {
    let item = await publish(await save(draft({ prerequisiteLessonId: undefined })));
    await asUser(studentId);
    const attempt = await rpc<{ id: string; content_version: number }>('start_lesson_attempt', [
      item.lesson_id,
    ]);
    await asUser(adminId);
    const oldActivity = item.draft.activities[0];
    const updated = withActivities(
      {
        ...item.draft,
        title: 'New title',
        passingThreshold: 100,
      },
      [{ ...oldActivity, id: 'new-activity' }],
    );
    item = await publish(await save(updated, item.revision));
    await asUser(studentId);
    const old = await rpc<AuthoredLesson>('get_lesson_content', [item.lesson_id, attempt.id]);
    expect(old.contentVersion).toBe(attempt.content_version);
    expect(old.activities[0].id).toBe(oldActivity.id);
    expect(
      (await rpc<AuthoredLesson>('get_lesson_content', [item.lesson_id, null])).activities[0].id,
    ).toBe('new-activity');
    await rpc('submit_lesson_activity_answer', [
      attempt.id,
      oldActivity.id,
      (oldActivity as { correctChoiceId: string }).correctChoiceId,
    ]);
    await rpc('complete_lesson_attempt', [attempt.id]);
    expect(
      (
        await pg.query<{ final_score: number }>(
          'select final_score from public.lesson_attempts where id=$1',
          [attempt.id],
        )
      ).rows[0].final_score,
    ).toBe(100);
    const next = await rpc<{ id: string; content_version: number }>('start_lesson_attempt', [
      item.lesson_id,
    ]);
    expect(next.id).not.toBe(attempt.id);
    expect(next.content_version).toBe(item.published_version);
    expect((await rpc<{ id: string }>('start_lesson_attempt', [item.lesson_id])).id).toBe(next.id);
    await asUser(adminId);
    await publish(item, false);
    await asUser(studentId);
    expect(
      (await rpc<AuthoredLesson>('get_lesson_content', [item.lesson_id, attempt.id])).title,
    ).toBe(old.title);
    expect((await rpc<AuthoredLesson>('get_lesson_content', [item.lesson_id, next.id])).title).toBe(
      'New title',
    );
  });
  it('protects private keys and feedback before submission, with submitted activity feedback only', async () => {
    await asUser(studentId);
    const catalog = await rpc<AuthoredLesson[]>('get_lesson_catalog');
    expect(JSON.stringify(catalog)).not.toMatch(
      /correctChoiceId|correctTokenSequence|Correct word: sum/,
    );
    const attempt = await rpc<{ id: string }>('start_lesson_attempt', ['lesson-operation-signals']);
    await rpc('submit_lesson_activity_answer', [attempt.id, 'find-sum', 'sum']);
    const content = await rpc<AuthoredLesson>('get_lesson_content', [
      'lesson-operation-signals',
      attempt.id,
    ]);
    expect(content.activities[0].explanation).toEqual(
      packagedContent.lessons[0].activities[0].explanation,
    );
    expect(JSON.stringify(content.activities[1])).not.toContain('correctChoiceId');
  });
  it('accepts an omitted authored explanation and releases only the submitted activity answer', async () => {
    const authored = draft({ prerequisiteLessonId: undefined });
    const activity = authored.chapters[0].activities[0];
    delete activity.explanation;
    const published = await publish(await save(authored));

    await asUser(studentId);
    const attempt = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    const before = await rpc<AuthoredLesson>('get_lesson_content', [published.lesson_id, attempt.id]);
    expect(before.activities[0]).not.toHaveProperty('correctChoiceId');

    const wrongChoice = activity.type === 'organize-translate'
      ? activity.tokens.map((token) => token.id).reverse()
      : activity.choices.find((choice) => choice.id !== activity.correctChoiceId)!.id;
    await rpc('submit_lesson_activity_answer', [attempt.id, activity.id, wrongChoice]);
    const after = await rpc<AuthoredLesson>('get_lesson_content', [published.lesson_id, attempt.id]);
    const releasedActivity = after.activities.find((item) => item.id === activity.id);
    expect(releasedActivity).toBeDefined();
    if (activity.type === 'organize-translate') {
      expect(releasedActivity?.type === 'organize-translate' ? releasedActivity.correctTokenSequence : undefined)
        .toEqual(activity.correctTokenSequence);
    } else {
      expect(releasedActivity && releasedActivity.type !== 'organize-translate'
        ? releasedActivity.correctChoiceId
        : undefined).toBe(activity.correctChoiceId);
    }
    expect(after.activities[0].explanation).toBeUndefined();
  });
  it('releases the correct Arrange Words sequence after its answer is submitted without exposing alternatives', async () => {
    const activity = structuredClone(packagedContent.lessons[0].activities.find(
      (candidate) => candidate.type === 'organize-translate',
    )!);
    if (activity.type !== 'organize-translate') throw new Error('Expected Arrange Words activity.');
    activity.acceptedTokenSequences = [activity.correctTokenSequence, [...activity.correctTokenSequence].reverse()];
    const authored = draft({ prerequisiteLessonId: undefined, activities: [activity] });
    const published = await publish(await save(authored));
    await asUser(studentId);
    const attempt = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    const before = await rpc<AuthoredLesson>('get_lesson_content', [published.lesson_id, attempt.id]);
    expect(before.activities[0]).not.toHaveProperty('correctTokenSequence');
    const wrongOrder = [
      ...activity.correctTokenSequence.slice(1),
      activity.correctTokenSequence[0],
    ];
    await rpc('submit_lesson_activity_answer', [attempt.id, activity.id, wrongOrder]);
    const after = await rpc<AuthoredLesson>('get_lesson_content', [published.lesson_id, attempt.id]);
    const releasedActivity = after.activities.find((item) => item.id === activity.id);
    expect(releasedActivity?.type === 'organize-translate' ? releasedActivity.correctTokenSequence : undefined)
      .toEqual(activity.correctTokenSequence);
    expect(releasedActivity).not.toHaveProperty('acceptedTokenSequences');
  });
  it.each(['lesson_catalog', 'lesson_definitions', 'lesson_activity_keys', 'admin_users'])(
    'students cannot mutate %s',
    async (table) => {
      await asUser(studentId);
      await expect(pg.exec(`delete from public.${table}`)).rejects.toThrow('permission denied');
    },
  );
  it.each(['lesson_catalog', 'lesson_definitions', 'lesson_activity_keys'])(
    'students cannot enumerate %s',
    async (table) => {
      await asUser(studentId);
      await expect(pg.exec(`select * from public.${table}`)).rejects.toThrow('permission denied');
    },
  );
  it.each(['student', 'researcher', 'anonymous'])(
    '%s cannot create or publish lessons',
    async (kind) => {
      await asUser(
        kind === 'student' ? studentId : kind === 'researcher' ? researcherId : '',
        kind === 'anonymous' ? 'anon' : 'authenticated',
      );
      await expect(save(draft())).rejects.toThrow(
        kind === 'anonymous' ? 'permission denied' : 'Admin access required',
      );
    },
  );
  it.each(['student', 'researcher', 'anonymous'])(
    '%s cannot publish through the RPC',
    async (kind) => {
      const item = await save(draft());
      await asUser(
        kind === 'student' ? studentId : kind === 'researcher' ? researcherId : '',
        kind === 'anonymous' ? 'anon' : 'authenticated',
      );
      await expect(publish(item)).rejects.toThrow(
        kind === 'anonymous' ? 'permission denied' : 'Admin access required',
      );
    },
  );
  it('does not implicitly promote a researcher to admin', async () => {
    await asUser(researcherId);
    expect(await rpc('is_admin')).toBe(false);
    await expect(rpc('get_admin_lessons')).rejects.toThrow('Admin access required');
  });
  it('updates untouched lock state when an admin removes a prerequisite', async () => {
    let item = await publish(await save(draft()));
    await asUser(studentId);
    await rpc('initialize_lesson_progress');
    await asUser(adminId);
    item = await publish(
      await save({ ...item.draft, prerequisiteLessonId: undefined }, item.revision),
    );
    await asUser(studentId);
    await rpc('initialize_lesson_progress');
    expect(
      (
        await pg.query<{ status: string }>(
          'select status from public.lesson_progress where lesson_id=$1',
          [item.lesson_id],
        )
      ).rows[0].status,
    ).toBe('available');
    expect(await rpc('start_lesson_attempt', [item.lesson_id])).toMatchObject({
      lesson_id: item.lesson_id,
    });
  });
  it('draft edits leave the live snapshot unchanged until publication', async () => {
    const item = await publish(await save(draft()));
    await save({ ...item.draft, title: 'Only a draft' }, item.revision);
    await asUser(studentId);
    expect((await rpc<AuthoredLesson>('get_lesson_content', [item.lesson_id, null])).title).toBe(
      item.draft.title,
    );
  });
  it('projects only allowlisted public fields, including nested choices and hints', async () => {
    const lesson = draft();
    Object.assign(lesson, { privateKey: 'SECRET' });
    Object.assign(lesson.activities[0], { privateKey: 'SECRET' });
    const activity = lesson.activities[0];
    if (activity.type === 'find-word')
      Object.assign(activity.choices[0], { correctChoiceId: 'SECRET' });
    Object.assign(activity.hint!, { correctAnswer: 'SECRET' });
    const item = await publish(await save(lesson));
    await asUser(studentId);
    const content = await rpc('get_lesson_content', [item.lesson_id, null]);
    expect(JSON.stringify(content)).not.toContain('SECRET');
    expect(publicLessonSchema.safeParse(content).success).toBe(true);
  });
  it('denies reading another student attempt feedback', async () => {
    await asUser(studentId);
    const attempt = await rpc<{ id: string }>('start_lesson_attempt', ['lesson-operation-signals']);
    await asUser(adminId);
    await expect(
      rpc('get_lesson_content', ['lesson-operation-signals', attempt.id]),
    ).rejects.toThrow('unavailable');
  });
  it('denies new attempts once a lesson is unpublished', async () => {
    const item = await publish(await save(draft({ prerequisiteLessonId: undefined })));
    await publish(item, false);
    await asUser(studentId);
    await expect(rpc('start_lesson_attempt', [item.lesson_id])).rejects.toThrow('Lesson not found');
  });

  it('keeps historical progress but returns an empty active catalog after lessons are removed', async () => {
    const items = (
      await pg.query<ManagedLesson>('select * from public.get_admin_lessons() order by lesson_id')
    ).rows;
    const second = items.find((item) => item.lesson_id === 'lesson-order-matters');
    const first = items.find((item) => item.lesson_id === 'lesson-operation-signals');
    if (!first || !second) throw new Error('Missing seeded lessons.');
    await publish(second, false);
    await publish(first, false);

    const freshStudentId = randomUUID();
    await pg.exec('reset role');
    await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      freshStudentId,
      'fresh@example.invalid',
      { username: `fresh_${freshStudentId.slice(0, 8)}`, display_name: 'Fresh student' },
    ]);
    await asUser(freshStudentId);
    expect(await rpc<AuthoredLesson[]>('get_lesson_catalog')).toEqual([]);
    await pg.query('select * from public.initialize_lesson_progress()');
    expect(
      (
        await pg.query<{ count: number }>(
          'select count(*)::int as count from public.lesson_progress where user_id=$1',
          [freshStudentId],
        )
      ).rows[0].count,
    ).toBe(0);

    await pg.exec('reset role');
    expect(
      (
        await pg.query<{ count: number }>(
          'select count(*)::int as count from public.lesson_progress where user_id=$1',
          [studentId],
        )
      ).rows[0].count,
    ).toBeGreaterThan(0);
    await asUser(researcherId);
    const result = (
      await pg.query<{ lessons_available: number; lesson_results: unknown[] }>(
        'select lessons_available,lesson_results from public.get_researcher_results() where username=$1',
        ['learner'],
      )
    ).rows[0];
    expect(result).toEqual({ lessons_available: 0, lesson_results: [] });
  });

  it('returns only participant code and username identity fields through the researcher boundary', async () => {
    await asUser(researcherId);
    const result = (
      await pg.query<{ result: Record<string, unknown> }>(
        'select to_jsonb(row) as result from public.get_researcher_results() row where username=$1',
        ['learner'],
      )
    ).rows[0].result;
    expect(result).toMatchObject({ username: 'learner' });
    expect(result.participant_code).toMatch(/^ALT-[A-F0-9]{8}$/);
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('display_name');
    expect(result).not.toHaveProperty('user_id');

    await asUser(studentId);
    await pg.exec('savepoint student_researcher_results_denied');
    await expect(pg.query('select * from public.get_researcher_results()')).rejects.toThrow(
      'Researcher access required',
    );
    await pg.exec('rollback to savepoint student_researcher_results_denied');
    await asUser('', 'anon');
    await pg.exec('savepoint anonymous_researcher_results_denied');
    await expect(pg.query('select * from public.get_researcher_results()')).rejects.toThrow(
      'permission denied',
    );
    await pg.exec('rollback to savepoint anonymous_researcher_results_denied');
  });

  it('counts students while excluding researcher-only, admin-only, and dual-role accounts', async () => {
    await asUser(researcherId);
    const results = await pg.query<{ username: string }>(
      'select username from public.get_researcher_results() order by username',
    );

    expect(results.rows).toEqual([{ username: 'learner' }]);
    expect(results.rows).toHaveLength(1);
  });

  it('records a retried active-time segment only once', async () => {
    await asUser(studentId);
    const attempt = await rpc<{ id: string }>('start_lesson_attempt', ['lesson-operation-signals']);
    const segmentId = randomUUID();

    await rpc('add_attempt_active_seconds', [attempt.id, 30, segmentId]);
    await rpc('add_attempt_active_seconds', [attempt.id, 30, segmentId]);

    await pg.exec('reset role');
    const recorded = await pg.query<{ active_seconds: number }>(
      'select active_seconds from public.lesson_attempts where id=$1',
      [attempt.id],
    );
    expect(recorded.rows[0].active_seconds).toBe(30);
    const segments = await pg.query<{ count: number }>(
      'select count(*)::int as count from public.lesson_active_time_segments where attempt_id=$1',
      [attempt.id],
    );
    expect(segments.rows[0].count).toBe(1);
  });

  it('replays a durable active-time segment after the lesson result is confirmed', async () => {
    await asUser(studentId);
    const completed = await pg.query<{ id: string; active_seconds: number }>(
      "select id, active_seconds from public.lesson_attempts where user_id=$1 and status='completed' limit 1",
      [studentId],
    );
    const attempt = completed.rows[0];
    const segmentId = randomUUID();

    await rpc('add_attempt_active_seconds', [attempt.id, 12, segmentId]);
    await rpc('add_attempt_active_seconds', [attempt.id, 12, segmentId]);

    await pg.exec('reset role');
    const recorded = await pg.query<{ active_seconds: number }>(
      'select active_seconds from public.lesson_attempts where id=$1',
      [attempt.id],
    );
    expect(recorded.rows[0].active_seconds).toBe(attempt.active_seconds + 12);
    const segments = await pg.query<{ count: number }>(
      'select count(*)::int as count from public.lesson_active_time_segments where segment_id=$1',
      [segmentId],
    );
    expect(segments.rows[0].count).toBe(1);
  });

  it('publishes a custom attempt limit and blocks a direct server start at the cap', async () => {
    const authored = draft({
      prerequisiteLessonId: undefined,
      attemptLimit: { mode: 'limited', maxAttempts: 2 },
    });
    const saved = await save(authored);
    expect(saved.draft.attemptLimit).toEqual({ mode: 'limited', maxAttempts: 2 });
    const published = await publish(saved);
    await pg.exec('reset role');
    const version = await pg.query<{ attempt_limit: unknown }>(
      "select presentation->'attemptLimit' as attempt_limit from public.lesson_definitions where lesson_id=$1 and content_version=$2",
      [published.lesson_id, published.published_version],
    );
    expect(version.rows[0].attempt_limit).toEqual({ mode: 'limited', maxAttempts: 2 });

    await asUser(studentId);
    const first = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    await rpc('abandon_lesson_attempt', [first.id]);
    const second = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    await rpc('abandon_lesson_attempt', [second.id]);

    const catalog = await rpc<Array<Record<string, unknown>>>('get_lesson_catalog');
    expect(catalog.find((lesson) => lesson.id === published.lesson_id)).toMatchObject({
      attemptsUsed: 2,
      attemptLimitReached: true,
      attemptLimit: { mode: 'limited', maxAttempts: 2 },
    });
    const overview = await rpc<Record<string, unknown>>('get_lesson_content', [published.lesson_id, null]);
    expect(overview).toMatchObject({ attemptsUsed: 2, attemptLimitReached: true });

    await pg.exec('savepoint attempt_limit_blocked');
    await expect(rpc('start_lesson_attempt', [published.lesson_id])).rejects.toThrow(
      'Lesson attempt limit reached.',
    );
    await pg.exec('rollback to savepoint attempt_limit_blocked');
    await pg.exec('reset role');
    const count = await pg.query<{ count: number }>(
      'select count(*)::int as count from public.lesson_attempts where user_id=$1 and lesson_id=$2',
      [studentId, published.lesson_id],
    );
    expect(count.rows[0].count).toBe(2);
  });

  it('serializes rapid starts so duplicate requests cannot exceed a one-attempt limit', async () => {
    const authored = draft({
      prerequisiteLessonId: undefined,
      attemptLimit: { mode: 'limited', maxAttempts: 1 },
    });
    const published = await publish(await save(authored));
    await asUser(studentId);

    const [first, duplicate] = await Promise.all([
      rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]),
      rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]),
    ]);
    expect(duplicate.id).toBe(first.id);
    await rpc('abandon_lesson_attempt', [first.id]);
    await pg.exec('savepoint duplicate_limit_blocked');
    await expect(rpc('start_lesson_attempt', [published.lesson_id])).rejects.toThrow(
      'Lesson attempt limit reached.',
    );
    await pg.exec('rollback to savepoint duplicate_limit_blocked');
    await pg.exec('reset role');
    const count = await pg.query<{ count: number }>(
      'select count(*)::int as count from public.lesson_attempts where user_id=$1 and lesson_id=$2',
      [studentId, published.lesson_id],
    );
    expect(count.rows[0].count).toBe(1);
  });

  it('keeps old lessons Unlimited and preserves attempt history when the cap changes', async () => {
    const legacy = normalizeAuthoredLesson(structuredClone(packagedContent.lessons[0]));
    expect(legacy.attemptLimit).toEqual({ mode: 'unlimited', maxAttempts: null });

    const authored = draft({ prerequisiteLessonId: undefined });
    const firstPublished = await publish(await save(authored));
    await asUser(studentId);
    const existing = await rpc<{ id: string }>('start_lesson_attempt', [firstPublished.lesson_id]);
    await rpc('abandon_lesson_attempt', [existing.id]);

    await asUser(adminId);
    const changed = {
      ...firstPublished,
      draft: { ...firstPublished.draft, attemptLimit: { mode: 'limited' as const, maxAttempts: 1 } },
    };
    const saved = await save(changed.draft, changed.revision);
    const republished = await publish(saved);
    await asUser(studentId);
    await pg.exec('savepoint lowered_limit_blocked');
    await expect(rpc('start_lesson_attempt', [republished.lesson_id])).rejects.toThrow(
      'Lesson attempt limit reached.',
    );
    await pg.exec('rollback to savepoint lowered_limit_blocked');
    await pg.exec('reset role');
    const history = await pg.query<{ count: number }>(
      'select count(*)::int as count from public.lesson_attempts where user_id=$1 and lesson_id=$2',
      [studentId, republished.lesson_id],
    );
    expect(history.rows[0].count).toBe(1);
  });

  it('does not block repeated retries when a lesson is Unlimited', async () => {
    const authored = draft({ prerequisiteLessonId: undefined });
    const published = await publish(await save(authored));
    await asUser(studentId);
    const first = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    await rpc('abandon_lesson_attempt', [first.id]);
    const second = await rpc<{ id: string }>('start_lesson_attempt', [published.lesson_id]);
    expect(second.id).not.toBe(first.id);
  });
});
