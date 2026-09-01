import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LessonsPage } from '@/features/lessons/LessonsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { useAuthStore } from '@/stores/auth.store';
import { useContentStore } from '@/stores/content.store';

vi.mock('@/features/lessons/progress/progress.service', () => ({
  getLessonHubData: vi.fn(() => new Promise(() => undefined)),
  getTotalXp: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock('@/features/settings/settings.service', () => ({
  getUserSettings: vi.fn(() => new Promise(() => undefined)),
  updateUserSettings: vi.fn(),
}));

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  normalizedUsername: 'loading_student',
  displayName: 'Loading Student',
  createdAt: 1,
  lastLoginAt: 1,
};

describe('page-level loading audit', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'authenticated', user });
    useContentStore.setState({ status: 'ready', error: null });
  });

  it('centers the Lessons data loader in the available page area', () => {
    render(
      <MemoryRouter>
        <LessonsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveClass('loading-state--page');
    expect(screen.getByRole('status')).toHaveTextContent('Loading your lesson path…');
  });

  it('centers the Settings data loader in the available page area', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveClass('loading-state--page');
    expect(screen.getByRole('status')).toHaveTextContent('Loading settings…');
  });

  it('keeps every audited route loader on an explicit page-level variant', () => {
    const routeFiles = [
      'src/features/menu/MainMenuPage.tsx',
      'src/features/lessons/LessonsPage.tsx',
      'src/features/lessons/LessonOverviewPage.tsx',
      'src/features/lessons/ActiveLessonPage.tsx',
      'src/features/lessons/LessonResultPage.tsx',
      'src/features/lessons/components/ContentState.tsx',
      'src/features/settings/SettingsPage.tsx',
      'src/features/assessments/AssessmentPage.tsx',
      'src/features/researcher/ResearcherResultsPage.tsx',
      'src/features/researcher/ResearcherRoute.tsx',
    ];

    for (const routeFile of routeFiles) {
      const source = readFileSync(resolve(process.cwd(), routeFile), 'utf8');
      const loadingUsages = source.match(/<LoadingState[\s\S]*?\/>/g) ?? [];
      expect(loadingUsages.length, routeFile).toBeGreaterThan(0);
      for (const usage of loadingUsages) expect(usage, routeFile).toContain('variant="page"');
    }
  });
});
