import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/202608310002_researcher_student_separation.sql'),
  'utf8',
);

describe('researcher database security migration', () => {
  it('checks the current caller inside the results RPC', () => {
    expect(migration).toContain('if not public.is_researcher() then');
    expect(migration).toContain("using errcode = '42501'");
  });

  it('returns an anonymous contract without personal or authentication fields', () => {
    const returnContract = migration.match(/returns table \(([\s\S]*?)\)\s*language plpgsql/)?.[1];

    expect(returnContract).toBeDefined();
    expect(returnContract).toContain('participant_code text');
    expect(returnContract).not.toMatch(
      /\b(user_id|email|display_name|username|age|school|section)\b/,
    );
    expect(migration).toContain("'ALT-' || upper(substr(md5(profile.user_id::text), 1, 8))");
  });

  it('rejects researcher writes across lesson and assessment records', () => {
    expect(migration).toContain('reject_researcher_learning_write');
    for (const table of [
      'lesson_progress',
      'lesson_attempts',
      'attempt_answers',
      'assessment_attempts',
      'assessment_attempt_answers',
    ]) {
      expect(migration).toContain(`before insert or update on public.${table}`);
    }
  });
});
