import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from '@/components/ui/BackLink';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { ContentState } from './components/ContentState';
import { LessonStatusBadge } from './components/LessonStatusBadge';
import { StarRating } from './components/StarRating';
import { getLessonHubData, getTotalXp, type LessonHubData } from './progress/progress.service';

export function LessonsPage() {
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const [hub, setHub] = useState<LessonHubData | null>(null);
  const [totalXp, setTotalXp] = useState(0);

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    void Promise.all([getLessonHubData(db, user.id), getTotalXp(db, user.id)]).then(
      ([data, xp]) => {
        setHub(data);
        setTotalXp(xp);
      },
    );
  }, [contentStatus, user]);

  return (
    <ContentState>
      <div className="standard-page lesson-hub page-enter">
        <BackLink label="Back to home" />
        {!hub ? (
          <p>Loading your lesson path…</p>
        ) : (
          <>
            <section className="lesson-hub__header">
              <div>
                <h1>{hub.section.title}</h1>
                <p>
                  {hub.unit.title} · {hub.unit.description}
                </p>
              </div>
              <div className="lesson-hub__tools">
                <p className="lesson-hub__xp">
                  <strong>{totalXp}</strong> XP from best results
                </p>
                <Link to="/lessons/almanac">Almanac</Link>
              </div>
            </section>
            <ol className="lesson-path" aria-label="Lesson sequence">
              {hub.entries.map(({ lesson, progress }, index) => {
                const destination =
                  lesson.contentStatus === 'preview'
                    ? `/lessons/${lesson.id}/preview`
                    : `/lessons/${lesson.id}`;
                const body = (
                  <article className={`lesson-node lesson-node--${progress.status}`}>
                    <div className="lesson-node__marker" aria-hidden="true">
                      {progress.status === 'locked'
                        ? '⌁'
                        : progress.status === 'cleared'
                          ? '✓'
                          : index + 1}
                    </div>
                    <div className="lesson-node__content">
                      <div className="lesson-node__title-line">
                        <span>Lesson {index + 1}</span>
                        <LessonStatusBadge status={progress.status} />
                      </div>
                      <h2>{lesson.title}</h2>
                      <p>{lesson.shortDescription}</p>
                      {progress.attemptCount > 0 ? (
                        <div className="lesson-node__metrics">
                          <StarRating count={progress.bestStarCount} />
                          <span>Best score {progress.bestScore}%</span>
                          <span>
                            {progress.attemptCount}{' '}
                            {progress.attemptCount === 1 ? 'attempt' : 'attempts'}
                          </span>
                        </div>
                      ) : progress.status === 'locked' || lesson.contentStatus === 'preview' ? (
                        <span className="lesson-node__not-started">
                          {progress.status === 'locked'
                            ? 'Clear Lesson 1 to unlock'
                            : 'Lesson preview'}
                        </span>
                      ) : null}
                      {progress.status !== 'locked' && (
                        <span className="lesson-node__action">
                          {lesson.contentStatus === 'preview'
                            ? 'View lesson'
                            : progress.status === 'in-progress'
                              ? 'Resume lesson'
                              : progress.status === 'cleared'
                                ? 'Review lesson'
                                : 'Start lesson'}
                          <span aria-hidden="true">→</span>
                        </span>
                      )}
                    </div>
                  </article>
                );
                return progress.status === 'locked' ? (
                  <li key={lesson.id}>{body}</li>
                ) : (
                  <li key={lesson.id}>
                    <Link to={destination}>{body}</Link>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </ContentState>
  );
}
