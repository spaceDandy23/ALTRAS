import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { packagedContent } from '../content/packaged-content';
import { activitySchema, type ChooseCorrectTranslationActivity } from '../domain/content.schemas';
import { evaluateActivity } from '../domain/evaluation';
import { FindWordActivityView } from './FindWordActivityView';
import { OrganizeTranslateActivityView } from './OrganizeTranslateActivityView';
import { ChooseCorrectTranslationActivityView } from './ChooseCorrectTranslationActivityView';

vi.mock('@/services/audio/audio.manager', () => ({ playSfx: vi.fn() }));

describe('accessible lesson activity interactions', () => {
  const translationActivity: ChooseCorrectTranslationActivity = (() => {
    const activity = activitySchema.parse({
    id: 'translate-sum',
    type: 'choose-correct-translation',
    title: 'Choose the matching expression',
    prompt: 'The sum of a number and five',
    choices: [
      { id: 'private-choice-id', label: 'n + 5' },
      { id: 'wrong-choice-id', label: 'n - 5' },
      { id: 'other-choice-id', label: '5 - n' },
    ],
    correctChoiceId: 'private-choice-id',
    explanation: { title: 'Sum means addition', body: 'Add five to n.' },
    });
    if (activity.type !== 'choose-correct-translation') throw new Error('Invalid test activity.');
    return activity;
  })();

  it('submits a translation choice without rendering internal choice IDs', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(
      <ChooseCorrectTranslationActivityView
        activity={translationActivity}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText('The sum of a number and five')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'n + 5' })).toBeInTheDocument();
    expect(screen.queryByText('private-choice-id')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'n + 5' }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(onSubmit).toHaveBeenCalledWith('private-choice-id');
    expect(evaluateActivity(translationActivity, 'private-choice-id')).toBe(true);
    expect(evaluateActivity(translationActivity, 'wrong-choice-id')).toBe(false);
  });

  it.each([
    ['correct', true, 'choice-option--correct'],
    ['incorrect', false, 'choice-option--incorrect'],
  ] as const)('shows the existing %s choice feedback state', (_label, isCorrect, className) => {
    render(
      <ChooseCorrectTranslationActivityView
        activity={translationActivity}
        submitted={{
          activityId: translationActivity.id,
          activityType: 'choose-correct-translation',
          answer: 'private-choice-id',
          isCorrect,
          submittedAt: 1,
        }}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole('radio', { name: 'n + 5' })).toBeChecked();
    expect(document.querySelector(`.${className}`)).toBeInTheDocument();
  });

  it('restores and locks an offline translation answer without revealing correctness', () => {
    render(
      <ChooseCorrectTranslationActivityView
        activity={translationActivity}
        pendingAnswer="private-choice-id"
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    expect(screen.getByRole('radio', { name: 'n + 5' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'n + 5' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Submit answer' })).not.toBeInTheDocument();
    expect(document.querySelector('.choice-option--correct')).not.toBeInTheDocument();
  });

  it('allows keyboard choice selection and requires explicit Find-the-Word submission', async () => {
    const user = userEvent.setup();
    const activity = packagedContent.lessons[0].activities.find(
      (candidate) => candidate.type === 'find-word',
    );
    if (!activity || activity.type !== 'find-word') throw new Error('Missing fixture.');
    const onSubmit = vi.fn(async () => undefined);
    const onHintVisibilityChange = vi.fn();
    render(
      <FindWordActivityView
        activity={activity}
        onSubmit={onSubmit}
        onHintVisibilityChange={onHintVisibilityChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show hint' }));
    expect(onHintVisibilityChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Hide hint' }));
    expect(onHintVisibilityChange).toHaveBeenLastCalledWith(false);

    const correct = screen.getByRole('radio', { name: 'sum' });
    correct.focus();
    await user.keyboard(' ');
    expect(correct).toBeChecked();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(onSubmit).toHaveBeenCalledWith('sum');
  });

  it('supports keyboard token selection, undo, reset, and explicit translation submission', async () => {
    const user = userEvent.setup();
    const activity = packagedContent.lessons[0].activities.find(
      (candidate) => candidate.type === 'organize-translate',
    );
    if (!activity || activity.type !== 'organize-translate') throw new Error('Missing fixture.');
    const onSubmit = vi.fn(async () => undefined);
    const onHintVisibilityChange = vi.fn();
    render(
      <OrganizeTranslateActivityView
        activity={activity}
        onSubmit={onSubmit}
        onHintVisibilityChange={onHintVisibilityChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show hint' }));
    expect(onHintVisibilityChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Hide hint' }));
    expect(onHintVisibilityChange).toHaveBeenLastCalledWith(false);

    const firstToken = screen.getByRole('button', { name: 'a number' });
    firstToken.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Remove a number' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '↶ Undo last' }));
    expect(screen.queryByRole('button', { name: 'Remove a number' })).not.toBeInTheDocument();

    for (const id of activity.correctTokenSequence) {
      const label = activity.tokens.find((token) => token.id === id)?.label;
      await user.click(screen.getByRole('button', { name: label }));
    }
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Submit translation' }));
    expect(onSubmit).toHaveBeenCalledWith(activity.correctTokenSequence);
  });

  it('keeps a locally queued answer visible and locked without revealing correctness', () => {
    const activity = packagedContent.lessons[0].activities.find(
      (candidate) => candidate.type === 'find-word',
    );
    if (!activity || activity.type !== 'find-word') throw new Error('Missing fixture.');

    render(<FindWordActivityView activity={activity} pendingAnswer="sum" onSubmit={vi.fn()} />);

    expect(screen.getByRole('radio', { name: 'sum' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'sum' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Submit answer' })).not.toBeInTheDocument();
    expect(document.querySelector('.choice-option--correct')).not.toBeInTheDocument();
    expect(document.querySelector('.choice-option--incorrect')).not.toBeInTheDocument();
  });
});
