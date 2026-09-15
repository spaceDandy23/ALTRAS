import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  listManagedAssessments,
  publishManagedAssessment,
  saveManagedAssessment,
  type ManagedAssessment,
} from './assessment-management.service';

const client = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/services/supabase.client', () => ({ getSupabaseClient: () => client }));

const item: ManagedAssessment = {
  assessment: 'pre-test',
  draft: {
    assessment: 'pre-test',
    questions: [
      {
        id: 'question-1',
        prompt: 'A question',
        choices: [
          { id: 'a', label: 'First' },
          { id: 'b', label: 'Second' },
        ],
        correctChoiceId: 'a',
        isPlaceholder: false,
      },
    ],
  },
  revision: 1,
  published_version: 2,
  published_attempt_count: 3,
  updated_at: '2026-09-15T00:00:00Z',
};

describe('assessment management service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads private admin assessment documents through the guarded RPC', async () => {
    client.rpc.mockResolvedValue({ data: [item], error: null });
    await expect(listManagedAssessments()).resolves.toEqual([item]);
    expect(client.rpc).toHaveBeenCalledWith('get_admin_assessments', undefined);
  });

  it('saves and publishes with optimistic revisions', async () => {
    client.rpc.mockResolvedValueOnce({ data: { ...item, revision: 2 }, error: null });
    await saveManagedAssessment(item, item.draft);
    expect(client.rpc).toHaveBeenCalledWith('save_admin_assessment', {
      p_assessment: 'pre-test',
      p_draft: item.draft,
      p_revision: 1,
    });
    client.rpc.mockResolvedValueOnce({
      data: { ...item, revision: 2, published_version: 3 },
      error: null,
    });
    await publishManagedAssessment(item);
    expect(client.rpc).toHaveBeenCalledWith('publish_admin_assessment', {
      p_assessment: 'pre-test',
      p_revision: 1,
    });
  });

  it('blocks an invalid publication before contacting the server', async () => {
    const invalid = { ...item, draft: { assessment: 'pre-test' as const, questions: [] } };
    await expect(publishManagedAssessment(invalid)).rejects.toThrow('at least one question');
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
