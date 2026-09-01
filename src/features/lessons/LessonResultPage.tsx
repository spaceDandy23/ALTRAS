import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { LoadingState } from '@/components/ui/LoadingState';
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
import { StarRating } from './components/StarRating';
import { ContentState } from './components/ContentState';
import { useLessonTransition } from './navigation/useLessonTransition';

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

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    void Promise.all([
      getLesson(db, lessonId),
      getAttempt(db, user.id, attemptId),
      getLessonProgress(db, user.id, lessonId),
      getLessonHubData(db, user.id),
    ]).then(([loadedLesson, loadedAttempt, loadedProgress, hub]) => {
      setLesson(loadedLesson);
      setAttempt(loadedAttempt);
      setProgress(loadedProgress);
      setNextEntry(
        hub.entries.find(
          ({ lesson: candidate, progress: candidateProgress }) =>
            candidate.prerequisiteLessonId === loadedLesson.id &&
            candidateProgress.status !== 'locked',
        ) ?? null,
      );
    });
  }, [attemptId, contentStatus, lessonId, user]);

  if (!user || !lesson || !attempt || !progress || attempt.status !== 'completed') {
    return (
      <ContentState>
        <div className="result-page">
          <LoadingState message="Loading your result…" />
        </div>
      </ContentState>
    );
  }
  if (loadingMessage) {
    return (
      <ContentState>
        <LoadingState className="loading-screen" message={loadingMessage} />
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
        <main className="result-board" aria-live="polite">
          <div className="result-board__mark" aria-hidden="true">
            {attempt.cleared ? '✓' : '↻'}
          </div>
          <h1>{attempt.cleared ? 'Lesson complete' : 'Try again'}</h1>
          <p>
            {attempt.cleared
              ? nextEntry
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
          <div className="result-metrics">
            {attempt.xpImprovement > 0 && <span>+{attempt.xpImprovement} XP</span>}
            <span>Best score {progress.bestScore}%</span>
            <span>
              {progress.attemptCount} {progress.attemptCount === 1 ? 'attempt' : 'attempts'}
            </span>
          </div>
          <div className="result-actions">
            {attempt.cleared && nextEntry ? (
              <Link className="button button--primary" to={nextDestination}>
                View next lesson
              </Link>
            ) : (
              <Button onClick={retry} disabled={transitionBusy} aria-busy={transitionBusy}>
                {attempt.cleared ? 'Review lesson' : 'Retry lesson'}
              </Button>
            )}
            <Link className="button button--quiet" to="/lessons">
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
