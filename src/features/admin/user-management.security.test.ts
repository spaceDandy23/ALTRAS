// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/202609120003_admin_user_management.sql'),
  'utf8',
);
const edgeFunction = readFileSync(resolve('supabase/functions/admin-users/index.ts'), 'utf8');

describe('Admin User Management security boundaries', () => {
  it('keeps Auth Admin credentials and methods outside the browser bundle', () => {
    const browserSource = readFileSync(
      resolve('src/features/admin/user-management.service.ts'),
      'utf8',
    );
    expect(browserSource).not.toMatch(
      /SERVICE_ROLE|SECRET_KEY|auth\.admin|createUser|updateUserById/,
    );
    expect(edgeFunction).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
    expect(edgeFunction).toContain('adminClient.auth.admin.createUser');
    expect(edgeFunction).toContain('adminClient.auth.admin.updateUserById');
    expect(edgeFunction).not.toContain('deleteUser');
  });
  it('uses supported Auth banning and unbanning without password or token output', () => {
    expect(edgeFunction).toContain("ban_duration: body.banned ? '876000h' : 'none'");
    expect(edgeFunction).not.toMatch(/password_hash|encrypted_password|refresh_token|access_token/);
    expect(edgeFunction.indexOf("userClient.rpc('is_admin')")).toBeLessThan(
      edgeFunction.indexOf('adminClient.auth.admin.createUser'),
    );
    expect(edgeFunction.indexOf("userClient.rpc('is_admin')")).toBeLessThan(
      edgeFunction.indexOf('adminClient.auth.admin.updateUserById'),
    );
    expect(edgeFunction.indexOf('userClient.auth.getUser(token)')).toBeLessThan(
      edgeFunction.indexOf("userClient.rpc('is_admin')"),
    );
  });
  it('restricts browser calls to explicitly configured origins', () => {
    expect(edgeFunction).toContain("Deno.env.get('ALTRAS_ALLOWED_ORIGINS')");
    expect(edgeFunction).toContain('allowedOrigins.has(origin)');
    expect(edgeFunction).not.toContain("'Access-Control-Allow-Origin': '*'");
  });
  it('keeps the list controlled and grants mutations only to authenticated callers', () => {
    expect(migration).toContain('create function public.admin_list_users');
    expect(migration).not.toMatch(/'password'|'token'|'raw_user_meta_data'|'app_metadata'/);
    expect(migration).toContain('revoke all on function public.admin_list_users');
    expect(migration).toContain('from public, anon;');
    expect(migration).toContain('to authenticated;');
    expect(migration).not.toMatch(/profiles\.role|app_role/);
  });
});
