import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/202611110002_unpublish_visual_test_lessons.sql'),
  'utf8',
);

describe('visual-test lesson cleanup migration', () => {
  it('restores core lessons and unpublishes only the demo-only catalog entries', () => {
    expect(migration).toContain("'lesson-foundational-concepts'");
    expect(migration).toContain("'lesson-operation-signals'");
    expect(migration).toContain("'lesson-order-matters'");
    expect(migration).toContain("'lesson-writing-verbal-expressions'");
    expect(migration).toContain("'lesson-translating-mathematical-expressions'");
    expect(migration).toContain('definition.presentation::text not ilike');
    expect(migration).toContain('select max(definition.content_version)');
    expect(migration).toContain("draft::text ilike '%temporary%'");
    expect(migration).toContain('published = false');
    expect(migration).toContain('published_version = null');
  });

  it('preserves authored catalog drafts, definitions, and student history', () => {
    expect(migration).not.toMatch(/delete\s+from/i);
    expect(migration).not.toMatch(/drop\s+table/i);
    expect(migration).not.toContain('lesson_attempts');
    expect(migration).not.toContain('lesson_progress');
  });
});
