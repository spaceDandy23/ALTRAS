import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/202611110001_secure_username_login_and_active_time.sql'),
  'utf8',
);
const edgeFunction = readFileSync(resolve('supabase/functions/username-login/index.ts'), 'utf8');

describe('rate-limited username login resolution', () => {
  it('removes the browser-callable password resolver', () => {
    expect(migration).toContain('drop function if exists public.resolve_login_email(text, text)');
    expect(migration).not.toContain('grant execute on function public.resolve_login_email');
  });

  it('keeps identity resolution and rate-limit state service-role only', () => {
    expect(migration).toContain('public.resolve_login_identity_for_edge');
    expect(migration).toContain('public.consume_username_login_rate_limit');
    expect(migration).toContain(
      'grant execute on function public.resolve_login_identity_for_edge(text) to service_role',
    );
    expect(migration).toContain(
      'grant execute on function public.consume_username_login_rate_limit(text, integer, integer) to service_role',
    );
    expect(migration).not.toContain('resolve_login_identity_for_edge(text) to anon');
  });

  it('rate limits before using the normal Supabase Auth sign-in endpoint', () => {
    expect(edgeFunction).toContain("rpc('consume_username_login_rate_limit'");
    expect(edgeFunction).toContain('auth.signInWithPassword');
    expect(edgeFunction.indexOf("rpc('consume_username_login_rate_limit'")).toBeLessThan(
      edgeFunction.indexOf('auth.signInWithPassword'),
    );
    expect(edgeFunction).not.toContain('encrypted_password');
  });
});
