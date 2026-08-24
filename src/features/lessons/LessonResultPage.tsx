import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LearningLesson } from './domain/content.schemas';
import type { LessonAttempt, LessonProgress } from '@/types/learning';
import { getLesson } from './content/content.service';
import { getAttempt, startOrResumeAttempt } from './attempts/attempt.service';
import { getLessonProgress } from './progress/progress.service';
import { StarRating } from './components/StarRating';
import { ContentState } from './components/ContentState';

export function LessonResultPage() {
  const { lessonId = '', attemptId = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const navigate = useNavigate();
  const [lesson, setLesson] = useState<LearningLesson | null>(null);
  const [attempt, setAttempt] = useState<LessonAttempt | null>(null);
  const [progress, setProgress] = useState<LessonProgress | null>(null);

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    void Promise.all([
      getLesson(db, lessonId),
      getAttempt(db, user.id, attemptId),
      getLessonProgress(db, user.id, lessonId),
    ]).then(([loadedLesson, loadedAttempt, loadedProgress]) => {
      setLesson(loadedLesson);
      setAttempt(loadedAttempt);
      setProgress(loadedProgress);
    });
  }, [attemptId, contentStatus, lessonId, user]);

  if (!user || !lesson || !attempt || !progress || attempt.status !== 'completed') {
    return (
      <ContentState>
        {
          <div className="result-page">
            <p>Loading your result…</p>
          </div>
        }
      </ContentState>
    );
  }
  const retry = async () => {
    const next = await startOrResumeAttempt(db, user.id, lesson.id);
    navigate(`/lessons/${lesson.id}/play/${next.id}`);
  };
  const correct = attempt.answers.filter((answer) => answer.isCorrect).length;

  return (
    <ContentState>
      <div
        className={`result-page result-page--${attempt.cleared ? 'cleared' : 'failed'} page-enter`}
      >
        <Panel className="result-board" accent={attempt.cleared ? 'yellow' : 'red'}>
          <div className="result-board__mark" aria-hidden="true">
            {attempt.cleared ? '✓' : '↻'}
          </div>
          <p className="eyebrow">{attempt.cleared ? 'Lesson cleared' : 'Keep building'}</p>
          <h1>{attempt.cleared ? 'You translated the signals.' : 'One more pass can clear it.'}</h1>
          <p>
            {attempt.cleared
              ? 'The next lesson is now available.'
              : 'Review the operation words and watch order-sensitive phrases.'}
          </p>
          <div className="result-score">
            <strong>{attempt.finalScore}%</strong>
            <span>
              {correct} of {lesson.activities.length} correct
            </span>
          </div>
          <StarRating count={attempt.starCount ?? 0} />
          <div className="result-metrics">
            <div>
              <span>XP improvement</span>
              <strong>+{attempt.xpImprovement}</strong>
            </div>
            <div>
              <span>Best score</span>
              <strong>{progress.bestScore}%</strong>
            </div>
            <div>
              <span>Attempts</span>
              <strong>{progress.attemptCount}</strong>
            </div>
          </div>
          <div className="result-actions">
            <Link className="button button--quiet" to="/lessons">
              Lesson hub
            </Link>
            <Button onClick={() => void retry()}>
              {attempt.cleared ? 'Play again' : 'Retry lesson'}
            </Button>
          </div>
        </Panel>
      </div>
    </ContentState>
  );
}
