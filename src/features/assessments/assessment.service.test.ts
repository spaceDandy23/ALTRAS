import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';
import {
  completeAssessment,
  getAssessmentAttempt,
  startAssessment,
  syncAssessmentDraft,
  toAssessmentAttempt,
} from './assessment.service';
import { createAssessmentDraft, updateDraftAnswer } from './assessment-draft.service';

const remote = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => remote }));

describe('online assessment attempt mapping', () => {
  afterEach(() => {
    useResearcherAccessStore.getState().clear();
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  it('maps a submitted result and its saved answers', () => {
    const attempt = toAssessmentAttempt({
      id: '3dd244a8-011c-4684-b759-e43ff1daec24',
      user_id: '6ec599dd-3494-4e5d-b917-342905bcb1fa',
      assessment: 'pre-test',
      status: 'submitted',
      started_at: '2026-08-30T12:00:00.000Z',
      submitted_at: '2026-08-30T12:03:00.000Z',
      score: 67,
      completion_seconds: 180,
      content_version: 1,
      expected_question_count: 3,
      accepted_revision: 3,
      accepted_mutation_id: '7ec599dd-3494-4e5d-b917-342905bcb1fa',
      submitted_revision: 3,
      assessment_attempt_answers: [
        {
          question_id: 'pre-placeholder-1',
          selected_choice_id: 'a',
          answered_at: '2026-08-30T12:01:00.000Z',
        },
      ],
    });

    expect(attempt).toMatchObject({
      assessment: 'pre-test',
      status: 'submitted',
      score: 67,
      completionSeconds: 180,
      expectedQuestionCount: 3,
    });
    expect(attempt.answers[0]).toMatchObject({
      questionId: 'pre-placeholder-1',
      selectedChoiceId: 'a',
    });
  });

  it('blocks researchers before creating assessment attempts', async () => {
    useResearcherAccessStore.setState({ status: 'authorized', userId: crypto.randomUUID() });

    await expect(startAssessment(crypto.randomUUID(), 'pre-test')).rejects.toThrow(
      'Researcher accounts cannot create participant learning records.',
    );
  });

  const record = {
    id: '3dd244a8-011c-4684-b759-e43ff1daec24',
    user_id: '6ec599dd-3494-4e5d-b917-342905bcb1fa',
    assessment: 'pre-test',
    status: 'active',
    started_at: '2026-08-30T12:00:00.000Z',
    submitted_at: null,
    score: null,
    completion_seconds: null,
    content_version: 1,
    expected_question_count: 1,
    accepted_revision: 0,
    accepted_mutation_id: null,
    submitted_revision: null,
    assessment_attempt_answers: [],
  };
  it('sends only choices and logical revisions, and requires authoritative acknowledgement', async () => {
    const draft = updateDraftAnswer(
      createAssessmentDraft(toAssessmentAttempt(record), [
        {
          id: 'q',
          assessment: 'pre-test',
          displayOrder: 1,
          prompt: 'Prompt',
          choices: [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
          contentVersion: 1,
          isPlaceholder: false,
        },
      ]),
      'q',
      'b',
    );
    remote.rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        data: [{ ...record, accepted_revision: 1, accepted_mutation_id: draft.mutationId }],
        error: null,
      });
    await expect(syncAssessmentDraft(draft)).resolves.toMatchObject({
      acceptedRevision: 1,
      acceptedMutationId: draft.mutationId,
    });
    expect(remote.rpc).toHaveBeenNthCalledWith(1, 'sync_assessment_draft', {
      p_attempt_id: record.id,
      p_base_revision: 0,
      p_revision: 1,
      p_mutation_id: draft.mutationId,
      p_answers: [{ question_id: 'q', selected_choice_id: 'b' }],
    });
    expect(remote.rpc).toHaveBeenNthCalledWith(2, 'get_assessment_attempt', {
      p_assessment: 'pre-test',
    });
  });
  it('rejects responses for another account and missing revision contracts', async () => {
    remote.rpc.mockResolvedValue({ data: [record], error: null });
    await expect(getAssessmentAttempt(crypto.randomUUID(), 'pre-test')).rejects.toThrow(
      'another session',
    );
    expect(() => toAssessmentAttempt({ ...record, accepted_revision: undefined })).toThrow();
  });
  it('requires the exact final revision and does not submit client scoring', async () => {
    remote.rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        data: [
          {
            ...record,
            status: 'submitted',
            score: 100,
            submitted_at: '2026-08-30T12:01:00.000Z',
            submitted_revision: 3,
            accepted_revision: 3,
          },
        ],
        error: null,
      });
    await completeAssessment(record.user_id, 'pre-test', record.id, 3);
    expect(remote.rpc).toHaveBeenNthCalledWith(1, 'complete_assessment_revision', {
      p_attempt_id: record.id,
      p_revision: 3,
    });
  });
  it('times out without claiming the remote operation definitely failed and clears its timer', async () => {
    vi.useFakeTimers();
    remote.rpc.mockReturnValue(new Promise(() => undefined));
    const result = expect(getAssessmentAttempt(record.user_id, 'pre-test')).rejects.toThrow(
      'timed out',
    );
    await vi.advanceTimersByTimeAsync(15000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
