import { Navigate, useParams } from 'react-router-dom';

export function LessonPreviewPage() {
  const { lessonId = '' } = useParams();
  return <Navigate to={`/lessons/${lessonId}`} replace />;
}
