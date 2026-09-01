import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingState } from '@/components/ui/LoadingState';
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

export function MainMenuPage() {
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const [hub, setHub] = useState<LessonHubData | null>(null);
  const [activeAttempt, setActiveAttempt] = useState<LessonAttempt | null>(null);
  const [totalXp, setTotalXp] = useState(0);

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    void getLessonHubData(db, user.id).then(async (nextHub) => {
      const playable = nextHub.entries.filter(({ lesson }) => lesson.contentStatus === 'playable');
      const [attempts, xp] = await Promise.all([
        Promise.all(playable.map(({ lesson }) => getActiveAttempt(db, user.id, lesson.id))),
        getTotalXp(db, user.id),
      ]);
      setHub(nextHub);
      setActiveAttempt(attempts.find((attempt) => attempt !== null) ?? null);
      setTotalXp(xp);
    });
  }, [contentStatus, user]);

  const activeEntry = hub?.entries.find(({ progress }) => progress.status === 'in-progress');
  const nextEntry =
    activeEntry ??
    hub?.entries.find(
      ({ progress }) => progress.status !== 'locked' && progress.status !== 'cleared',
    ) ??
    hub?.entries.find(({ progress }) => progress.status === 'cleared');
  const actionDestination = activeAttempt
    ? `/lessons/${activeAttempt.lessonId}/play/${activeAttempt.id}`
    : nextEntry
      ? nextEntry.lesson.contentStatus === 'preview'
        ? `/lessons/${nextEntry.lesson.id}/preview`
        : `/lessons/${nextEntry.lesson.id}`
      : '/lessons';
  const completedActivities = activeAttempt?.answers.length ?? 0;
  const totalActivities = nextEntry?.lesson.activities.length ?? 0;
  const earnedStarCount = Math.max(
    0,
    ...(hub?.entries.map(({ progress }) => progress.bestStarCount) ?? []),
  );
  const actionLabel = activeAttempt
    ? `Continue Lesson ${nextEntry ? nextEntry.lesson.displayOrder : 1}`
    : nextEntry?.lesson.contentStatus === 'preview'
      ? `View Lesson ${nextEntry.lesson.displayOrder}`
      : nextEntry?.progress.attemptCount
        ? 'Try lesson again'
        : `Start Lesson ${nextEntry?.lesson.displayOrder ?? 1}`;

  return (
    <ContentState>
      {!hub || !nextEntry ? (
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
              })}
              presentation="compact"
              reactionKey="main-menu"
              className="home-companion"
            />
            <div className="home-start__lesson">
              <div className="home-start__marker" aria-hidden="true">
                {nextEntry.progress.status === 'cleared' ? '✓' : nextEntry.lesson.displayOrder}
              </div>
              <div className="home-start__content">
                <span className="home-start__position">
                  Lesson {nextEntry.lesson.displayOrder} · {hub.unit.title}
                </span>
                <h1 id="home-title">{nextEntry.lesson.title}</h1>
                <p>{nextEntry.lesson.shortDescription}</p>
                {activeAttempt && totalActivities > 0 ? (
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
                ) : nextEntry.progress.status === 'cleared' ? (
                  <p className="home-complete">Lesson 1 complete. Lesson 2 is unlocked.</p>
                ) : (
                  <p className="home-not-started">Not started · {totalActivities} activities</p>
                )}
                <div className="home-actions">
                  <Link
                    className="button button--primary home-primary-action"
                    to={actionDestination}
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
