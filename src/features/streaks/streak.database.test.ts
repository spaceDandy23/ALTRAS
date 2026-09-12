// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let pg: PGlite;
let studentId: string;
const lessonId = 'lesson-operation-signals';

async function identity(userId: string, role = 'authenticated') {
  await pg.exec(`reset role; set role ${role};`);
  await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

async function createUser() {
  const id = randomUUID();
  await pg.exec('reset role');
  await pg.query(
    `insert into auth.users (id, email, raw_user_meta_data)
    values ($1, 'fixture@example.invalid', $2)`,
    [
      id,
      JSON.stringify({
        username: `u_${id.replaceAll('-', '').slice(0, 20)}`,
        display_name: 'Test learner',
      }),
    ],
  );
  return id;
}

async function snapshot(attemptId: string | null = null) {
  const result = await pg.query<{
    streak: {
      user_id: string;
      current_streak: number;
      longest_streak: number;
      last_activity_date: string | null;
      earned_today: boolean;
      celebrate: boolean;
    };
  }>('select public.get_student_streak($1) as streak', [attemptId]);
  return result.rows[0].streak;
}

async function readyAttempt(wrong = false, targetLesson = lessonId) {
  const { rows } = await pg.query<{ id: string }>(
    'select id from public.start_lesson_attempt($1)',
    [targetLesson],
  );
  const id = rows[0].id;
  // Test-only owner access supplies fixtures; completion still uses the real authenticated RPC.
  await pg.exec('reset role');
  const keys = await pg.query<{
    activity_id: string;
    correct_answer: unknown;
    answer_options: unknown[];
  }>(
    'select activity_id, correct_answer, answer_options from public.lesson_activity_keys where lesson_id = $1',
    [targetLesson],
  );
  await identity(studentId);
  for (const key of keys.rows) {
    const answer = wrong
      ? typeof key.correct_answer === 'string'
        ? key.answer_options.find((option) => option !== key.correct_answer)
        : [...key.answer_options].reverse()
      : key.correct_answer;
    await pg.query('select public.submit_lesson_activity_answer($1, $2, $3)', [
      id,
      key.activity_id,
      JSON.stringify(answer),
    ]);
  }
  return id;
}

async function complete(wrong = false) {
  const id = await readyAttempt(wrong);
  await pg.query('select public.complete_lesson_attempt($1)', [id]);
  return id;
}

async function history(offsets: number[]) {
  await pg.exec('reset role');
  for (const offset of offsets) {
    const attemptId = randomUUID();
    await pg.query(
      `insert into public.lesson_attempts
      (id, user_id, lesson_id, content_version, status, completed_at, final_score, star_count, cleared)
      values ($1, $2, $3, 1, 'completed', now(), 100, 3, true)`,
      [attemptId, studentId, lessonId],
    );
    await pg.query(
      `insert into public.student_activity_days
      (user_id, activity_day, qualifying_attempt_id)
      values ($1, (statement_timestamp() at time zone 'Asia/Manila')::date + $2::integer, $3)`,
      [studentId, offset, attemptId],
    );
  }
  await identity(studentId);
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, encrypted_password text,
      raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const name of readdirSync(resolve('supabase/migrations'))
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    // PGlite has gen_random_uuid built in; pgcrypto is unavailable and unused by these tests.
    const sql = readFileSync(resolve('supabase/migrations', name), 'utf8').replace(
      'create extension if not exists pgcrypto;',
      '',
    );
    await pg.exec(sql);
  }
}, 30000);

beforeEach(async () => {
  await pg.exec('reset role; truncate auth.users cascade;');
  studentId = await createUser();
  await identity(studentId);
});
afterAll(async () => {
  await pg?.close();
});

describe('student streak PostgreSQL integration', () => {
  it('starts at zero and awards a first fully completed lesson, atomically with scoring', async () => {
    expect(await snapshot()).toMatchObject({
      current_streak: 0,
      longest_streak: 0,
      last_activity_date: null,
    });
    const id = await complete();
    expect(await snapshot(id)).toMatchObject({
      current_streak: 1,
      longest_streak: 1,
      earned_today: true,
      celebrate: true,
    });
    expect(await snapshot(id)).toMatchObject({ celebrate: false });
  });

  it('counts same-day replay only once and never re-awards duplicate completion calls', async () => {
    const id = await complete();
    await complete();
    await pg.query('select public.complete_lesson_attempt($1)', [id]);
    expect(await snapshot()).toMatchObject({ current_streak: 1, longest_streak: 1 });
    expect((await pg.query('select * from public.student_activity_days')).rows).toHaveLength(1);
  });

  it('increments yesterday’s streak and updates the longest run', async () => {
    await history([-2, -1]);
    expect(await snapshot()).toMatchObject({
      current_streak: 2,
      longest_streak: 2,
      earned_today: false,
    });
    await complete();
    expect(await snapshot()).toMatchObject({ current_streak: 3, longest_streak: 3 });
  });

  it('shows zero after a missed day and restarts at one without losing longest', async () => {
    await history([-5, -4, -3]);
    expect(await snapshot()).toMatchObject({ current_streak: 0, longest_streak: 3 });
    await complete();
    expect(await snapshot()).toMatchObject({ current_streak: 1, longest_streak: 3 });
  });

  it('rejects unfinished/abandoned attempts but includes fully answered low-scoring attempts', async () => {
    const { rows } = await pg.query<{ id: string }>(
      'select id from public.start_lesson_attempt($1)',
      [lessonId],
    );
    await expect(
      pg.query('select public.complete_lesson_attempt($1)', [rows[0].id]),
    ).rejects.toThrow('Complete every activity');
    expect(await snapshot()).toMatchObject({ current_streak: 0 });
    await pg.query('select public.abandon_lesson_attempt($1)', [rows[0].id]);
    expect(await snapshot()).toMatchObject({ current_streak: 0 });
    const id = await complete(true);
    const attempt = await pg.query<{ cleared: boolean }>(
      'select cleared from public.lesson_attempts where id = $1',
      [id],
    );
    expect(attempt.rows[0].cleared).toBe(false);
    expect(await snapshot()).toMatchObject({ current_streak: 1 });
  });

  it('rolls back streak activity when the enclosing completion transaction rolls back', async () => {
    const id = await readyAttempt();
    await pg.exec('begin');
    await pg.query('select public.complete_lesson_attempt($1)', [id]);
    expect(await snapshot()).toMatchObject({ current_streak: 1 });
    await pg.exec('rollback');
    expect(await snapshot()).toMatchObject({ current_streak: 0 });
  });

  it('deduplicates queued parallel completion requests and feedback claims', async () => {
    const id = await readyAttempt();
    await Promise.all(
      Array.from({ length: 8 }, () => pg.query('select public.complete_lesson_attempt($1)', [id])),
    );
    const results = await Promise.all(Array.from({ length: 8 }, () => snapshot(id)));
    expect(results.filter((result) => result.celebrate)).toHaveLength(1);
    expect((await pg.query('select * from public.student_activity_days')).rows).toHaveLength(1);
  });

  it('cannot award yesterday’s retried completion again today', async () => {
    const id = await complete();
    await pg.exec(
      'reset role; update public.student_activity_days set activity_day = activity_day - 1;',
    );
    await identity(studentId);
    await pg.query('select public.complete_lesson_attempt($1)', [id]);
    expect(await snapshot(id)).toMatchObject({
      current_streak: 1,
      earned_today: false,
      celebrate: false,
    });
  });

  it('records one day when two different qualifying completions race', async () => {
    await complete(); // unlock Lesson 2 through the real prerequisite flow
    const first = await readyAttempt();
    const second = await readyAttempt(false, 'lesson-order-matters');
    await pg.exec('reset role; delete from public.student_activity_days;');
    await identity(studentId);
    await Promise.all(
      [first, second].map((id) => pg.query('select public.complete_lesson_attempt($1)', [id])),
    );
    expect(await snapshot()).toMatchObject({ current_streak: 1, longest_streak: 1 });
    expect((await pg.query('select * from public.student_activity_days')).rows).toHaveLength(1);
  });

  it('reloads identical server state and keeps feedback claimed across sessions', async () => {
    const id = await complete();
    const first = await snapshot(id);
    await identity('', 'anon');
    await identity(studentId);
    expect(await snapshot(id)).toEqual({ ...first, celebrate: false });
  });

  it('denies direct writes, foreign reads, and using a foreign attempt to claim feedback', async () => {
    const id = await complete();
    await expect(pg.exec('delete from public.student_activity_days')).rejects.toThrow(
      'permission denied',
    );
    await expect(
      pg.exec('update public.student_activity_days set activity_day = current_date'),
    ).rejects.toThrow('permission denied');
    await expect(
      pg.query(
        `insert into public.student_activity_days values ($1, current_date, $2, now(), null)`,
        [studentId, randomUUID()],
      ),
    ).rejects.toThrow('permission denied');
    await expect(
      pg.query("update public.lesson_attempts set status = 'completed' where id = $1", [id]),
    ).rejects.toThrow('permission denied');
    const other = await createUser();
    await identity(other);
    expect((await pg.query('select * from public.student_activity_days')).rows).toHaveLength(0);
    expect(await snapshot(id)).toMatchObject({ current_streak: 0, celebrate: false });
    await identity(studentId);
    expect(await snapshot(id)).toMatchObject({ celebrate: true });
  });

  it('denies anonymous RPC/table access and researcher reads/mutations/completions', async () => {
    await complete();
    const id = await readyAttempt();
    await pg.exec('reset role');
    await pg.query('insert into public.researcher_users (user_id) values ($1)', [studentId]);
    await identity(studentId);
    expect((await pg.query('select * from public.student_activity_days')).rows).toHaveLength(0);
    await expect(snapshot()).rejects.toThrow('Student access required');
    await expect(pg.query('select public.complete_lesson_attempt($1)', [id])).rejects.toThrow(
      'Student access required',
    );
    await expect(pg.exec('delete from public.student_activity_days')).rejects.toThrow(
      'permission denied',
    );
    await identity('', 'anon');
    await expect(snapshot()).rejects.toThrow('permission denied');
    await expect(pg.exec('select * from public.student_activity_days')).rejects.toThrow(
      'permission denied',
    );
    await identity('');
    await expect(snapshot()).rejects.toThrow('Student access required');
  });

  it('does not award a streak for completed pre/post assessments or their retries', async () => {
    for (const kind of ['pre-test', 'post-test']) {
      const { rows } = await pg.query<{ id: string }>(
        'select id from public.start_assessment($1)',
        [kind],
      );
      const id = rows[0].id;
      await pg.exec('reset role');
      const keys = await pg.query<{ id: string; correct_choice_id: string }>(
        'select id, correct_choice_id from public.assessment_questions where assessment = $1',
        [kind],
      );
      await identity(studentId);
      await pg.query('select public.sync_assessment_draft($1, 0, 1, $2, $3)', [
        id,
        randomUUID(),
        JSON.stringify(
          keys.rows.map((q) => ({ question_id: q.id, selected_choice_id: q.correct_choice_id })),
        ),
      ]);
      await pg.query('select public.complete_assessment_revision($1, 1)', [id]);
      await pg.query('select public.complete_assessment_revision($1, 1)', [id]);
    }
    expect(await snapshot()).toMatchObject({ current_streak: 0 });
  });

  it('uses Philippine midnight regardless of session timezone, year/leap boundaries, or client dates', async () => {
    const migration = readFileSync(
      resolve('supabase/migrations/202609120001_student_streaks.sql'),
      'utf8',
    );
    const expression = migration.match(
      /\(statement_timestamp\(\) at time zone 'Asia\/Manila'\)::date/,
    )?.[0];
    expect(expression).toBeDefined();
    for (const zone of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      await pg.query("select set_config('TimeZone', $1, false)", [zone]);
      for (const [input, expected] of [
        ['2026-09-12T15:59:59Z', '2026-09-12'],
        ['2026-09-12T16:00:00Z', '2026-09-13'],
        ['2026-12-31T16:00:00Z', '2027-01-01'],
        ['2028-02-28T16:00:00Z', '2028-02-29'],
      ]) {
        const result = await pg.query<{ day: string }>(
          `select (${expression!.replace('statement_timestamp()', '$1::timestamptz')})::text as day`,
          [input],
        );
        expect(result.rows[0].day).toBe(expected);
      }
    }
    await pg.exec("set timezone = 'UTC'");
  });
});
