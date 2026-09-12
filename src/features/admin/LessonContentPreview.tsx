import { useState } from 'react';
import { FindWordActivityView } from '@/features/lessons/activities/FindWordActivityView';
import { OrganizeTranslateActivityView } from '@/features/lessons/activities/OrganizeTranslateActivityView';
import { evaluateActivity } from '@/features/lessons/domain/evaluation';
import type { SubmittedActivityAnswer } from '@/types/learning';
import { publishableLessonSchema, type AuthoredLesson } from './lesson-management.service';

export function LessonContentPreview({ lesson }: { lesson: AuthoredLesson }) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<SubmittedActivityAnswer>();
  const result = publishableLessonSchema.safeParse(lesson);
  if (!result.success)
    return (
      <p role="alert">
        Complete lesson configuration before previewing: {result.error.issues[0]?.message}
      </p>
    );
  const activity = lesson.activities[index];
  const submit = async (value: string | string[]) => {
    setAnswer({
      activityId: activity.id,
      activityType: activity.type,
      answer: value,
      isCorrect: evaluateActivity(activity, value),
      submittedAt: Date.now(),
    });
  };
  return (
    <section className="admin-preview" aria-label="Lesson preview">
      <h2>{lesson.title}</h2>
      <p>Preview only — no attempts, progress, XP or streaks are recorded.</p>
      <p>{lesson.shortDescription}</p>
      {lesson.instructionalContent.map((block) => (
        <article key={block.id}>
          <h3>{block.type === 'example' ? block.phrase : block.title}</h3>
          <p>{block.type === 'example' ? `${block.expression} — ${block.note}` : block.body}</p>
        </article>
      ))}
      {activity.type === 'find-word' ? (
        <FindWordActivityView
          key={activity.id}
          activity={activity}
          submitted={answer}
          onSubmit={submit}
        />
      ) : (
        <OrganizeTranslateActivityView
          key={activity.id}
          activity={activity}
          submitted={answer}
          onSubmit={submit}
        />
      )}
      {answer && (
        <p role="status">
          {answer.isCorrect ? 'Correct.' : 'Not quite.'} {activity.explanation.body}
        </p>
      )}
      <div className="admin-actions">
        <button
          className="button button--quiet"
          disabled={index === 0}
          onClick={() => {
            setIndex(index - 1);
            setAnswer(undefined);
          }}
        >
          Previous activity
        </button>
        <span>
          Activity {index + 1} of {lesson.activities.length}
        </span>
        <button
          className="button button--quiet"
          disabled={index === lesson.activities.length - 1}
          onClick={() => {
            setIndex(index + 1);
            setAnswer(undefined);
          }}
        >
          Next activity
        </button>
      </div>
    </section>
  );
}
