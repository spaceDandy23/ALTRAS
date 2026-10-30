// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ManagedAssessment } from './assessment-management.service';

let pg: PGlite;
const migration = '202609150001_admin_assessment_management.sql';
const adminId = randomUUID();
const studentId = randomUUID();
const nextStudentId = randomUUID();
const researcherId = randomUUID();

async function asUser(id: string, role = 'authenticated') {
  await pg.exec(`reset role; set role ${role};`);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}

async function rpc<T>(name: string, args: unknown[] = []): Promise<T> {
  return (
    await pg.query<{ result: T }>(
      `select to_jsonb(public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')})) as result`,
      args.map((value) => (typeof value === 'object' ? JSON.stringify(value) : value)),
    )
  ).rows[0].result;
}

async function assessmentQuestions(kind: 'pre-test' | 'post-test') {
  return (
    await pg.query<{
      id: string;
      prompt: string;
      content_version: number;
      choices: unknown;
    }>('select * from public.get_assessment_questions($1)', [kind])
  ).rows;
}

async function expectDatabaseFailure(operation: () => Promise<unknown>, message: string) {
  await pg.exec('savepoint expected_failure');
  try {
    await operation();
    throw new Error('Expected database operation to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(message);
  } finally {
    await pg.exec('rollback to savepoint expected_failure');
  }
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,encrypted_password text,raw_user_meta_data jsonb default '{}',
      created_at timestamptz not null default now(), last_sign_in_at timestamptz, banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of readdirSync(resolve('supabase/migrations'))
    .filter((name) => name.endsWith('.sql') && name < migration)
    .sort()) {
    await pg.exec(
      readFileSync(resolve('supabase/migrations', file), 'utf8').replace(
        'create extension if not exists pgcrypto;',
        '',
      ),
    );
  }
  for (const [id, username] of [
    [adminId, 'assessment_admin'],
    [studentId, 'assessment_student'],
    [nextStudentId, 'assessment_next'],
    [researcherId, 'assessment_researcher'],
  ]) {
    await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
      id,
      `${username}@example.invalid`,
      { username, display_name: username },
    ]);
  }
  await pg.query('insert into public.admin_users(user_id) values($1)', [adminId]);
  await pg.query('insert into public.researcher_users(user_id) values($1)', [researcherId]);
  await pg.exec(readFileSync(resolve('supabase/migrations', migration), 'utf8'));
}, 30000);

beforeEach(async () => {
  await pg.exec('reset role; begin');
  await asUser(adminId);
});
afterEach(async () => pg.exec('rollback'));
afterAll(async () => pg?.close());

describe('Admin assessment management SQL', () => {
  it('seeds editable Pre-test and Post-test drafts with private answer keys', async () => {
    const items =
      await rpc<Array<{ assessment: string; draft: { questions: unknown[] } }>>(
        'get_admin_assessments',
      );
    expect(items.map((item) => item.assessment).sort()).toEqual(['post-test', 'pre-test']);
    expect(items.every((item) => item.draft.questions.length > 0)).toBe(true);
    expect(JSON.stringify(items)).toContain('correctChoiceId');
  });

  it('saves draft edits without mutating the live question version', async () => {
    const [item] = (await rpc<ManagedAssessment[]>('get_admin_assessments')).filter(
      (value) => value.assessment === 'pre-test',
    );
    await pg.exec('reset role');
    const before = await pg.query(
      'select prompt from public.assessment_questions where assessment=$1 and content_version=$2 order by display_order',
      ['pre-test', item.published_version],
    );
    await asUser(adminId);
    item.draft.questions[0].prompt = 'Draft-only wording';
    const saved = await rpc<ManagedAssessment>('save_admin_assessment', [
      'pre-test',
      item.draft,
      item.revision,
    ]);
    expect(saved.draft.questions[0].prompt).toBe('Draft-only wording');
    await pg.exec('reset role');
    const after = await pg.query(
      'select prompt from public.assessment_questions where assessment=$1 and content_version=$2 order by display_order',
      ['pre-test', item.published_version],
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('rejects invalid publication and accepts a structurally valid new version', async () => {
    const item = (await rpc<ManagedAssessment[]>('get_admin_assessments')).find(
      (value) => value.assessment === 'post-test',
    )!;
    const empty = { assessment: 'post-test', questions: [] };
    const saved = await rpc<ManagedAssessment>('save_admin_assessment', [
      'post-test',
      empty,
      item.revision,
    ]);
    await expectDatabaseFailure(
      () => rpc('publish_admin_assessment', ['post-test', saved.revision]),
      'at least one question',
    );

    const valid = {
      assessment: 'post-test',
      questions: [
        {
          id: 'new-question',
          prompt: 'Which expression means twice a number?',
          choices: [
            { id: 'a', label: '2x' },
            { id: 'b', label: 'x + 2' },
          ],
          correctChoiceId: 'a',
          isPlaceholder: false,
        },
      ],
    };
    const ready = await rpc<ManagedAssessment>('save_admin_assessment', [
      'post-test',
      valid,
      saved.revision,
    ]);
    const published = await rpc<ManagedAssessment>('publish_admin_assessment', [
      'post-test',
      ready.revision,
    ]);
    expect(published.published_version).toBe(item.published_version + 1);
  });

  it('pins an existing attempt while a new student receives the new version', async () => {
    await asUser(studentId);
    const existing = await rpc<{ content_version: number }>('start_assessment', ['pre-test']);
    const oldQuestions = await assessmentQuestions('pre-test');
    await asUser(adminId);
    const item = (await rpc<ManagedAssessment[]>('get_admin_assessments')).find(
      (value) => value.assessment === 'pre-test',
    )!;
    item.draft.questions[0].prompt = 'New published wording';
    const saved = await rpc<ManagedAssessment>('save_admin_assessment', [
      'pre-test',
      item.draft,
      item.revision,
    ]);
    const published = await rpc<ManagedAssessment>('publish_admin_assessment', [
      'pre-test',
      saved.revision,
    ]);
    await asUser(studentId);
    expect(
      (await rpc<{ content_version: number }>('start_assessment', ['pre-test'])).content_version,
    ).toBe(existing.content_version);
    expect(await assessmentQuestions('pre-test')).toEqual(oldQuestions);
    await asUser(nextStudentId);
    const next = await rpc<{ content_version: number }>('start_assessment', ['pre-test']);
    expect(next.content_version).toBe(published.published_version);
    expect((await assessmentQuestions('pre-test'))[0].prompt).toBe('New published wording');
  });

  it.each([
    ['student', studentId, 'authenticated'],
    ['researcher', researcherId, 'authenticated'],
    ['anonymous', '', 'anon'],
  ])('%s cannot read or mutate assessment management data', async (_label, id, role) => {
    await asUser(id, role);
    await expectDatabaseFailure(
      () => rpc('get_admin_assessments'),
      role === 'anon' ? 'permission denied' : 'Admin access required',
    );
    await expectDatabaseFailure(
      () => pg.exec('select * from public.assessment_catalog'),
      'permission denied',
    );
  });

  it('never exposes the correct answer through the student question RPC', async () => {
    await asUser(nextStudentId);
    const questions = await assessmentQuestions('post-test');
    expect(JSON.stringify(questions)).not.toContain('correct_choice_id');
    expect(JSON.stringify(questions)).not.toContain('correctChoiceId');
  });
});
