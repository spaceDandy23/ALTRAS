import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { AssessmentPage } from '@/features/assessments/AssessmentPage';
import { LessonsPage } from '@/features/lessons/LessonsPage';
import { ActiveLessonPage } from '@/features/lessons/ActiveLessonPage';
import { LessonOverviewPage } from '@/features/lessons/LessonOverviewPage';
import { LessonPreviewPage } from '@/features/lessons/LessonPreviewPage';
import { LessonResultPage } from '@/features/lessons/LessonResultPage';
import { MainMenuPage } from '@/features/menu/MainMenuPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AlmanacPage, AlmanacReviewPlaceholder } from '@/features/word-list/AlmanacPage';
import { WordListPage } from '@/features/word-list/WordListPage';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';
import { AppShell } from './AppShell';
import { NotFoundPage } from './NotFoundPage';
import { GuestOnlyRoute, ProtectedRoute } from './route-guards';

export function App() {
  const initialize = useAuthStore((state) => state.initialize);
  const initializeContent = useContentStore((state) => state.initialize);
  useEffect(() => {
    void initialize();
    void initializeContent();
  }, [initialize, initializeContent]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnlyRoute>
              <LoginPage />
            </GuestOnlyRoute>
          }
        />
        <Route
          path="/register"
          element={
            <GuestOnlyRoute>
              <RegisterPage />
            </GuestOnlyRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<MainMenuPage />} />
          <Route path="assessments/:kind" element={<AssessmentPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="lessons" element={<LessonsPage />} />
          <Route path="lessons/almanac" element={<AlmanacPage />} />
          <Route path="lessons/almanac/word-list" element={<WordListPage />} />
          <Route path="lessons/almanac/review" element={<AlmanacReviewPlaceholder />} />
          <Route path="lessons/:lessonId" element={<LessonOverviewPage />} />
          <Route path="lessons/:lessonId/play/:attemptId" element={<ActiveLessonPage />} />
          <Route path="lessons/:lessonId/result/:attemptId" element={<LessonResultPage />} />
          <Route path="lessons/:lessonId/preview" element={<LessonPreviewPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
