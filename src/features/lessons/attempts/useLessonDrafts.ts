import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import { getUserLessonDrafts, type LessonDraft } from './lesson-draft.service';

// Observe durable pending work and server-confirmed results without creating a second queue.
export function useLessonDrafts(userId: string | undefined) {
  const [state, setState] = useState<{ userId: string; drafts: LessonDraft[] } | null>(null);
  useEffect(() => {
    if (!userId) return;
    const subscription = liveQuery(() => getUserLessonDrafts(userId)).subscribe({
      next: (drafts) => setState({ userId, drafts }),
      error: () => setState({ userId, drafts: [] }),
    });
    return () => subscription.unsubscribe();
  }, [userId]);
  return useMemo(() => {
    if (!state || state.userId !== userId) return undefined;
    const latest = new Map<string, LessonDraft>();
    for (const draft of state.drafts) {
      const previous = latest.get(draft.lessonId);
      if (
        !previous ||
        draft.attempt.startedAt > previous.attempt.startedAt ||
        (draft.attempt.startedAt === previous.attempt.startedAt &&
          draft.updatedAt > previous.updatedAt)
      ) {
        latest.set(draft.lessonId, draft);
      }
    }
    return latest;
  }, [state, userId]);
}
