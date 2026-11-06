import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve('supabase/migrations/202609060001_assessment_revision_sync.sql'),
  'utf8',
);
const sync = sql.slice(
  sql.indexOf('create function public.sync_assessment_draft'),
  sql.indexOf('create function public.complete_assessment_revision'),
);
const complete = sql.slice(
  sql.indexOf('create function public.complete_assessment_revision'),
  sql.indexOf('-- Resume pinned content'),
);
const read = sql.slice(
  sql.indexOf('create function public.get_assessment_attempt'),
  sql.indexOf('create function public.sync_assessment_draft'),
);

describe('assessment revision migration contract (static checks)', () => {
  it('locks before testing status/revisions and accepts only an exact base plus a strictly newer revision', () => {
    expect(sync.indexOf('for update;')).toBeLessThan(
      sync.indexOf("current_attempt.status <> 'active'"),
    );
    expect(sync).toContain(
      'current_attempt.accepted_revision <> p_base_revision or p_revision <= current_attempt.accepted_revision',
    );
    expect(sync).toContain("using errcode = '40001'");
    expect(sync).toContain('accepted_revision = p_revision, accepted_mutation_id = p_mutation_id');
    expect(sync).not.toMatch(/answered_at\s*>/);
  });
  it('makes retries idempotent only for the same token, revision and snapshot', () => {
    expect(sync).toContain(
      'current_attempt.accepted_revision = p_revision and current_attempt.accepted_mutation_id = p_mutation_id and incoming = existing',
    );
    expect(sync).toContain('count(distinct');
    expect(sync).toContain('Snapshot omits accepted answers.');
    expect(sync).toContain(
      'on conflict on constraint assessment_attempt_answers_attempt_id_question_id_key',
    );
  });
  it('keeps ownership, student-only permission checks and server-side scoring under the attempt lock', () => {
    for (const fn of [sync, complete]) {
      expect(fn).toContain("security definer set search_path = ''");
      expect(fn).toContain('(select auth.uid()) is null or public.is_researcher()');
      expect(fn).toContain('user_id = (select auth.uid()) for update;');
    }
    expect(complete).toContain('current_attempt.accepted_revision <> p_revision');
    expect(complete).toContain('perform public.complete_assessment(p_attempt_id)');
    expect(complete).toContain('submitted_revision = p_revision');
  });
  it('exposes no answer keys/correctness and revokes all legacy revision bypasses', () => {
    expect(read).not.toContain('is_correct');
    expect(read).not.toContain('correct_choice_id');
    for (const fn of ['submit_assessment_answer(uuid, text, text)', 'complete_assessment(uuid)']) {
      expect(sql).toContain(
        `revoke execute on function public.${fn} from public, anon, authenticated;`,
      );
    }
    expect(sql).toContain(
      'revoke execute on function public.sync_assessment_draft(uuid, bigint, bigint, uuid, jsonb) from public, anon;',
    );
    expect(sql).toContain(
      'grant execute on function public.sync_assessment_draft(uuid, bigint, bigint, uuid, jsonb) to authenticated;',
    );
  });
});
