import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageLoadError } from '@/components/ui/PageLoadError';
import { CharacterAssistant } from '@/features/characters/components/CharacterAssistant';
import { resolveLessonCharacterDialogue } from '@/features/characters/character.dialogue';
import { resolveLessonResultReaction } from '@/features/characters/lesson-result-reaction';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LearningLesson } from './domain/content.schemas';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { getLesson } from './content/content.service';
import { getAttempt, startOrResumeAttempt } from './attempts/attempt.service';
import {
  getLessonHubData,
  getLessonProgress,
  type LessonHubEntry,
} from './progress/progress.service';
import { hasPendingLessonUnlock } from './progress/progress-transitions';
import { StarRating } from './components/StarRating';
import { ContentState } from './components/ContentState';
import { useLessonTransition } from './navigation/useLessonTransition';
import {
  playNeutralClickOnKeyDown,
  playNeutralClickOnPointerDown,
} from '@/services/audio/click.handlers';
import { playCompletion, playReward } from '@/services/audio/audio.manager';
import { StudentStreak } from '@/features/streaks/StudentStreak';

function LessonResultAudio({ attempt }: { attempt: LessonAttempt }) {
  const playedAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    if (playedAttemptRef.current === attempt.id) return;
    playedAttemptRef.current = attempt.id;
    if (attempt.finalScore === 100) playReward(attempt.id);
    else playCompletion(attempt.id);
  }, [attempt]);

  return null;
}

export function LessonResultPage() {
  const { lessonId = '', attemptId = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const { loadingMessage, transitionError, transitionBusy, startTransition } =
    useLessonTransition();
  const [lesson, setLesson] = useState<LearningLesson | null>(null);
  const [attempt, setAttempt] = useState<LessonAttempt | null>(null);
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [nextEntry, setNextEntry] = useState<LessonHubEntry | null>(null);
  const [newlyUnlocked, setNewlyUnlocked] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const loadKey = `${user?.id ?? 'guest'}:${lessonId}:${attemptId}:${loadRevision}`;
  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    let current = true;
    void Promise.all([
      getLesson(db, lessonId, attemptId),
      getAttempt(db, user.id, attemptId),
      getLessonHubData(db, user.id),
    ])
      .then(async ([loadedLesson, loadedAttempt, hub]) => {
        if (!current) return;
        const loadedProgress =
          hub.entries.find(({ lesson: candidate }) => candidate.id === loadedLesson.id)?.progress ??
          (await getLessonProgress(db, user.id, lessonId));
        if (!current) return;
        if (!loadedProgress) throw new Error('Lesson progress is unavailable.');
        setLesson(loadedLesson);
        setAttempt(loadedAttempt);
        setProgress(loadedProgress);
        setNewlyUnlocked(hasPendingLessonUnlock(user.id, loadedLesson.id));
        setNextEntry(
          hub.entries.find(
            ({ lesson: candidate, progress: candidateProgress }) =>
              candidate.prerequisiteLessonId === loadedLesson.id &&
              candidateProgress.status !== 'locked',
          ) ?? null,
        );
        setLoadError('');
        setLoadedFor(loadKey);
      })
      .catch(() => {
        if (current) {
          setLoadError('This lesson result could not be loaded.');
          setLoadedFor(loadKey);
        }
      });
    return () => {
      current = false;
    };
  }, [attemptId, contentStatus, lessonId, loadKey, user]);

  if (loadedFor === loadKey && loadError) {
    return (
      <ContentState>
        <PageLoadError
          title="Result unavailable"
          message={loadError}
          onRetry={() => setLoadRevision((revision) => revision + 1)}
        />
      </ContentState>
    );
  }

  if (
    loadedFor !== loadKey ||
    !user ||
    !lesson ||
    !attempt ||
    !progress ||
    attempt.status !== 'completed'
  ) {
    return (
      <ContentState>
        <LoadingState variant="page" message="Loading your result…" />
      </ContentState>
    );
  }
  if (loadingMessage) {
    return (
      <ContentState>
        <LoadingState variant="page" message={loadingMessage} />
      </ContentState>
    );
  }
  const retry = () => {
    void startTransition({
      loadingMessage: 'Preparing your lesson…',
      run: async () => {
        const next = await startOrResumeAttempt(db, user.id, lesson.id);
        return `/lessons/${lesson.id}/play/${next.id}`;
      },
      fallbackError: 'Unable to open this lesson.',
    });
  };
  const correct = attempt.answers.filter((answer) => answer.isCorrect).length;
  const characterReaction = resolveLessonResultReaction(attempt.cleared === true);
  const nextDestination = nextEntry
    ? nextEntry.lesson.contentStatus === 'preview'
      ? `/lessons/${nextEntry.lesson.id}/preview`
      : `/lessons/${nextEntry.lesson.id}`
    : '/lessons';

  return (
    <ContentState>
      <div
        className={`result-page result-page--${attempt.cleared ? 'cleared' : 'failed'} page-enter`}
      >
        <LessonResultAudio attempt={attempt} />
        <main className="result-board" aria-live="polite">
          <div className="result-board__mark" aria-hidden="true">
            {attempt.cleared ? '✓' : '↻'}
          </div>
          <h1>{attempt.cleared ? 'Lesson complete' : 'Try again'}</h1>
          <p>
            {attempt.cleared
              ? nextEntry && newlyUnlocked
                ? `${nextEntry.lesson.title} is now unlocked.`
                : 'Your result has been saved.'
              : `A score of ${lesson.passingThreshold}% is required. Review operation words and order-sensitive phrases.`}
          </p>
          <div className="result-score">
            <strong>{attempt.finalScore}%</strong>
            <span>
              {correct} of {lesson.activities.length} correct
            </span>
          </div>
          <StarRating count={attempt.starCount ?? 0} />
          <StudentStreak key={attempt.id} attemptId={attempt.id} />
          <div className="result-metrics">
            {attempt.xpImprovement > 0 && <span>+{attempt.xpImprovement} XP</span>}
            <span>Best score {progress.bestScore}%</span>
            <span>
              {progress.attemptCount} {progress.attemptCount === 1 ? 'attempt' : 'attempts'}
            </span>
          </div>
          <CharacterAssistant
            characterId={lesson.characterId}
            state={characterReaction.state}
            dialogue={resolveLessonCharacterDialogue(lesson, characterReaction.dialogueEvent)}
            presentation="result"
            reactionKey={`${attempt.id}:${attempt.cleared ? 'passed' : 'not-passed'}`}
            className="result-companion"
            announcement="off"
          />
          <div className="result-actions">
            {attempt.cleared && nextEntry ? (
              <Link
                className="button button--primary"
                to={nextDestination}
                onPointerDown={playNeutralClickOnPointerDown}
                onKeyDown={playNeutralClickOnKeyDown}
              >
                View next lesson
              </Link>
            ) : (
              <Button
                onPointerDown={playNeutralClickOnPointerDown}
                onKeyDown={playNeutralClickOnKeyDown}
                onClick={() => {
                  retry();
                }}
                disabled={transitionBusy}
                aria-busy={transitionBusy}
              >
                {attempt.cleared ? 'Review lesson' : 'Retry lesson'}
              </Button>
            )}
            <Link
              className="button button--quiet"
              to="/lessons"
              onPointerDown={playNeutralClickOnPointerDown}
              onKeyDown={playNeutralClickOnKeyDown}
            >
              Lessons
            </Link>
          </div>
          {transitionError && (
            <p className="form-error" role="alert">
              {transitionError}
            </p>
          )}
        </main>
      </div>
    </ContentState>
  );
}
