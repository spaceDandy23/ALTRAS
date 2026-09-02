import { useEffect, useState } from 'react';
import type { LessonActivity } from '@/features/lessons/domain/content.schemas';
import type { SubmittedActivityAnswer } from '@/types/learning';
import { resolveActivityCharacterReaction } from '../activity-reaction';
import { resolveActivityCharacterDialogue } from '../character.dialogue';
import { CharacterAssistant } from './CharacterAssistant';

export function ActivityCharacterAssistant({
  activity,
  submitted,
  hintVisible,
  characterId,
}: {
  activity: LessonActivity;
  submitted?: SubmittedActivityAnswer;
  hintVisible: boolean;
  characterId?: string;
}) {
  const answerKey = submitted ? `${activity.id}:${submitted.submittedAt}` : null;
  const [encouragingAnswerKey, setEncouragingAnswerKey] = useState<string | null>(null);

  useEffect(() => {
    if (!answerKey || submitted?.isCorrect) return;
    const timeout = window.setTimeout(() => setEncouragingAnswerKey(answerKey), 1800);
    return () => window.clearTimeout(timeout);
  }, [answerKey, submitted?.isCorrect]);

  const reaction = resolveActivityCharacterReaction({
    submitted,
    hintVisible,
    encouraging: encouragingAnswerKey === answerKey,
  });

  return (
    <CharacterAssistant
      characterId={characterId}
      state={reaction.state}
      dialogue={resolveActivityCharacterDialogue(activity, reaction.dialogueEvent, characterId)}
      presentation="activity"
      reactionKey={`${activity.id}:${reaction.dialogueEvent}:${answerKey ?? 'open'}`}
      announcement="off"
      className="lesson-player__companion"
    />
  );
}
