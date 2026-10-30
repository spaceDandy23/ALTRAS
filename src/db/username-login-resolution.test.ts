import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/202609080004_resolve_username_login_identity.sql'),
  'utf8',
);

describe('username login identity resolution migration', () => {
  it('uses a narrowly scoped secure resolver with explicit grants only', () => {
    expect(migration).toContain('create or replace function public.resolve_login_email');
    expect(migration).toContain('returns text');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      'revoke all on function public.resolve_login_email(text, text) from public;',
    );
    expect(migration).toContain(
      'grant execute on function public.resolve_login_email(text, text) to anon, authenticated;',
    );
  });

  it('returns an Auth email only after valid username and password verification', () => {
    expect(migration).toContain("normalized_username !~ '^[a-z0-9_-]{3,24}$'");
    expect(migration).toContain('join auth.users auth_user on auth_user.id = profile.user_id');
    expect(migration).toContain('auth_user.encrypted_password');
    expect(migration).toContain("execute 'select extensions.crypt($1, $2)'");
    expect(migration).toContain('if verified_hash is distinct from password_hash then');
    expect(migration).toContain('return resolved_email;');
  });

  it('does not expose profile records, arbitrary Auth data, or a username-existence result', () => {
    expect(migration).toContain('if resolved_email is null or password_hash is null then\n    return null;');
    expect(migration).toContain('if verified_hash is distinct from password_hash then\n    return null;');
    expect(migration).not.toContain('returns table');
    expect(migration).not.toContain('select profile.*');
    expect(migration).not.toContain('select auth_user.*');
  });
});
