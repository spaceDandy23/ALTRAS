import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/auth.store';

const { publishedLanding } = vi.hoisted(() => ({ publishedLanding: {
  heroHeading: 'Math is a language.', heroEmphasis: 'Learn to translate it.', heroDescription: 'Description',
  aboutTitle: 'About ALTRAS', aboutDescription: 'About', closingHeading: 'Start',
  learnHeading: 'Learn', learnDescription: 'Teaching', practiceHeading: 'Practice', practiceDescription: 'Activity', progressHeading: 'Progress', progressDescription: 'Results',
  understandImagePath: 'landing/understand/example.webp', understandImageAlt: 'A chapter teaching screen',
  applyImagePath: null, applyImageAlt: '', reflectImagePath: null, reflectImageAlt: '',
} }));

vi.mock('@/features/public-content/public-content.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/public-content/public-content.service')>();
  return { ...actual, getPublishedContent: vi.fn().mockResolvedValue(publishedLanding), getPublishedShowcaseImageUrl: vi.fn(() => 'https://images.example/showcase') };
});

import { LandingPage } from './PublicPages';

describe('landing gameplay showcase', () => {
  afterEach(() => useAuthStore.setState({ status: 'guest', user: null }));

  it('opens a published screenshot in an accessible dialog and closes it with Escape', async () => {
    render(<MemoryRouter><LandingPage /></MemoryRouter>);
    const opener = await screen.findByRole('button', { name: 'Open Understand screenshot' });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Expanded gameplay screenshot' });
    expect(dialog).toBeInTheDocument();
    expect(dialog.querySelector('img')).toHaveAccessibleName('A chapter teaching screen');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
