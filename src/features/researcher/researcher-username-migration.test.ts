import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/202609160002_exclude_staff_from_research_results.sql'),
  'utf8',
);

describe('researcher username projection migration', () => {
  it('keeps the RPC researcher-only and exposes only the approved profile field', () => {
    const contract = migration.match(/returns table \(([\s\S]*?)\)\s*language plpgsql/)?.[1];
    expect(contract).toContain('participant_code text');
    expect(contract).toContain('username text');
    expect(contract).not.toMatch(/\b(email|display_name|user_id|raw_user_meta_data)\b/);
    expect(migration).toContain('if not public.is_researcher() then');
    expect(migration).toContain(
      'revoke execute on function public.get_researcher_results() from public, anon;',
    );
    expect(migration).toContain(
      'grant execute on function public.get_researcher_results() to authenticated;',
    );
  });

  it('limits lesson analytics to the currently published catalog without deleting history', () => {
    expect(migration).toContain('where catalog.published');
    expect(migration).toContain(
      'join active_lessons active on active.lesson_id = progress.lesson_id',
    );
    expect(migration).not.toMatch(/delete\s+from\s+public\.(lesson_progress|lesson_attempts)/i);
  });

  it('excludes both researcher and administrator accounts at the RPC boundary', () => {
    expect(migration).toContain('from public.researcher_users researchers');
    expect(migration).toContain('from public.admin_users administrators');
    expect(migration).toMatch(/where not exists[\s\S]*and not exists/);
  });
});
