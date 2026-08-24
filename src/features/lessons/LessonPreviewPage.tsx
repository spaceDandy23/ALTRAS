import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BackLink } from '@/components/ui/BackLink';
import { Panel } from '@/components/ui/Panel';
import { db } from '@/db/database';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import type { LearningLesson } from './domain/content.schemas';
import type { LessonProgress } from '@/types/learning';
import { getLesson } from './content/content.service';
import { getLessonProgress } from './progress/progress.service';
import { ContentState } from './components/ContentState';

export function LessonPreviewPage() {
  const { lessonId = '' } = useParams();
  const user = useAuthStore((state) => state.user);
  const contentStatus = useContentStore((state) => state.status);
  const [lesson, setLesson] = useState<LearningLesson | null>(null);
  const [progress, setProgress] = useState<LessonProgress | null>(null);

  useEffect(() => {
    if (!user || contentStatus !== 'ready') return;
    void Promise.all([getLesson(db, lessonId), getLessonProgress(db, user.id, lessonId)]).then(
      ([loadedLesson, loadedProgress]) => {
        setLesson(loadedLesson);
        setProgress(loadedProgress);
      },
    );
  }, [contentStatus, lessonId, user]);

  return (
    <ContentState>
      <div className="standard-page preview-page page-enter">
        <BackLink to="/lessons" />
        {!lesson || !progress ? (
          <p>Opening preview…</p>
        ) : (
          <Panel className="preview-board" accent={progress.status === 'locked' ? 'red' : 'blue'}>
            <span className="preview-board__symbol" aria-hidden="true">
              {progress.status === 'locked' ? '⌁' : '→'}
            </span>
            <p className="eyebrow">
              Lesson 2 · {progress.status === 'locked' ? 'Locked' : 'Unlocked preview'}
            </p>
            <h1>{lesson.title}</h1>
            <p>{lesson.shortDescription}</p>
            <div className="concept-list">
              {lesson.concepts.map((concept) => (
                <span key={concept}>{concept}</span>
              ))}
            </div>
            <p className="preview-board__note">
              {progress.status === 'locked'
                ? 'Clear “Words That Signal Operations” to unlock this preview.'
                : 'You unlocked this lesson. Its full activities will be added in the next learning release.'}
            </p>
          </Panel>
        )}
      </div>
    </ContentState>
  );
}
