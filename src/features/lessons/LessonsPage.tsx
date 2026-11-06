import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { BackLink } from '@/components/ui/BackLink';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageLoadError } from '@/components/ui/PageLoadError';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { ContentState } from './components/ContentState';
import { resolveChapterDisplayStatuses } from './components/chapter-display-status';
import { LessonStatusBadge } from './components/LessonStatusBadge';
import { resolveLessonDisplayStatus } from './components/lesson-display-status';
import { StarRating } from './components/StarRating';
import { getLessonHubData, getTotalXp, type LessonHubData } from './progress/progress.service';
import { useLessonDrafts } from './attempts/useLessonDrafts';
import { catalogShell } from './content/catalog-shell';
import { lessonChapters } from './domain/lesson-flow';

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
  const [collapsedChapterLessons, setCollapsedChapterLessons] = useState<Set<string>>(() => new Set());
  const loadKey = `${user?.id ?? 'guest'}:${loadRevision}`;

  useEffect(() => {
    const refresh = () => setLoadRevision((revision) => revision + 1);
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, []);

  useEffect(() => {
    if (!user || contentStatus !== 'ready' || !navigator.onLine) return;
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
    return () => { active = false; };
  }, [contentStatus, loadKey, user, completedKey]);

  const visibleHub = loadedFor.startsWith(`${user?.id}:`) ? hub : null;
  const entries = visibleHub?.entries ?? (!navigator.onLine
    ? [...(drafts?.values() ?? [])].map((draft) => ({ lesson: draft.lesson, progress: null }))
    : []);
  const canShowLessons = visibleHub !== null || entries.length > 0;

  if (loadedFor === loadKey && loadError && (navigator.onLine || !drafts?.size)) {
    return <ContentState><PageLoadError title="Lessons unavailable" message={loadError} onRetry={() => setLoadRevision((revision) => revision + 1)} /></ContentState>;
  }

  return (
    <ContentState>
      {!canShowLessons ? <LoadingState variant="page" message="Loading your lesson path…" /> : (
        <div className="standard-page lesson-hub page-enter">
          <BackLink label="Back to home" />
          <section className="lesson-hub__header">
            <div>
              <h1>{(visibleHub?.section ?? catalogShell.sections[0]).title}</h1>
              <p>{(visibleHub?.unit ?? catalogShell.units[0]).title} · {(visibleHub?.unit ?? catalogShell.units[0]).description}</p>
            </div>
            <div className="lesson-hub__tools">
              {visibleHub && <p className="lesson-hub__xp"><strong>{totalXp}</strong> XP from best results</p>}
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
                ? resolveLessonDisplayStatus(progress, local?.attempt.status === 'active')
                : 'in-progress';
              const destination = lesson.contentStatus === 'preview' ? `/lessons/${lesson.id}/preview` : `/lessons/${lesson.id}`;
              const chapters = lessonChapters(lesson);
              const chapterStatuses = resolveChapterDisplayStatuses(lesson, progress, local?.attempt);
              const showChapters = lesson.contentStatus !== 'preview' && chapters.length > 0;
              const chaptersExpanded = !collapsedChapterLessons.has(lesson.id);
              const lessonStatus = pending ? 'pending' : result ? (result.cleared ? 'cleared' : 'needs-retry') : displayStatus;
              const node = (
                <article className={`lesson-node lesson-node--${displayStatus}`}>
                  <Link
                    className="lesson-node__link"
                    to={destination}
                    aria-disabled={progress?.status === 'locked' || undefined}
                    tabIndex={progress?.status === 'locked' ? -1 : undefined}
                    onClick={progress?.status === 'locked' ? (event) => event.preventDefault() : undefined}
                  >
                    <div className="lesson-node__marker" aria-hidden="true">
                      {progress?.status === 'locked' ? '⌁' : !pending && (result?.cleared || progress?.status === 'cleared') ? '✓' : index + 1}
                    </div>
                    <div className="lesson-node__content">
                      <div className="lesson-node__title-line">
                        <span>Lesson {index + 1}</span>
                        <span className={`lesson-node__status-label lesson-node__status-label--${lessonStatus}`} role={pending ? 'status' : undefined}>
                          {pending ? 'Results pending sync' : result ? (result.cleared ? 'Cleared' : 'Needs retry') : progress ? <LessonStatusBadge progress={progress} /> : 'In progress'}
                        </span>
                      </div>
                      <h2>{lesson.title}</h2>
                      <p>{lesson.shortDescription}</p>
                      {pending ? <p>Your attempt is saved on this device. Connect to the internet for official results.</p> : result ? (
                        <div className="lesson-node__metrics"><StarRating count={result.starCount ?? 0} /><span>Score {result.finalScore}%</span><span>{result.xpImprovement} XP earned</span></div>
                      ) : progress && progress.attemptCount > 0 ? (
                        <div className="lesson-node__metrics"><StarRating count={progress.bestStarCount} /><span>Best score {progress.bestScore}%</span><span>{progress.attemptCount} {progress.attemptCount === 1 ? 'attempt' : 'attempts'}</span></div>
                      ) : progress?.status === 'locked' || lesson.contentStatus === 'preview' ? (
                        <span className="lesson-node__not-started">{progress?.status === 'locked' ? 'Clear Lesson 1 to unlock' : 'Lesson preview'}</span>
                      ) : null}
                      {progress?.status !== 'locked' && (
                        <span className="lesson-node__action">
                          {pending ? 'View saved attempt' : result ? 'Lesson overview' : lesson.contentStatus === 'preview' ? 'View lesson' : displayStatus === 'in-progress' ? 'Resume lesson' : displayStatus === 'cleared' ? 'Review lesson' : displayStatus === 'needs-retry' ? 'Try lesson again' : 'Start lesson'}
                          <span aria-hidden="true">→</span>
                        </span>
                      )}
                    </div>
                  </Link>
                  {showChapters && (
                    <div className="lesson-node__chapters">
                      <button
                        className="lesson-node__chapters-toggle"
                        type="button"
                        aria-label={`${chaptersExpanded ? 'Hide' : 'Show'} chapters for ${lesson.title}`}
                        aria-expanded={chaptersExpanded}
                        title={`${chaptersExpanded ? 'Hide' : 'Show'} chapters`}
                        onClick={() => setCollapsedChapterLessons((current) => {
                          const next = new Set(current);
                          if (next.has(lesson.id)) next.delete(lesson.id);
                          else next.add(lesson.id);
                          return next;
                        })}
                      >
                        {chaptersExpanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                        <span>Chapters</span>
                      </button>
                      {chaptersExpanded && (
                        <ol aria-label={`${lesson.title} chapters`}>
                          {chapters.map((chapter, chapterIndex) => {
                            const status = chapterStatuses[chapterIndex];
                            return (
                              <li key={chapter.id} className={`lesson-chapter lesson-chapter--${status}`}>
                                <span className="lesson-chapter__marker" aria-hidden="true">{status === 'completed' ? '✓' : chapterIndex + 1}</span>
                                <div>
                                  <div className="lesson-chapter__title-line">
                                    <span className="lesson-chapter__number">Chapter {chapterIndex + 1}</span>
                                    <span className="lesson-chapter__status">{status === 'completed' ? 'Completed' : status === 'in-progress' ? 'In progress' : status === 'locked' ? 'Locked' : 'Not started'}</span>
                                  </div>
                                  <strong>{chapter.title}</strong>
                                </div>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  )}
                </article>
              );
              return <li key={lesson.id}>{node}</li>;
            })}
          </ol>
        </div>
      )}
    </ContentState>
  );
}
