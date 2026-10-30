import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packagedContent } from '@/features/lessons/content/packaged-content';

const migration = readFileSync(
  resolve('supabase/migrations/202609050001_research_data_integrity.sql'),
  'utf8',
);
const assessmentConflictFix = readFileSync(
  resolve('supabase/migrations/202609050002_assessment_answer_conflict_fix.sql'),
  'utf8',
);
const lessonAttemptService = readFileSync(
  resolve('src/features/lessons/attempts/online-attempt.service.ts'),
  'utf8',
);
const progressService = readFileSync(
  resolve('src/features/lessons/progress/online-progress.service.ts'),
  'utf8',
);
const assessmentService = readFileSync(
  resolve('src/features/assessments/assessment.service.ts'),
  'utf8',
);

function between(start: string, end: string) {
  const from = migration.indexOf(start);
  const to = migration.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing migration boundary: ${start}`);
  return migration.slice(from, to);
}

describe('research data integrity migration', () => {
  it('contains an authority definition and answer key for every playable packaged activity', () => {
    for (const lesson of packagedContent.lessons.filter(
      (candidate) => candidate.contentStatus === 'playable',
    )) {
      expect(migration).toContain(
        `'${lesson.id}', ${lesson.contentVersion}, ${lesson.activities.length}, ${lesson.passingThreshold}`,
      );
      for (const activity of lesson.activities) {
        expect(migration).toContain(`'${activity.id}', '${activity.type}'`);
        const correctAnswer =
          activity.type === 'find-word'
            ? activity.correctChoiceId
            : activity.correctTokenSequence;
        expect(migration).toContain(`'${JSON.stringify(correctAnswer)}'`);
      }
    }
  });

  it('removes the direct assessment correctness read and provides a safe resume projection', () => {
    expect(migration).toContain(
      'revoke select, insert, update, delete on public.assessment_attempt_answers from authenticated;',
    );
    expect(migration).toContain(
      'drop policy if exists "Students read their own assessment answers"',
    );

    const safeRead = between(
      'create or replace function public.get_assessment_attempt',
      'drop function if exists public.submit_assessment_answer',
    );
    expect(safeRead).toContain("'selected_choice_id', answer.selected_choice_id");
    expect(safeRead).not.toContain('is_correct');
    expect(safeRead).not.toContain('correct_choice_id');
  });

  it('returns no correctness field from answer mutation and serializes it with completion', () => {
    const mutation = between(
      'create function public.submit_assessment_answer',
      '-- Remove all student-direct outcome mutation paths',
    );
    const returnContract = mutation.match(/returns table \(([\s\S]*?)\)\s*language plpgsql/)?.[1];
    expect(returnContract).toContain('selected_choice_id text');
    expect(returnContract).not.toContain('is_correct');
    expect(mutation).toMatch(/from public\.assessment_attempts[\s\S]*for update;/);

    const historicalCompletion = readFileSync(
      resolve('supabase/migrations/202608300003_assessment_flow.sql'),
      'utf8',
    );
    expect(historicalCompletion).toMatch(
      /function public\.complete_assessment[\s\S]*from public\.assessment_attempts[\s\S]*for update;/,
    );
    expect(assessmentConflictFix).toContain(
      'on conflict on constraint assessment_attempt_answers_attempt_id_question_id_key',
    );
    expect(assessmentConflictFix).toMatch(
      /from public\.assessment_attempts[\s\S]*for update;/,
    );
    expect(assessmentConflictFix).toContain("security definer\nset search_path = ''");
  });

  it('makes lesson keys private and accepts only raw lesson answers through a validated RPC', () => {
    expect(migration).toContain(
      'revoke all on public.lesson_definitions, public.lesson_activity_keys from public, authenticated;',
    );
    const answerRpc = between(
      'create or replace function public.submit_lesson_activity_answer',
      'drop function if exists public.complete_lesson_attempt',
    );
    expect(answerRpc).toContain('p_submitted_answer jsonb');
    expect(answerRpc).not.toContain('p_is_correct');
    expect(answerRpc).toContain('p_submitted_answer = activity.correct_answer');
    expect(answerRpc).toContain("raise exception 'Invalid activity answer.'");
    expect(answerRpc).toMatch(/from public\.lesson_attempts[\s\S]*for update;/);
  });

  it('derives lesson scoring and unlock targets without client-supplied outcome fields', () => {
    const completion = between(
      'create or replace function public.complete_lesson_attempt',
      '-- Students resume through this safe projection',
    );
    expect(completion).toContain('join public.lesson_activity_keys activity');
    expect(completion).toContain('definition.passing_threshold');
    expect(completion).toContain('candidate.prerequisite_lesson_id = current_attempt.lesson_id');
    expect(completion).not.toContain('p_follow_up_lesson_ids');
    expect(migration).toContain(
      'revoke insert, update, delete on public.lesson_progress from authenticated;',
    );
    expect(migration).toContain(
      'revoke insert, update, delete on public.lesson_attempts from authenticated;',
    );
    expect(migration).toContain(
      'revoke insert, update, delete on public.attempt_answers from authenticated;',
    );
    expect(lessonAttemptService).toContain(".rpc('start_lesson_attempt'");
    expect(lessonAttemptService).toContain(".rpc('submit_lesson_activity_answer'");
    expect(lessonAttemptService).not.toContain(".from('attempt_answers')\n    .insert");
    expect(lessonAttemptService).not.toContain('p_follow_up_lesson_ids');
  });

  it('initializes missing progress without replacing earned values', () => {
    const initialization = between(
      'create or replace function public.initialize_lesson_progress',
      'create or replace function public.start_lesson_attempt',
    );
    expect(initialization).toContain('on conflict (user_id, lesson_id) do nothing');
    expect(initialization).toContain("and progress.status = 'locked'");
    expect(initialization).not.toMatch(/best_score\s*=/);
    expect(initialization).not.toMatch(/best_star_count\s*=/);
    expect(initialization).not.toMatch(/attempt_count\s*=/);
    expect(initialization).not.toMatch(/xp_awarded\s*=/);
    expect(progressService).toContain(".rpc('initialize_lesson_progress')");
    expect(progressService).not.toContain('.upsert(');
  });

  it('restores assessment answers only through the safe projection RPC', () => {
    expect(assessmentService).toContain(".rpc('get_assessment_attempt'");
    expect(assessmentService).not.toContain(".from('assessment_attempts')");
  });

  it('uses hardened definer functions and explicit least-privilege execution grants', () => {
    for (const functionName of [
      'initialize_lesson_progress()',
      'start_lesson_attempt(text)',
      'submit_lesson_activity_answer(uuid, text, jsonb)',
      'complete_lesson_attempt(uuid)',
      'get_assessment_attempt(public.assessment_kind)',
      'submit_assessment_answer(uuid, text, text)',
    ]) {
      expect(migration).toContain(`revoke execute on function public.${functionName} from public;`);
      expect(migration).toContain(`grant execute on function public.${functionName} to authenticated;`);
    }
    expect(migration.match(/security definer\s+set search_path = ''/g)).toHaveLength(6);
  });
});
