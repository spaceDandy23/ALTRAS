import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/BackLink';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageLoadError } from '@/components/ui/PageLoadError';
import { CharacterAssistant } from '@/features/characters/components/CharacterAssistant';
import { resolveLessonCharacterDialogue } from '@/features/characters/character.dialogue';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LearningLesson } from './domain/content.schemas';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { getLesson } from './content/content.service';
import { getLessonProgress } from './progress/progress.service';
import { getActiveAttempt, restartAttempt, startOrResumeAttempt } from './attempts/attempt.service';
import { ContentState } from './components/ContentState';
import { resolveLessonDisplayStatus } from './components/lesson-display-status';
import { useLessonTransition } from './navigation/useLessonTransition';
import { useLessonDrafts } from './attempts/useLessonDrafts';
import { StarRating } from './components/StarRating';
import {
  playNeutralClickOnKeyDown,
  playNeutralClickOnPointerDown,
} from '@/services/audio/click.handlers';

export function LessonOverviewPage() {
  const { lessonId = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const drafts = useLessonDrafts(user?.id);
  const local = drafts?.get(lessonId);
  const pendingResult = Boolean(local?.pendingCompletion);
  const { loadingMessage, transitionError, transitionBusy, startTransition } =
    useLessonTransition();
  const [remoteLesson, setLesson] = useState<LearningLesson | null>(null);
  const [remoteProgress, setProgress] = useState<LessonProgress | null>(null);
  const [remoteActive, setActive] = useState<LessonAttempt | null>(null);
  const newerActive =
    local &&
    remoteActive?.userId === user?.id &&
    remoteActive?.lessonId === lessonId &&
    remoteActive.id !== local.attemptId &&
    remoteActive.startedAt >= local.attempt.startedAt;
  const result = local?.attempt.status === 'completed' && !newerActive ? local.attempt : null;
  // A completed local draft is only a recovery source offline. Online, wait
  // for the authoritative progress/attempt read so the overview does not
  // briefly show stale status, stars, or actions before reconciling.
  const cached = local && (local.pendingCompletion || !navigator.onLine) ? local : undefined;
  const lesson = cached?.lesson ?? remoteLesson;
  const progress = cached ? null : remoteProgress;
  const active = cached
    ? cached.attempt.status === 'active'
      ? cached.attempt
      : null
    : remoteActive;
  const [prerequisiteTitle, setPrerequisiteTitle] = useState('the prerequisite lesson');
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const loadKey = `${user?.id ?? 'guest'}:${lessonId}:${loadRevision}`;

  useEffect(() => {
    if (!user || contentStatus !== 'ready' || drafts === undefined) return;
    if (local && (local.pendingCompletion || !navigator.onLine)) return;
    let current = true;
    void Promise.all([
      getLesson(db, lessonId),
      getLessonProgress(db, user.id, lessonId),
      getActiveAttempt(db, user.id, lessonId),
    ])
      .then(async ([nextLesson, nextProgress, nextActive]) => {
        const prerequisite =
          nextProgress.status === 'locked' && nextLesson.prerequisiteLessonId
            ? await getLesson(db, nextLesson.prerequisiteLessonId)
            : null;
        const visibleLesson = nextActive
          ? await getLesson(db, lessonId, nextActive.id)
          : nextLesson;
        if (!current) return;
        setLesson(visibleLesson);
        setPrerequisiteTitle(prerequisite?.title ?? 'the prerequisite lesson');
        setProgress(nextProgress);
        setActive(nextActive);
        setLoadError('');
        setLoadedFor(loadKey);
      })
      .catch(() => {
        if (current) {
          setLoadError('This lesson could not be loaded.');
          setLoadedFor(loadKey);
        }
      });
    return () => {
      current = false;
    };
  }, [contentStatus, lessonId, loadKey, user, drafts, local]);

  if (!user) return null;
  const displayStatus = progress ? resolveLessonDisplayStatus(progress, active !== null) : null;
  const begin = () => {
    if (pendingResult || progress?.status === 'locked' || transitionBusy) return;
    void startTransition({
      loadingMessage: active ? 'Restoring your attempt…' : 'Preparing your lesson…',
      run: async () => {
        const attempt =
          !navigator.onLine && local
            ? local.attempt
            : await startOrResumeAttempt(db, user.id, lessonId);
        return `/lessons/${lessonId}/play/${attempt.id}`;
      },
      fallbackError: 'Unable to open this lesson.',
    });
  };
  const restart = () => {
    if (pendingResult || transitionBusy) return;
    setConfirmRestart(false);
    void startTransition({
      loadingMessage: 'Restarting your lesson…',
      run: async () => {
        const attempt = await restartAttempt(db, user.id, lessonId);
        return `/lessons/${lessonId}/play/${attempt.id}`;
      },
      fallbackError: 'Unable to restart this lesson.',
    });
  };

  if (loadingMessage) {
    return (
      <ContentState>
        <LoadingState variant="page" message={loadingMessage} />
      </ContentState>
    );
  }

  return (
    <ContentState>
      {!cached && loadedFor !== loadKey ? (
        <LoadingState variant="page" message="Opening lesson…" />
      ) : !cached && loadError ? (
        <PageLoadError
          title="Lesson unavailable"
          message={loadError}
          onRetry={() => setLoadRevision((revision) => revision + 1)}
        />
      ) : !lesson || (!progress && !local) ? (
        <LoadingState variant="page" message="Opening lesson…" />
      ) : (
        <div className="standard-page lesson-overview page-enter">
          <BackLink to="/lessons" label="Back to lessons" />
          <>
            <section className="lesson-overview__hero">
              <div>
                <h1>{lesson.title}</h1>
                <p>{lesson.shortDescription}</p>
                <div className="lesson-overview__meta" aria-label="Lesson details">
                  <span>{lesson.activities.length} activities</span>
                  <span>{lesson.passingThreshold}% to pass</span>
                  {!pendingResult && result ? (
                    <>
                      <span>Score {result.finalScore}%</span>
                      <StarRating count={result.starCount ?? 0} />
                      <span>{result.xpImprovement} XP earned</span>
                    </>
                  ) : (
                    !pendingResult &&
                    progress &&
                    progress.attemptCount > 0 && <span>Best score {progress.bestScore}%</span>
                  )}
                </div>
                <CharacterAssistant
                  characterId={lesson.characterId}
                  state="explaining"
                  dialogue={resolveLessonCharacterDialogue(lesson, 'lesson-introduction')}
                  presentation="overview"
                  reactionKey={lesson.id}
                  className="lesson-overview__companion"
                />
                {pendingResult ? (
                  <div className="lesson-overview__actions lesson-summary">
                    <p role="status">
                      <strong>Results pending sync</strong>
                      <br />
                      Your attempt is saved on this device. Connect to the internet for official
                      results.
                    </p>
                    <Button disabled>Try again</Button>
                  </div>
                ) : result ? (
                  <div className="lesson-overview__actions lesson-summary">
                    <Link
                      className="button button--primary"
                      to={`/lessons/${lessonId}/result/${result.id}`}
                    >
                      View Results
                    </Link>
                    <Button onClick={restart} disabled={transitionBusy}>
                      Restart Lesson
                    </Button>
                  </div>
                ) : progress?.status === 'locked' ? (
                  <p className="lesson-overview__actions lesson-summary">
                    Clear {prerequisiteTitle} to unlock this lesson.
                  </p>
                ) : (
                  <div className="lesson-overview__actions lesson-summary">
                    <Button
                      onPointerDown={playNeutralClickOnPointerDown}
                      onKeyDown={playNeutralClickOnKeyDown}
                      onClick={begin}
                      disabled={transitionBusy}
                      aria-busy={transitionBusy}
                    >
                      {active || displayStatus === 'in-progress'
                        ? 'Resume lesson'
                        : displayStatus === 'needs-retry'
                          ? 'Try again'
                          : 'Start lesson'}
                    </Button>
                    {active && (
                      <Button
                        variant="quiet"
                        disabled={transitionBusy}
                        onPointerDown={playNeutralClickOnPointerDown}
                        onKeyDown={playNeutralClickOnKeyDown}
                        onClick={() => {
                          setConfirmRestart(true);
                        }}
                      >
                        Restart lesson
                      </Button>
                    )}
                  </div>
                )}
                {transitionError && (
                  <p className="form-error" role="alert">
                    {transitionError}
                  </p>
                )}
              </div>
              <div className="lesson-overview__equation" aria-hidden="true">
                <span className="lesson-overview__equation-label">words</span>
                <span className="lesson-overview__equation-arrow">→</span>
                <span className="lesson-overview__equation-label">math</span>
              </div>
            </section>
            {progress?.status !== 'locked' && (
              <section className="lesson-reference" aria-labelledby="operation-words-heading">
                <h2 id="operation-words-heading">Operation words</h2>
                {lesson.instructionalContent
                  .filter((block) => block.type === 'paragraph')
                  .map((block) => (
                    <p className="lesson-reference__intro" key={block.id}>
                      {block.body}
                    </p>
                  ))}
                <div className="operation-examples">
                  {lesson.instructionalContent
                    .filter((block) => block.type === 'example')
                    .map((block) =>
                      block.type === 'example' ? (
                        <article className="operation-example" key={block.id}>
                          <div>
                            <span>{block.phrase}</span>
                            <strong>{block.expression}</strong>
                          </div>
                          <p>{block.note}</p>
                        </article>
                      ) : null,
                    )}
                </div>
                {lesson.instructionalContent
                  .filter((block) => block.type === 'warning')
                  .map((block) =>
                    block.type === 'warning' ? (
                      <aside className="order-warning" key={block.id}>
                        <h3>Order matters</h3>
                        <p>{block.body}</p>
                      </aside>
                    ) : null,
                  )}
              </section>
            )}
          </>
          <ConfirmDialog
            open={confirmRestart}
            title="Restart this lesson?"
            confirmLabel="Restart lesson"
            onCancel={() => setConfirmRestart(false)}
            onConfirm={restart}
          >
            Your current attempt will remain in local history, but its completed answers will not
            carry into the new attempt.
          </ConfirmDialog>
        </div>
      )}
    </ContentState>
  );
}
