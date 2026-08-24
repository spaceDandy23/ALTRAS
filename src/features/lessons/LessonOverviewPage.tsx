import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/BackLink';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Panel } from '@/components/ui/Panel';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LearningLesson } from './domain/content.schemas';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { getLesson } from './content/content.service';
import { getLessonProgress } from './progress/progress.service';
import { getActiveAttempt, restartAttempt, startOrResumeAttempt } from './attempts/attempt.service';
import { StarRating } from './components/StarRating';
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
        <BackLink to="/lessons" />
        {!lesson || !progress ? (
          <p>Opening lesson…</p>
        ) : (
          <>
            <section className="lesson-overview__hero">
              <div>
                <p className="eyebrow">Section 1 · Unit 1</p>
                <h1>{lesson.title}</h1>
                <p>{lesson.shortDescription}</p>
                <div className="concept-list">
                  {lesson.concepts.map((concept) => (
                    <span key={concept}>{concept}</span>
                  ))}
                </div>
              </div>
              <Panel className="lesson-summary" accent="yellow">
                <div>
                  <span>Activities</span>
                  <strong>{lesson.activities.length}</strong>
                </div>
                <div>
                  <span>Passing score</span>
                  <strong>{lesson.passingThreshold}%</strong>
                </div>
                <div>
                  <span>Best result</span>
                  <strong>{progress.bestScore}%</strong>
                </div>
                <StarRating count={progress.bestStarCount} />
                <Button fullWidth onClick={() => void begin()}>
                  {active
                    ? 'Resume lesson'
                    : progress.attemptCount > 0
                      ? 'Try again'
                      : 'Start lesson'}
                </Button>
                {active && (
                  <Button fullWidth variant="quiet" onClick={() => setConfirmRestart(true)}>
                    Restart from the beginning
                  </Button>
                )}
              </Panel>
            </section>
            <section className="instruction-section">
              <div className="section-heading">
                <p className="eyebrow">Before you play</p>
                <h2>Read the board</h2>
              </div>
              <div className="instruction-grid">
                {lesson.instructionalContent.map((block) =>
                  block.type === 'example' ? (
                    <Panel className="instruction-card instruction-card--example" key={block.id}>
                      <span>{block.phrase}</span>
                      <strong>{block.expression}</strong>
                      <p>{block.note}</p>
                    </Panel>
                  ) : (
                    <Panel
                      className={`instruction-card instruction-card--${block.type}`}
                      key={block.id}
                    >
                      <h3>{block.title}</h3>
                      <p>{block.body}</p>
                    </Panel>
                  ),
                )}
              </div>
            </section>
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
