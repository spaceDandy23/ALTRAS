import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';
import { useResearcherAccessStore } from '@/stores/researcher-access.store';

vi.mock('@/services/audio/audio.manager', () => ({
  getAudioMuted: vi.fn(() => false),
  playMusic: vi.fn(),
  playSfx: vi.fn(),
  setAudioMuted: vi.fn(),
  stopMusic: vi.fn(),
}));
vi.mock('@/features/lessons/components/GlobalLessonSyncStatus', () => ({
  GlobalLessonSyncStatus: () => null,
}));

import { AppShell } from './AppShell';

function renderShell(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<p>Student home</p>} />
          <Route path="lessons" element={<p>Lesson hub</p>} />
          <Route path="lessons/almanac" element={<p>Almanac</p>} />
          <Route path="profile" element={<p>Profile</p>} />
          <Route path="settings" element={<p>Settings</p>} />
          <Route path="lessons/:lessonId/play/:attemptId" element={<p>Active lesson</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('student shell Home navigation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'guest', user: null });
    useResearcherAccessStore.setState({ status: 'idle', userId: null });
  });

  it('provides a direct Home action on ordinary student pages', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: '10000000-0000-4000-8000-000000000001',
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useResearcherAccessStore.setState({
      status: 'denied',
      userId: '10000000-0000-4000-8000-000000000001',
    });
    renderShell('/lessons');

    await userEvent.setup().click(screen.getByRole('link', { name: 'Home' }));

    expect(screen.getByText('Student home')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uses the student sidebar for navigation and marks the active destination', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: '10000000-0000-4000-8000-000000000001', normalizedUsername: 'student', displayName: 'Student', createdAt: 1, lastLoginAt: 1 },
    });
    useResearcherAccessStore.setState({ status: 'denied', userId: '10000000-0000-4000-8000-000000000001' });
    renderShell('/lessons');

    const sidebar = screen.getByRole('complementary', { name: 'Student navigation' });
    expect(sidebar).toContainElement(screen.getByRole('link', { name: 'Home' }));
    expect(screen.getByRole('link', { name: 'Lessons' })).toHaveAttribute('aria-current', 'page');
    expect(sidebar).toContainElement(screen.getByRole('link', { name: 'Almanac' }));
    expect(sidebar).toContainElement(screen.getByRole('link', { name: 'Profile' }));
    expect(sidebar).toContainElement(screen.getByRole('link', { name: 'Settings' }));
    expect(sidebar).toContainElement(screen.getByRole('button', { name: 'Mute audio' }));
    expect(screen.getByRole('button', { name: 'Mute audio' })).toHaveAttribute('title', 'Mute audio');
    expect(screen.getByRole('button', { name: 'Mute audio' })).toHaveTextContent('Mute audio');
    expect(document.querySelector('.student-mobile-header .audio-mute-button')).not.toBeInTheDocument();
  });

  it('opens the responsive navigation drawer', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: '10000000-0000-4000-8000-000000000001', normalizedUsername: 'student', displayName: 'Student', createdAt: 1, lastLoginAt: 1 },
    });
    useResearcherAccessStore.setState({ status: 'denied', userId: '10000000-0000-4000-8000-000000000001' });
    renderShell('/lessons');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('dialog', { name: 'Student navigation' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close navigation' }));
    expect(screen.queryByRole('dialog', { name: 'Student navigation' })).not.toBeInTheDocument();
  });

  it('keeps the active-lesson leave confirmation before going Home', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: '10000000-0000-4000-8000-000000000001',
        normalizedUsername: 'student',
        displayName: 'Student',
        createdAt: 1,
        lastLoginAt: 1,
      },
    });
    useResearcherAccessStore.setState({
      status: 'denied',
      userId: '10000000-0000-4000-8000-000000000001',
    });
    const user = userEvent.setup();
    renderShell('/lessons/lesson-one/play/attempt-one');

    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(screen.getByRole('alertdialog', { name: 'Leave active lesson?' })).toBeInTheDocument();
    expect(screen.getByText('Active lesson')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go home' }));
    expect(screen.getByText('Student home')).toBeInTheDocument();
  });
});
