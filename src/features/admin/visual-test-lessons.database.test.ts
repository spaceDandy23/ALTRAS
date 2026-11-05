// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let pg: PGlite;
const adminId = randomUUID();
const studentId = randomUUID();
const laterMigrations = [
  '202610300001_lesson_chapters.sql',
  '202610300002_lesson_chapter_runtime.sql',
  '202610300003_lesson_offline_transitions.sql',
  '202610310001_offline_assessment_start.sql',
  '202611040001_lesson_scoped_assessments.sql',
  '202611040002_reconcile_completed_attempt_active_time.sql',
  '202611040003_choose_correct_translation_activity.sql',
  '202611040004_vocabulary_word_list_star_thresholds.sql',
  '202611050001_visual_test_lessons.sql',
  '202611050002_multi_accepted_organize_answers.sql',
];

async function asUser(id: string) {
  await pg.exec('reset role; set role authenticated;');
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,encrypted_password text,raw_user_meta_data jsonb default '{}',
      created_at timestamptz not null default now(), last_sign_in_at timestamptz, banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of readdirSync(resolve('supabase/migrations'))
    .filter((name) => name.endsWith('.sql') && name < laterMigrations[0])
    .sort()) {
    await pg.exec(readFileSync(resolve('supabase/migrations', file), 'utf8').replace(
      'create extension if not exists pgcrypto;', '',
    ));
  }
  for (const file of laterMigrations.slice(0, -1)) {
    try {
      await pg.exec(readFileSync(resolve('supabase/migrations', file), 'utf8'));
    } catch (error) {
      throw new Error(`Failed migration ${file}: ${String(error)}`);
    }
  }

  for (const [id, username] of [[adminId, 'visual_admin'], [studentId, 'visual_student']]) {
    await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      id, `${username}@example.invalid`, { username, display_name: username },
    ]);
  }
  await pg.query('insert into public.admin_users(user_id) values($1)', [adminId]);
  try {
    await pg.exec(readFileSync(resolve('supabase/migrations', laterMigrations.at(-1)!), 'utf8'));
  } catch (error) {
    const detail = error && typeof error === 'object' && 'detail' in error ? String(error.detail) : String(error);
    const where = error && typeof error === 'object' && 'where' in error ? String(error.where) : '';
    throw new Error(`Failed migration ${laterMigrations.at(-1)}: ${detail} ${where}`);
  }
}, 30000);

afterAll(async () => {
  await pg?.close();
});

describe('visual testing lesson seed migration', () => {
  it('publishes five lessons in order with a sequential prerequisite chain', async () => {
    await asUser(studentId);
    const response = await pg.query<{ lessons: Array<{ id: string; title: string; displayOrder: number; prerequisiteLessonId?: string; chapters: unknown[] }> }>(
      'select public.get_lesson_catalog() as lessons',
    );
    expect(response.rows[0].lessons.map(({ id, title, displayOrder }) => [id, title, displayOrder])).toEqual([
      ['lesson-foundational-concepts', 'Foundational Concepts', 1],
      ['lesson-operation-signals', 'Operation Words', 2],
      ['lesson-order-matters', 'Order Matters', 3],
      ['lesson-writing-verbal-expressions', 'Writing Verbal Expressions', 4],
      ['lesson-translating-mathematical-expressions', 'Translating Mathematical Expressions', 5],
    ]);
    expect(response.rows[0].lessons.map((lesson) => lesson.prerequisiteLessonId ?? null)).toEqual([
      null,
      'lesson-foundational-concepts',
      'lesson-operation-signals',
      'lesson-order-matters',
      'lesson-writing-verbal-expressions',
    ]);
    expect(response.rows[0].lessons.map((lesson) => lesson.chapters.length)).toEqual([2, 2, 2, 2, 3]);
    expect(response.rows[0].lessons.every((lesson) =>
      JSON.stringify(lesson.chapters).includes('vocabulary-table'),
    )).toBe(true);
  });

  it('keeps the current Operation Signals source content and publishes lesson-scoped assessments and varied activities', async () => {
    await pg.exec('reset role');
    const { rows } = await pg.query<{ presentation: { chapters: Array<{ instructionalContent: unknown[]; activities: Array<{ type: string }> }> }; pre_assessment_version: number | null; post_assessment_version: number | null }>(
      `select d.presentation,d.pre_assessment_version,d.post_assessment_version
       from public.lesson_catalog c join public.lesson_definitions d
       on (d.lesson_id,d.content_version)=(c.lesson_id,c.published_version)
       where c.lesson_id='lesson-operation-signals'`,
    );
    const operation = rows[0];
    expect(operation.presentation.chapters).toHaveLength(2);
    expect(JSON.stringify(operation.presentation)).toContain('intro-operation-signals');
    expect(operation.pre_assessment_version).not.toBeNull();
    expect(operation.post_assessment_version).not.toBeNull();

    const { rows: activityRows } = await pg.query<{ activity_type: string }>(
      `select activity_type from public.lesson_activity_keys
       where lesson_id='lesson-foundational-concepts'
       and content_version=(select published_version from public.lesson_catalog where lesson_id='lesson-foundational-concepts')`,
    );
    expect(new Set(activityRows.map((row) => row.activity_type))).toEqual(new Set([
      'find-word', 'organize-translate', 'choose-correct-translation',
    ]));
    const { rows: assessments } = await pg.query<{ assessment: string; count: number }>(
      `select assessment,count(*)::int as count from public.assessment_questions q
       join public.lesson_catalog c on c.lesson_id=q.lesson_id and c.published_version=q.content_version
       group by assessment`,
    );
    expect(assessments).toHaveLength(2);
    expect(assessments.every((assessment) => assessment.count >= 5)).toBe(true);
  });
});
