import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { packagedContent } from '../content/packaged-content';
import { FindWordActivityView } from './FindWordActivityView';
import { OrganizeTranslateActivityView } from './OrganizeTranslateActivityView';

describe('accessible lesson activity interactions', () => {
  it('allows keyboard choice selection and requires explicit Find-the-Word submission', async () => {
    const user = userEvent.setup();
    const activity = packagedContent.lessons[0].activities.find(
      (candidate) => candidate.type === 'find-word',
    );
    if (!activity || activity.type !== 'find-word') throw new Error('Missing fixture.');
    const onSubmit = vi.fn(async () => undefined);
    render(<FindWordActivityView activity={activity} onSubmit={onSubmit} />);

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
    render(<OrganizeTranslateActivityView activity={activity} onSubmit={onSubmit} />);

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
});
