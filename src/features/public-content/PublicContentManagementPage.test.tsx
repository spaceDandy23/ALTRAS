import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PublicContentManagementPage } from './PublicContentManagementPage';
import * as service from './public-content.service';

vi.mock('./public-content.service', async () => {
  const actual = await vi.importActual<typeof import('./public-content.service')>('./public-content.service');
  return { ...actual, listContentPages: vi.fn(), saveContentDraft: vi.fn(), publishContent: vi.fn() };
});

const page = {
  pageKey: 'landing' as const,
  draftContent: {
    heroHeading: 'Math is a language.', heroEmphasis: 'Learn to translate it.', heroDescription: 'Learn algebra.',
    aboutTitle: 'About ALTRAS', aboutDescription: 'A research project.', closingHeading: 'Start learning.',
    learnHeading: 'Learn', learnDescription: 'Learn algebra.', practiceHeading: 'Practice', practiceDescription: 'Practice algebra.', progressHeading: 'Progress', progressDescription: 'Track progress.',
  },
  publishedContent: null,
  revision: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  publishedAt: null,
};

describe('PublicContentManagementPage', () => {
  it('uses the shared centered admin loader before content arrives', () => {
    vi.mocked(service.listContentPages).mockReturnValue(new Promise(() => undefined));
    render(<PublicContentManagementPage />);
    expect(screen.getByRole('status')).toHaveClass('loading-state--page', 'admin-content-loading');
    expect(screen.getByRole('status')).toHaveTextContent('Loading content…');
  });

  it('edits a draft and publishes the approved version', async () => {
    vi.mocked(service.listContentPages).mockResolvedValue([page]);
    vi.mocked(service.saveContentDraft).mockResolvedValue({ ...page, revision: 2 });
    vi.mocked(service.publishContent).mockResolvedValue({ ...page, revision: 3, publishedContent: page.draftContent, publishedAt: '2026-01-02T00:00:00.000Z' });
    const user = userEvent.setup();
    render(<PublicContentManagementPage />);
    const heading = await screen.findByLabelText('Hero heading');
    await user.clear(heading);
    await user.type(heading, 'New heading');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(service.saveContentDraft).toHaveBeenCalledWith('landing', expect.objectContaining({ heroHeading: 'New heading' }), 1));
    await user.click(screen.getByRole('button', { name: 'Publish approved content' }));
    await waitFor(() => expect(service.publishContent).toHaveBeenCalledWith('landing', 2));
    expect(screen.getByText('Published content is now available publicly.')).toBeInTheDocument();
  });
});
