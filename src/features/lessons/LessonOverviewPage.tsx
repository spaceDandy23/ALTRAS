import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/BackLink';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingState } from '@/components/ui/LoadingState';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LearningLesson } from './domain/content.schemas';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { getLesson } from './content/content.service';
import { getLessonProgress } from './progress/progress.service';
import { getActiveAttempt, restartAttempt, startOrResumeAttempt } from './attempts/attempt.service';
import { ContentState } from './components/ContentState';

export function LessonOverviewPage() {
  const { lessonId = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<LearningLesson | null>(null);
  const [progress, setProgress] = useState<LessonProgress | null>(null);
  const [active, setActive] = useState<LessonAttempt | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    void Promise.all([
      getLesson(db, lessonId),
      getLessonProgress(db, user.id, lessonId),
      getActiveAttempt(db, user.id, lessonId),
    ]).then(([nextLesson, nextProgress, nextActive]) => {
      setLesson(nextLesson);
      setProgress(nextProgress);
      setActive(nextActive);
    });
  }, [contentStatus, lessonId, user]);

  if (!user) return null;
  const begin = async () => {
    if (progress?.status === 'locked') return;
    const attempt = await startOrResumeAttempt(db, user.id, lessonId);
    navigate(`/lessons/${lessonId}/play/${attempt.id}`);
  };
  const restart = async () => {
    const attempt = await restartAttempt(db, user.id, lessonId);
    navigate(`/lessons/${lessonId}/play/${attempt.id}`);
  };

  return (
    <ContentState>
      <div className="standard-page lesson-overview page-enter">
        <BackLink to="/lessons" label="Back to lessons" />
        {!lesson || !progress ? (
          <LoadingState message="Opening lesson…" />
        ) : (
          <>
            <section className="lesson-overview__hero">
              <div>
                <h1>{lesson.title}</h1>
                <p>{lesson.shortDescription}</p>
                <div className="lesson-overview__meta" aria-label="Lesson details">
                  <span>{lesson.activities.length} activities</span>
                  <span>{lesson.passingThreshold}% to pass</span>
                  {progress.attemptCount > 0 && <span>Best score {progress.bestScore}%</span>}
                </div>
                {progress.status === 'locked' ? (
                  <p className="lesson-overview__actions lesson-summary">
                    Clear Words That Signal Operations to unlock this lesson.
                  </p>
                ) : (
                  <div className="lesson-overview__actions lesson-summary">
                    <Button onClick={() => void begin()}>
                      {active
                        ? 'Resume lesson'
                        : progress.attemptCount > 0
                          ? 'Try again'
                          : 'Start lesson'}
                    </Button>
                    {active && (
                      <Button variant="quiet" onClick={() => setConfirmRestart(true)}>
                        Restart lesson
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="lesson-overview__equation" aria-hidden="true">
                <span className="lesson-overview__equation-label">words</span>
                <span className="lesson-overview__equation-arrow">→</span>
                <span className="lesson-overview__equation-label">math</span>
              </div>
            </section>
            {progress.status !== 'locked' && (
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
        )}
        <ConfirmDialog
          open={confirmRestart}
          title="Restart this lesson?"
          confirmLabel="Restart lesson"
          onCancel={() => setConfirmRestart(false)}
          onConfirm={() => void restart()}
        >
          Your current attempt will remain in local history, but its completed answers will not
          carry into the new attempt.
        </ConfirmDialog>
      </div>
    </ContentState>
  );
}
