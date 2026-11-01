import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from '@/components/ui/BackLink';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageLoadError } from '@/components/ui/PageLoadError';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { ContentState } from './components/ContentState';
import { LessonStatusBadge } from './components/LessonStatusBadge';
import { resolveLessonDisplayStatus } from './components/lesson-display-status';
import { StarRating } from './components/StarRating';
import { getLessonHubData, getTotalXp, type LessonHubData } from './progress/progress.service';
import { useLessonDrafts } from './attempts/useLessonDrafts';
import { catalogShell } from './content/catalog-shell';

export function LessonsPage() {
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const drafts = useLessonDrafts(user?.id);
  const completedKey = [...(drafts?.values() ?? [])]
    .filter((draft) => draft.attempt.status === 'completed')
    .map((draft) => draft.attemptId)
    .sort()
    .join(':');
  const [hub, setHub] = useState<LessonHubData | null>(null);
  const [totalXp, setTotalXp] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [loadedFor, setLoadedFor] = useState('');
  const loadKey = `${user?.id ?? 'guest'}:${loadRevision}`;

  useEffect(() => {
    const refresh = () => setLoadRevision((revision) => revision + 1);
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, []);

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    if (!navigator.onLine) return;
    let active = true;
    void Promise.all([getLessonHubData(db, user.id), getTotalXp(db, user.id)])
      .then(([data, xp]) => {
        if (!active) return;
        setHub(data);
        setTotalXp(xp);
        setLoadError('');
        setLoadedFor(loadKey);
      })
      .catch(() => {
        if (!active) return;
        setLoadError('Your lesson path could not be loaded.');
        setLoadedFor(loadKey);
      });
    return () => {
      active = false;
    };
  }, [contentStatus, loadKey, user, completedKey]);

  const visibleHub = loadedFor.startsWith(`${user?.id}:`) ? hub : null;
  const entries =
    visibleHub?.entries ??
    [...(drafts?.values() ?? [])].map((draft) => ({
      lesson: draft.lesson,
      progress: null,
    }));
  const canShowLessons = visibleHub !== null || entries.length > 0;

  if (loadedFor === loadKey && loadError && !drafts?.size) {
    return (
      <ContentState>
        <PageLoadError
          title="Lessons unavailable"
          message={loadError}
          onRetry={() => setLoadRevision((revision) => revision + 1)}
        />
      </ContentState>
    );
  }

  return (
    <ContentState>
      {!canShowLessons ? (
        <LoadingState variant="page" message="Loading your lesson path…" />
      ) : (
        <div className="standard-page lesson-hub page-enter">
          <BackLink label="Back to home" />
          <>
            <section className="lesson-hub__header">
              <div>
                <h1>{(visibleHub?.section ?? catalogShell.sections[0]).title}</h1>
                <p>
                  {(visibleHub?.unit ?? catalogShell.units[0]).title} ·{' '}
                  {(visibleHub?.unit ?? catalogShell.units[0]).description}
                </p>
              </div>
              <div className="lesson-hub__tools">
                {visibleHub && (
                  <p className="lesson-hub__xp">
                    <strong>{totalXp}</strong> XP from best results
                  </p>
                )}
                <Link to="/lessons/almanac">Almanac</Link>
              </div>
            </section>
            {entries.length === 0 && (
              <section className="panel empty-state" aria-labelledby="empty-lessons-title">
                <h2 id="empty-lessons-title">No lessons are currently available</h2>
                <p>Your saved progress remains available when lessons return.</p>
              </section>
            )}
            <ol className="lesson-path" aria-label="Lesson sequence">
              {entries.map(({ lesson, progress }, index) => {
                const local = drafts?.get(lesson.id);
                const pending = local?.pendingCompletion;
                const result = local?.attempt.status === 'completed' ? local.attempt : null;
                const displayStatus = progress
                  ? resolveLessonDisplayStatus(progress)
                  : 'in-progress';
                const destination =
                  lesson.contentStatus === 'preview'
                    ? `/lessons/${lesson.id}/preview`
                    : `/lessons/${lesson.id}`;
                const body = (
                  <article className={`lesson-node lesson-node--${displayStatus}`}>
                    <div className="lesson-node__marker" aria-hidden="true">
                      {progress?.status === 'locked'
                        ? '⌁'
                        : !pending && (result?.cleared || progress?.status === 'cleared')
                          ? '✓'
                          : index + 1}
                    </div>
                    <div className="lesson-node__content">
                      <div className="lesson-node__title-line">
                        <span>Lesson {index + 1}</span>
                        {pending ? (
                          <span role="status">Results pending sync</span>
                        ) : result ? (
                          <span>{result.cleared ? 'Cleared' : 'Needs retry'}</span>
                        ) : progress ? (
                          <LessonStatusBadge progress={progress} />
                        ) : (
                          <span>In progress</span>
                        )}
                      </div>
                      <h2>{lesson.title}</h2>
                      <p>{lesson.shortDescription}</p>
                      {pending ? (
                        <p>
                          Your attempt is saved on this device. Connect to the internet for official
                          results.
                        </p>
                      ) : result ? (
                        <div className="lesson-node__metrics">
                          <StarRating count={result.starCount ?? 0} />
                          <span>Score {result.finalScore}%</span>
                          <span>{result.xpImprovement} XP earned</span>
                        </div>
                      ) : progress && progress.attemptCount > 0 ? (
                        <div className="lesson-node__metrics">
                          <StarRating count={progress.bestStarCount} />
                          <span>Best score {progress.bestScore}%</span>
                          <span>
                            {progress.attemptCount}{' '}
                            {progress.attemptCount === 1 ? 'attempt' : 'attempts'}
                          </span>
                        </div>
                      ) : progress?.status === 'locked' || lesson.contentStatus === 'preview' ? (
                        <span className="lesson-node__not-started">
                          {progress?.status === 'locked'
                            ? 'Clear Lesson 1 to unlock'
                            : 'Lesson preview'}
                        </span>
                      ) : null}
                      {progress?.status !== 'locked' && (
                        <span className="lesson-node__action">
                          {pending
                            ? 'View saved attempt'
                            : result
                              ? 'View Results'
                              : lesson.contentStatus === 'preview'
                                ? 'View lesson'
                                : displayStatus === 'in-progress'
                                  ? 'Resume lesson'
                                  : displayStatus === 'cleared'
                                    ? 'Review lesson'
                                    : displayStatus === 'needs-retry'
                                      ? 'Try lesson again'
                                      : 'Start lesson'}
                          <span aria-hidden="true">→</span>
                        </span>
                      )}
                    </div>
                  </article>
                );
                return progress?.status === 'locked' ? (
                  <li key={lesson.id}>{body}</li>
                ) : (
                  <li key={lesson.id}>
                    <Link to={result ? `/lessons/${lesson.id}/result/${result.id}` : destination}>
                      {body}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </>
        </div>
      )}
    </ContentState>
  );
}
