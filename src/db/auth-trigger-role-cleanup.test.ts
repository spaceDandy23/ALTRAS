import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/202609080002_repair_handle_new_user_after_role_cleanup.sql'),
  'utf8',
);

describe('auth trigger role-cleanup repair migration', () => {
  it('replaces the auth-user profile trigger with the existing secure trigger contract', () => {
    expect(migration).toContain('create or replace function public.handle_new_user()');
    expect(migration).toContain('returns trigger');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).not.toContain('drop trigger');
    expect(migration).not.toContain('create trigger');
  });

  it('creates the required profile and settings rows without assigning a role', () => {
    expect(migration).toContain('insert into public.profiles (user_id, username, display_name)');
    expect(migration).toContain('values (new.id, requested_username, requested_display_name)');
    expect(migration).toContain('insert into public.user_settings (user_id)');
    expect(migration).not.toMatch(/profiles\.role|app_role|researcher_users|'student'/);
  });

  it('preserves the metadata validation used by normal and manually created auth users', () => {
    expect(migration).toContain("new.raw_user_meta_data ->> 'username'");
    expect(migration).toContain("new.raw_user_meta_data ->> 'display_name'");
    expect(migration).toContain("'^[a-z0-9_-]{3,24}$'");
    expect(migration).toContain('char_length(requested_display_name) not between 2 and 40');
  });
});
