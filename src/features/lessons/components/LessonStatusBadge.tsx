import type { LessonProgress } from '@/types/learning';

const labels: Record<LessonProgress['status'], string> = {
  locked: 'Locked',
  available: 'Not started',
  'in-progress': 'In progress',
  cleared: 'Cleared',
};

export function LessonStatusBadge({ status }: { status: LessonProgress['status'] }) {
  return <span className={`lesson-status lesson-status--${status}`}>{labels[status]}</span>;
}
