import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedAssessment } from './assessment-management.service';
import { AssessmentManagementPage } from './AssessmentManagementPage';

const management = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  publish: vi.fn(),
}));
vi.mock('./assessment-management.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./assessment-management.service')>();
  return {
    ...actual,
    listManagedAssessments: management.list,
    saveManagedAssessment: management.save,
    publishManagedAssessment: management.publish,
  };
});

const managed = (assessment: 'pre-test' | 'post-test'): ManagedAssessment => ({
  assessment,
  draft: {
    assessment,
    questions: [
      {
        id: `${assessment}-question-1`,
        prompt: `${assessment} first question`,
        choices: [
          { id: 'a', label: 'First answer' },
          { id: 'b', label: 'Second answer' },
        ],
        correctChoiceId: 'a',
        isPlaceholder: false,
      },
      {
        id: `${assessment}-question-2`,
        prompt: `${assessment} second question`,
        choices: [
          { id: 'a', label: 'One' },
          { id: 'b', label: 'Two' },
        ],
        correctChoiceId: 'b',
        isPlaceholder: false,
      },
    ],
  },
  revision: 1,
  published_version: 2,
  published_attempt_count: assessment === 'pre-test' ? 1 : 0,
  updated_at: '2026-09-15T00:00:00Z',
});

describe('Assessment Management page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    management.list.mockResolvedValue([managed('pre-test'), managed('post-test')]);
    management.save.mockImplementation(async (_item, draft) => ({
      ...managed(draft.assessment),
      draft,
      revision: 2,
    }));
    management.publish.mockImplementation(async (item) => ({
      ...item,
      revision: item.revision + 1,
      published_version: item.published_version + 1,
    }));
  });

  it('shows only the shared centered loader until both assessment records load', async () => {
    let resolve!: (value: ManagedAssessment[]) => void;
    management.list.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<AssessmentManagementPage />);
    expect(screen.getByRole('status')).toHaveClass('loading-state--page', 'admin-content-loading');
    expect(
      screen.queryByRole('heading', { name: 'Assessment Management' }),
    ).not.toBeInTheDocument();
    await act(async () => resolve([managed('pre-test'), managed('post-test')]));
    expect(
      await screen.findByRole('heading', { name: 'Assessment Management' }),
    ).toBeInTheDocument();
  });

  it('lists and opens both Pre-test and Post-test content', async () => {
    render(<AssessmentManagementPage />);
    expect(await screen.findByText('Pre-test')).toBeInTheDocument();
    expect(screen.getByText('Post-test')).toBeInTheDocument();
    expect(screen.getByText(/Immutable — used by 1 attempt/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Manage Post-test' }));
    expect(screen.getByRole('group', { name: 'Post-test draft' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('post-test first question')).toBeInTheDocument();
  });

  it('edits, reorders, deletes, and adds draft questions and answer choices', async () => {
    render(<AssessmentManagementPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Manage Pre-test' }));
    const prompts = screen.getAllByLabelText('Question text');
    fireEvent.change(prompts[0], { target: { value: 'Edited wording' } });
    await userEvent.click(screen.getAllByRole('button', { name: 'Move down' })[0]);
    expect(screen.getAllByLabelText('Question text')[1]).toHaveValue('Edited wording');
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete question' })[0]);
    expect(screen.getAllByLabelText('Question text')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Add question' }));
    expect(screen.getAllByLabelText('Question text')).toHaveLength(2);
    const lastQuestion = screen.getAllByRole('listitem')[1];
    await userEvent.click(within(lastQuestion).getByRole('button', { name: 'Add answer choice' }));
    fireEvent.change(within(lastQuestion).getByLabelText('Question text'), {
      target: { value: 'New question' },
    });
    const newChoices = within(lastQuestion).getAllByLabelText(/^Choice /);
    expect(newChoices).toHaveLength(3);
    newChoices.forEach((choice, index) =>
      fireEvent.change(choice, { target: { value: `New choice ${index + 1}` } }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(management.save).toHaveBeenCalledWith(
      expect.objectContaining({ assessment: 'pre-test' }),
      expect.objectContaining({ assessment: 'pre-test' }),
    );
  });

  it('previews without revealing which answer is correct and publishes through the service', async () => {
    render(<AssessmentManagementPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Manage Post-test' }));
    await userEvent.click(screen.getByRole('button', { name: 'Preview assessment' }));
    expect(screen.getByRole('region', { name: 'Post-test preview' })).toBeInTheDocument();
    expect(screen.queryByText('Correct', { selector: 'label' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Return to editor' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publish new version' }));
    expect(management.publish).toHaveBeenCalledWith(
      expect.objectContaining({ assessment: 'post-test', revision: 1 }),
    );
    expect(await screen.findByText('Post-test version 3 published.')).toBeInTheDocument();
  });
});
