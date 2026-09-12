import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/202609080003_support_manual_auth_user_provisioning.sql'),
  'utf8',
);

describe('manual Auth user provisioning migration', () => {
  it('preserves strict explicit ALTRAS metadata validation and profile/settings creation', () => {
    expect(migration).toContain("coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'username'");
    expect(migration).toContain("'^[a-z0-9_-]{3,24}$'");
    expect(migration).toContain("coalesce(new.raw_user_meta_data, '{}'::jsonb) ? 'display_name'");
    expect(migration).toContain('char_length(requested_display_name) not between 2 and 40');
    expect(migration).toContain('resolved_username := requested_username');
    expect(migration).toContain('resolved_display_name := coalesce(requested_display_name');
    expect(migration).toContain('values (\n      new.id,\n      resolved_username,');
    expect(migration).toContain('insert into public.user_settings (user_id)');
  });

  it('derives safe fallback values when dashboard-created users omit metadata', () => {
    expect(migration).toContain("lower(split_part(coalesce(new.email, ''), '@', 1))");
    expect(migration).toContain("'[^a-z0-9_-]+'");
    expect(migration).toContain("fallback_username_base := 'user'");
    expect(migration).toContain("fallback_display_name := 'Manual user'");
    expect(migration).toContain("split_part(coalesce(new.email, ''), '@', 1)");
    expect(migration).toContain('update auth.users');
    expect(migration).toContain("'username', resolved_username");
    expect(migration).toContain("'display_name', resolved_display_name");
  });

  it('handles fallback username collisions without overwriting profiles', () => {
    expect(migration).toContain('for attempt in 0..9999 loop');
    expect(migration).toContain("replace(new.id::text, '-', '')");
    expect(migration).toContain('when unique_violation then');
    expect(migration).toContain("raise exception 'Unable to generate a unique username.'");
    expect(migration).not.toContain('on conflict');
  });

  it('keeps the existing trigger contract and separate researcher authorization', () => {
    expect(migration).toContain('create or replace function public.handle_new_user()');
    expect(migration).toContain('returns trigger');
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).not.toMatch(/profiles\.role|app_role|researcher_users|'student'/);
    expect(migration).not.toContain('drop trigger');
    expect(migration).not.toContain('create trigger');
  });
});
