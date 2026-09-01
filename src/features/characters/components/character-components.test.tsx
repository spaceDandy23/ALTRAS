import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { packagedContent } from '@/features/lessons/content/packaged-content';
import type { SubmittedActivityAnswer } from '@/types/learning';
import { resolveCharacterPose } from '../character.manifest';
import { ActivityCharacterAssistant } from './ActivityCharacterAssistant';
import { CharacterAssistant } from './CharacterAssistant';

const activity = packagedContent.lessons[0].activities[0];

function answer(isCorrect: boolean, submittedAt = 1): SubmittedActivityAnswer {
  return {
    activityId: activity.id,
    activityType: activity.type,
    answer:
      activity.type === 'find-word' ? activity.correctChoiceId : activity.correctTokenSequence,
    isCorrect,
    submittedAt,
  };
}

describe('character components and reactions', () => {
  afterEach(() => vi.useRealTimers());

  it('renders accessible dialogue with a decorative, aspect-stable portrait', () => {
    const { container } = render(
      <CharacterAssistant state="greeting" dialogue="Welcome back." presentation="compact" />,
    );

    expect(screen.getByLabelText('Mina, learning companion')).toHaveTextContent('Welcome back.');
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('width', '192');
    expect(image).toHaveAttribute('height', '256');
  });

  it('falls back to the neutral asset when a requested image fails', () => {
    const { container } = render(
      <CharacterAssistant state="correct" dialogue="Good work." presentation="compact" />,
    );
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', expect.stringContaining('cheer'));

    if (image) fireEvent.error(image);

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      resolveCharacterPose(undefined, 'neutral'),
    );
  });

  it('uses hint, correct, incorrect, and encouraging semantic reactions', () => {
    const { rerender } = render(
      <ActivityCharacterAssistant activity={activity} hintVisible characterId="altras-guide" />,
    );
    expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'hint',
    );

    rerender(
      <ActivityCharacterAssistant
        activity={activity}
        submitted={answer(true)}
        hintVisible={false}
      />,
    );
    expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'correct',
    );

    vi.useFakeTimers();
    rerender(
      <ActivityCharacterAssistant
        activity={activity}
        submitted={answer(false, 2)}
        hintVisible={false}
      />,
    );
    expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'incorrect',
    );
    act(() => vi.advanceTimersByTime(1800));
    expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'encouraging',
    );
  });

  it('clears stale answer reactions and timers when the activity changes', () => {
    vi.useFakeTimers();
    const nextActivity = packagedContent.lessons[0].activities[1];
    const { rerender } = render(
      <ActivityCharacterAssistant
        activity={activity}
        submitted={answer(false, 3)}
        hintVisible={false}
      />,
    );

    rerender(<ActivityCharacterAssistant activity={nextActivity} hintVisible={false} />);
    act(() => vi.advanceTimersByTime(2000));

    expect(screen.getByLabelText('Mina, learning companion')).toHaveAttribute(
      'data-character-state',
      'explaining',
    );
  });
});
