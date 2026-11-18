import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminFeedbackToast } from './AdminFeedbackToast';
import { AdminPageHeader } from './AdminPageHeader';

describe('admin workspace chrome', () => {
  it('uses one labelled workspace header across management pages', () => {
    render(
      <AdminPageHeader
        id="math-word-list-title"
        title="Math Word List"
        description="Edit the global reference shown in the student Almanac."
      />,
    );

    expect(screen.getByText('Administrator workspace')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Math Word List' })).toHaveAttribute(
      'id',
      'math-word-list-title',
    );
  });

  it('uses the shared feedback treatment for success and errors', () => {
    const onDismiss = vi.fn();
    render(<AdminFeedbackToast kind="success" message="Draft saved." onDismiss={onDismiss} />);

    expect(screen.getByRole('status')).toHaveTextContent('Draft saved.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
