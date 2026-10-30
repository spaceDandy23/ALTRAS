// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let pg: PGlite;
const adminId = randomUUID();
const studentId = randomUUID();
const researcherId = randomUUID();
async function identity(id: string, role = 'authenticated') {
  await pg.exec(`reset role; set role ${role};`);
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function rpc<T>(name: string, args: unknown[] = []): Promise<T> {
  return (
    await pg.query<{ result: T }>(
      `select to_jsonb(public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')})) result`,
      args,
    )
  ).rows[0].result;
}
async function addUser(id: string, email: string, metadata: Record<string, string> = {}) {
  await pg.exec('reset role');
  await pg.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [
    id,
    email,
    metadata,
  ]);
}

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key,email text,encrypted_password text,raw_user_meta_data jsonb default '{}',
      created_at timestamptz not null default now(),last_sign_in_at timestamptz,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
    grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;`);
  for (const file of readdirSync(resolve('supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await pg.exec(
      readFileSync(resolve('supabase/migrations', file), 'utf8').replace(
        'create extension if not exists pgcrypto;',
        '',
      ),
    );
  }
  await addUser(adminId, 'author@example.test', {
    username: 'author',
    display_name: 'Admin Author',
  });
  await addUser(studentId, 'learner@example.test', {
    username: 'learner',
    display_name: 'Student Learner',
  });
  await addUser(researcherId, 'observer@example.test', {
    username: 'observer',
    display_name: 'Research Observer',
  });
  await pg.exec('reset role');
  await pg.query('insert into public.admin_users(user_id) values($1)', [adminId]);
  await pg.query('insert into public.researcher_users(user_id) values($1)', [researcherId]);
}, 30000);
beforeEach(async () => {
  await pg.exec('reset role; begin');
  await identity(adminId);
});
afterEach(async () => {
  await pg.exec('rollback');
});
afterAll(async () => pg?.close());

describe('Admin User Management SQL authorization', () => {
  it('lists only controlled safe account fields for an admin', async () => {
    const result = await rpc<{ users: Record<string, unknown>[]; total: number }>(
      'admin_list_users',
      [null, 1, 20],
    );
    expect(result.total).toBe(3);
    expect(result.users.find((user) => user.id === studentId)).toMatchObject({
      username: 'learner',
      displayName: 'Student Learner',
      email: 'learner@example.test',
      banned: false,
      researcher: false,
      admin: false,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /password|token|raw_user_meta_data|encrypted_password|app_metadata/i,
    );
  });

  it.each(['student', 'researcher', 'anonymous'])('%s cannot list users', async (kind) => {
    await identity(
      kind === 'student' ? studentId : kind === 'researcher' ? researcherId : '',
      kind === 'anonymous' ? 'anon' : 'authenticated',
    );
    await expect(rpc('admin_list_users', [null, 1, 20])).rejects.toThrow(
      kind === 'anonymous' ? 'permission denied' : 'Admin access required',
    );
  });

  it('searches username, display name and email case-insensitively', async () => {
    for (const search of ['LEARNER', 'student learn', '@example.test']) {
      const result = await rpc<{ users: { id: string }[]; total: number }>('admin_list_users', [
        search,
        1,
        20,
      ]);
      if (search !== '@example.test')
        expect(result.users.map((user) => user.id)).toEqual([studentId]);
      else expect(result.total).toBe(3);
    }
  });

  it('paginates server-side with bounded page sizes', async () => {
    const first = await rpc<{ users: unknown[]; page: number; pageSize: number; total: number }>(
      'admin_list_users',
      [null, 1, 2],
    );
    const second = await rpc<{ users: unknown[] }>('admin_list_users', [null, 2, 2]);
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(first.users).toHaveLength(2);
    expect(second.users).toHaveLength(1);
    await expect(rpc('admin_list_users', [null, 1, 101])).rejects.toThrow('Page size');
  });

  it('preserves trigger-based profile and settings creation for manual provisioning metadata fallback', async () => {
    const provisionedId = randomUUID();
    await addUser(provisionedId, 'manual-person@example.test');
    const profile = (
      await pg.query<{ username: string; display_name: string }>(
        'select username,display_name from public.profiles where user_id=$1',
        [provisionedId],
      )
    ).rows[0];
    expect(profile).toMatchObject({ username: 'manual-person', display_name: 'manual-person' });
    expect(
      (await pg.query('select * from public.user_settings where user_id=$1', [provisionedId])).rows,
    ).toHaveLength(1);
    expect(
      (await pg.query('select * from public.researcher_users where user_id=$1', [provisionedId]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await pg.query('select * from public.admin_users where user_id=$1', [provisionedId])).rows,
    ).toHaveLength(0);
  });

  it('grants and revokes researcher access idempotently without deleting account data', async () => {
    await rpc('admin_set_researcher_access', [studentId, true]);
    await rpc('admin_set_researcher_access', [studentId, true]);
    await pg.exec('reset role');
    expect(
      (await pg.query('select * from public.researcher_users where user_id=$1', [studentId])).rows,
    ).toHaveLength(1);
    await rpc('admin_set_researcher_access', [studentId, false]);
    await rpc('admin_set_researcher_access', [studentId, false]);
    await pg.exec('reset role');
    expect(
      (await pg.query('select * from public.researcher_users where user_id=$1', [studentId])).rows,
    ).toHaveLength(0);
    expect(
      (await pg.query('select * from public.profiles where user_id=$1', [studentId])).rows,
    ).toHaveLength(1);
  });

  it('grants admin access idempotently and permits revocation when another active admin exists', async () => {
    await rpc('admin_set_admin_access', [studentId, true]);
    await rpc('admin_set_admin_access', [studentId, true]);
    await pg.exec('reset role');
    expect(
      (await pg.query('select * from public.admin_users where user_id=$1', [studentId])).rows,
    ).toHaveLength(1);
    await rpc('admin_set_admin_access', [adminId, false]);
    await pg.exec('reset role');
    expect(
      (await pg.query('select * from public.admin_users where user_id=$1', [adminId])).rows,
    ).toHaveLength(0);
  });

  it('does not remove the final active admin', async () => {
    await expect(rpc('admin_set_admin_access', [adminId, false])).rejects.toThrow(
      'final active admin',
    );
  });

  it('prevents banning self or an admin until admin access is revoked', async () => {
    await expect(rpc('admin_assert_user_can_be_banned', [adminId])).rejects.toThrow('own account');
  });

  it('prevents banning another admin until access is revoked', async () => {
    await rpc('admin_set_admin_access', [studentId, true]);
    await expect(rpc('admin_assert_user_can_be_banned', [studentId])).rejects.toThrow(
      'Revoke admin access',
    );
  });

  it('allows a non-admin target to pass the Auth-ban preflight without changing data itself', async () => {
    await expect(rpc('admin_assert_user_can_be_banned', [studentId])).resolves.toBe(true);
    await pg.exec('reset role');
    expect(
      (
        await pg.query<{ banned_until: string | null }>(
          'select banned_until from auth.users where id=$1',
          [studentId],
        )
      ).rows[0].banned_until,
    ).toBeNull();
  });

  it.each([
    ['student', 'admin_set_researcher_access', [studentId, true]],
    ['student', 'admin_set_admin_access', [studentId, true]],
    ['student', 'admin_assert_user_can_be_banned', [studentId]],
    ['researcher', 'admin_set_researcher_access', [studentId, true]],
    ['researcher', 'admin_set_admin_access', [studentId, true]],
    ['researcher', 'admin_assert_user_can_be_banned', [studentId]],
    ['anonymous', 'admin_set_researcher_access', [studentId, true]],
    ['anonymous', 'admin_set_admin_access', [studentId, true]],
    ['anonymous', 'admin_assert_user_can_be_banned', [studentId]],
  ] as const)('blocks %s from %s', async (kind, operation, args) => {
    await identity(
      kind === 'student' ? studentId : kind === 'researcher' ? researcherId : '',
      kind === 'anonymous' ? 'anon' : 'authenticated',
    );
    await expect(rpc(operation, [...args])).rejects.toThrow(
      kind === 'anonymous' ? 'permission denied' : 'Admin access required',
    );
  });

  it('keeps lesson management under the same server-authoritative active-admin rule', async () => {
    expect((await pg.query('select * from public.get_admin_lessons()')).rows).toHaveLength(2);
    await pg.exec('reset role');
    await pg.query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [
      adminId,
    ]);
    await identity(adminId);
    expect(await rpc('is_admin')).toBe(false);
    await expect(rpc('get_admin_lessons')).rejects.toThrow('Admin access required');
  });
});
