import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from '@/components/ui/BackLink';
import { Panel } from '@/components/ui/Panel';
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
        <BackLink />
        {!hub ? (
          <p>Loading your lesson path…</p>
        ) : (
          <>
            <section className="lesson-hub__header">
              <div>
                <p className="eyebrow">Section 1 · Unit 1</p>
                <h1>{hub.section.title}</h1>
                <p>
                  {hub.unit.title} · {hub.unit.description}
                </p>
              </div>
              <Panel className="xp-card" accent="yellow">
                <span>Total learning XP</span>
                <strong>{totalXp}</strong>
                <small>Best results only</small>
              </Panel>
            </section>
            <div className="lesson-path" aria-label="Lesson sequence">
              {hub.entries.map(({ lesson, progress }, index) => {
                const destination =
                  lesson.contentStatus === 'preview'
                    ? `/lessons/${lesson.id}/preview`
                    : `/lessons/${lesson.id}`;
                const body = (
                  <article className={`lesson-node lesson-node--${progress.status}`}>
                    <span className="lesson-node__order">{String(index + 1).padStart(2, '0')}</span>
                    <div className="lesson-node__marker" aria-hidden="true">
                      {progress.status === 'locked'
                        ? '⌁'
                        : progress.status === 'cleared'
                          ? '✓'
                          : '→'}
                    </div>
                    <div className="lesson-node__content">
                      <LessonStatusBadge status={progress.status} />
                      <p className="eyebrow">Lesson {index + 1}</p>
                      <h2>{lesson.title}</h2>
                      <p>{lesson.shortDescription}</p>
                      <div className="lesson-node__metrics">
                        <StarRating count={progress.bestStarCount} />
                        <span>Best {progress.bestScore}%</span>
                        <span>
                          {progress.attemptCount}{' '}
                          {progress.attemptCount === 1 ? 'attempt' : 'attempts'}
                        </span>
                      </div>
                      <span className="lesson-node__action">
                        {progress.status === 'locked'
                          ? 'Clear Lesson 1 to unlock'
                          : lesson.contentStatus === 'preview'
                            ? 'View preview →'
                            : progress.status === 'in-progress'
                              ? 'Resume lesson →'
                              : progress.status === 'cleared'
                                ? 'Review or retry →'
                                : 'Open lesson →'}
                      </span>
                    </div>
                  </article>
                );
                return progress.status === 'locked' ? (
                  <div key={lesson.id}>{body}</div>
                ) : (
                  <Link key={lesson.id} to={destination}>
                    {body}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </ContentState>
  );
}
