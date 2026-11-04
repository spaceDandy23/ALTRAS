import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve('supabase/migrations/202611040001_lesson_scoped_assessments.sql'), 'utf8');

describe('lesson-scoped assessment migration', () => {
  it('creates lesson-only assessment storage and removes the old global bank', () => {
    expect(migration).toContain('alter table public.assessment_questions add column lesson_id text');
    expect(migration).toContain('delete from public.assessment_questions where lesson_id is null;');
    expect(migration).toContain("jsonb_build_object('pre-test', '[]'::jsonb, 'post-test', '[]'::jsonb)");
    expect(migration).toContain('alter table public.assessment_questions alter column lesson_id set not null');
    expect(migration).toContain('alter table public.assessment_attempts alter column lesson_attempt_id set not null');
    expect(migration).toContain('drop table public.assessment_catalog');
    expect(migration).not.toContain('lesson_assessments_scoped');
    expect(migration).not.toMatch(/create(?: or replace)? function public\.start_global_assessment/i);
    expect(migration).not.toMatch(/delete from public\.lesson_(?:attempts|progress)/i);
    expect(migration).not.toMatch(/delete from public\.assessment_attempts/i);
    expect(migration).not.toMatch(/delete from public\.assessment_attempt_answers/i);
  });

  it('does not import global questions or remap old answer history', () => {
    expect(migration).not.toMatch(/from public\.assessment_catalog source/i);
    const legacyImport = migration.slice(0, migration.indexOf('alter table public.assessment_questions alter column lesson_id set not null'));
    expect(legacyImport).not.toMatch(/insert into public\.assessment_questions[\s\S]*?from public\.lesson_definitions/i);
    expect(migration).not.toMatch(/update public\.assessment_attempt_answers[\s\S]*?set question_id/i);
    expect(migration).not.toMatch(/update public\.lesson_catalog[\s\S]*?from public\.assessment_catalog/i);
  });

  it('keeps lesson answer keys private and validates writes against lesson scope', () => {
    expect(migration).toContain('public.validate_publishable_assessment');
    expect(migration).toContain('correct_choice_id');
    expect(migration).toMatch(/public\.submit_assessment_answer[\s\S]*?lesson_id = question_lesson_id/);
    expect(migration).toMatch(/public\.sync_assessment_draft[\s\S]*?q\.lesson_id = question_lesson_id/);
    expect(migration).toMatch(/update public\.lesson_definitions[\s\S]*?jsonb_build_object\('assessments', versions\)/);
  });

  it('provides per-lesson researcher comparisons without standalone scores', () => {
    expect(migration).toContain('public.get_researcher_lesson_assessment_results()');
    expect(migration).toMatch(/create function public\.get_researcher_results\(\)[\s\S]*?lessons_completed integer/);
    const participantRpc = migration.match(/create function public\.get_researcher_results\(\)[\s\S]*?\$\$;/)?.[0] ?? '';
    expect(participantRpc).not.toContain('pre_test_score');
    expect(migration).toContain('attempts.lesson_attempt_id is not null');
    expect(migration).toContain('group by attempts.user_id,attempts.lesson_id');
  });
});
