// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import type { AuthoredLesson, ManagedLesson } from './lesson-management.service';
import { publicLessonSchema } from '@/features/lessons/domain/content.schemas';

let pg: PGlite;
const adminId = randomUUID(),
  studentId = randomUUID(),
  researcherId = randomUUID();
const migration = '202609120002_basic_lesson_management.sql';
async function asUser(id: string, role = 'authenticated') {
  await pg.exec(`reset role; set role ${role};`);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function rpc<T>(name: string, args: unknown[] = []): Promise<T> {
  // Names are fixed test code, never user input.
  if (name === 'submit_lesson_activity_answer')
    args = args.map((value, index) => (index === 2 ? JSON.stringify(value) : value));
  return (
    await pg.query<{ result: T }>(
      `select to_jsonb(public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})) as result`,
      args,
    )
  ).rows[0].result;
}
function draft(overrides: Partial<AuthoredLesson> = {}): AuthoredLesson {
  return {
    ...structuredClone(packagedContent.lessons[0]),
    id: `lesson-${randomUUID()}`,
    title: 'Test authoring lesson',
    displayOrder: 3,
    contentVersion: 1,
    prerequisiteLessonId: 'lesson-order-matters',
    activities: [structuredClone(packagedContent.lessons[0].activities[0])],
    ...overrides,
  };
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
  await pg.query('insert into public.admin_users(user_id) values($1)', [adminId]);
  await pg.query('insert into public.researcher_users(user_id) values($1)', [researcherId]);
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
  it('seeds exact original authoring content and scoring versions without remapping IDs', async () => {
    const rows = (await pg.query<ManagedLesson>('select * from public.get_admin_lessons()')).rows;
    expect(rows.map((row) => row.draft)).toEqual(packagedContent.lessons);
    expect(rows.map((row) => row.published_version)).toEqual([1, 2]);
    await asUser(studentId);
    const catalog = await rpc<unknown[]>('get_lesson_catalog');
    for (const lesson of catalog) expect(publicLessonSchema.safeParse(lesson).success).toBe(true);
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
      {
        ...lesson,
        activities: [{ ...lesson.activities[3], title: 'Reordered' }, lesson.activities[0]],
      },
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
    lesson.activities = Array.from({ length: 11 }, (_, i) => ({
      ...lesson.activities[0],
      id: `activity-${i}`,
    }));
    await expect(save(lesson)).rejects.toThrow('at most 10');
  });
  it('prevents an owner-level direct insert with 11 activities via a database check', async () => {
    await pg.exec('reset role');
    const lesson = draft();
    lesson.activities = Array.from({ length: 11 }, () => lesson.activities[0]);
    await expect(
      pg.query('insert into public.lesson_catalog(lesson_id,draft) values($1,$2)', [
        lesson.id,
        lesson,
      ]),
    ).rejects.toThrow('check constraint');
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
    const item = await save({ ...lesson, activities: [] });
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
    const updated = {
      ...item.draft,
      title: 'New title',
      passingThreshold: 100,
      activities: [{ ...oldActivity, id: 'new-activity' }],
    };
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
});
