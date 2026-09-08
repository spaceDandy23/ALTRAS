import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageLoadError } from '@/components/ui/PageLoadError';
import { CharacterAssistant } from '@/features/characters/components/CharacterAssistant';
import { resolveCharacterDialogue } from '@/features/characters/character.dialogue';
import { db } from '@/db/database';
import { ContentState } from '@/features/lessons/components/ContentState';
import { StarRating } from '@/features/lessons/components/StarRating';
import { getActiveAttempt } from '@/features/lessons/attempts/attempt.service';
import {
  getLessonHubData,
  getTotalXp,
  type LessonHubData,
} from '@/features/lessons/progress/progress.service';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LessonAttempt } from '@/types/learning';
import {
  playNeutralClickOnKeyDown,
  playNeutralClickOnPointerDown,
} from '@/services/audio/click.handlers';
import { selectHomeLesson } from './home-lesson-selection';
import { consumeLessonUnlock } from '@/features/lessons/progress/progress-transitions';
import { resolveLessonDisplayStatus } from '@/features/lessons/components/lesson-display-status';

export function MainMenuPage() {
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const [hub, setHub] = useState<LessonHubData | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<LessonAttempt | null>(null);
  const [totalXp, setTotalXp] = useState(0);
  const [recentUnlockSource, setRecentUnlockSource] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const loadKey = `${user?.id ?? 'guest'}:${loadRevision}`;

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    let active = true;
    void getLessonHubData(db, user.id)
      .then(async (nextHub) => {
        const playable = nextHub.entries.filter(
          ({ lesson }) => lesson.contentStatus === 'playable',
        );
        const [attempts, xp] = await Promise.all([
          Promise.all(playable.map(({ lesson }) => getActiveAttempt(db, user.id, lesson.id))),
          getTotalXp(db, user.id),
        ]);
        if (!active) return;
        const nextActiveAttempt = attempts.find((attempt) => attempt !== null) ?? null;
        const selectedEntry = selectHomeLesson(nextHub.entries, nextActiveAttempt);
        const prerequisiteId = selectedEntry?.lesson.prerequisiteLessonId;
        setHub(nextHub);
        setActiveAttempt(nextActiveAttempt);
        setRecentUnlockSource(
          prerequisiteId && consumeLessonUnlock(user.id, prerequisiteId) ? prerequisiteId : null,
        );
        setTotalXp(xp);
        setLoadError('');
        setLoadedFor(loadKey);
      })
      .catch(() => {
        if (active) {
          setLoadError('Your learning summary could not be loaded.');
          setLoadedFor(loadKey);
        }
      });
    return () => {
      active = false;
    };
  }, [contentStatus, loadKey, user]);

  const nextEntry = hub ? selectHomeLesson(hub.entries, activeAttempt) : undefined;
  const selectedAttempt =
    activeAttempt && activeAttempt.lessonId === nextEntry?.lesson.id ? activeAttempt : null;
  const displayStatus = nextEntry
    ? resolveLessonDisplayStatus(nextEntry.progress, selectedAttempt !== null)
    : null;
  const actionDestination = selectedAttempt
    ? `/lessons/${selectedAttempt.lessonId}/play/${selectedAttempt.id}`
    : nextEntry
      ? nextEntry.lesson.contentStatus === 'preview'
        ? `/lessons/${nextEntry.lesson.id}/preview`
        : `/lessons/${nextEntry.lesson.id}`
      : '/lessons';
  const completedActivities = selectedAttempt?.answers.length ?? 0;
  const totalActivities = nextEntry?.lesson.activities.length ?? 0;
  const earnedStarCount = Math.max(
    0,
    ...(hub?.entries.map(({ progress }) => progress.bestStarCount) ?? []),
  );
  const actionLabel = selectedAttempt
    ? `Continue Lesson ${nextEntry ? nextEntry.lesson.displayOrder : 1}`
    : nextEntry?.lesson.contentStatus === 'preview'
      ? `View Lesson ${nextEntry.lesson.displayOrder}`
      : displayStatus === 'cleared'
        ? 'Review lesson'
        : displayStatus === 'needs-retry'
          ? 'Try lesson again'
          : `Start Lesson ${nextEntry?.lesson.displayOrder ?? 1}`;
  const prerequisiteEntry = nextEntry?.lesson.prerequisiteLessonId
    ? hub?.entries.find(({ lesson }) => lesson.id === nextEntry.lesson.prerequisiteLessonId)
    : undefined;
  const unlockMessage =
    nextEntry?.progress.status === 'available' &&
    prerequisiteEntry?.progress.status === 'cleared' &&
    recentUnlockSource === prerequisiteEntry.lesson.id
      ? `Lesson ${prerequisiteEntry.lesson.displayOrder} complete. Lesson ${nextEntry.lesson.displayOrder} is unlocked.`
      : null;
  const allComplete = displayStatus === 'cleared';

  return (
    <ContentState>
      {loadedFor !== loadKey ? (
        <LoadingState variant="page" message="Preparing your lesson…" />
      ) : loadError ? (
        <PageLoadError
          title="Home is unavailable"
          message={loadError}
          onRetry={() => setLoadRevision((revision) => revision + 1)}
        />
      ) : !hub || !nextEntry ? (
        <LoadingState variant="page" message="Preparing your lesson…" />
      ) : (
        <div className="menu-page page-enter">
          <section className="home-start menu-grid" aria-labelledby="home-title">
            <p className="home-welcome">Welcome back, {user?.displayName}.</p>
            <CharacterAssistant
              characterId={nextEntry.lesson.characterId}
              state="greeting"
              dialogue={resolveCharacterDialogue('main-menu-greeting', {
                characterId: nextEntry.lesson.characterId,
                override: allComplete ? 'All available lessons complete.' : undefined,
              })}
              presentation="compact"
              reactionKey="main-menu"
              className="home-companion"
            />
            <div className="home-start__lesson">
              <div className="home-start__marker" aria-hidden="true">
                {displayStatus === 'cleared' ? '✓' : nextEntry.lesson.displayOrder}
              </div>
              <div className="home-start__content">
                <span className="home-start__position">
                  Lesson {nextEntry.lesson.displayOrder} · {hub.unit.title}
                </span>
                <h1 id="home-title">{nextEntry.lesson.title}</h1>
                <p>{nextEntry.lesson.shortDescription}</p>
                {selectedAttempt && totalActivities > 0 ? (
                  <div className="home-progress">
                    <div className="home-progress__track" aria-hidden="true">
                      <span
                        style={{ width: `${(completedActivities / totalActivities) * 100}%` }}
                      />
                    </div>
                    <span>
                      {completedActivities} of {totalActivities} activities completed
                    </span>
                  </div>
                ) : nextEntry.lesson.contentStatus === 'preview' ? (
                  <p className="home-complete">Unlocked · Lesson preview</p>
                ) : unlockMessage ? (
                  <p className="home-complete">{unlockMessage}</p>
                ) : displayStatus === 'cleared' ? (
                  <p className="home-complete">All available lessons complete.</p>
                ) : displayStatus === 'needs-retry' ? (
                  <p className="home-not-started">Needs retry · {totalActivities} activities</p>
                ) : (
                  <p className="home-not-started">Not started · {totalActivities} activities</p>
                )}
                <div className="home-actions">
                  <Link
                    className="button button--primary home-primary-action"
                    to={actionDestination}
                    onPointerDown={playNeutralClickOnPointerDown}
                    onKeyDown={playNeutralClickOnKeyDown}
                  >
                    {actionLabel}
                    <span aria-hidden="true">→</span>
                  </Link>
                  <Link className="home-lessons-link" to="/lessons">
                    View all lessons
                  </Link>
                </div>
              </div>
            </div>
            <div className="home-summary" aria-label="Learning progress">
              <span>{totalXp} XP</span>
              <StarRating count={earnedStarCount} />
            </div>
            <div className="home-assessments" aria-label="Assessments">
              <Link to="/assessments/pre-test">
                <span>Before the lessons</span>
                <strong>Take the pre-test</strong>
                <small>One saved attempt</small>
              </Link>
              <Link to="/assessments/post-test">
                <span>After the lessons</span>
                <strong>Take the post-test</strong>
                <small>One saved attempt</small>
              </Link>
            </div>
          </section>
        </div>
      )}
    </ContentState>
  );
}
