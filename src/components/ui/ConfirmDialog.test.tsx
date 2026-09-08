import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

function DialogHarness({ onConfirm = vi.fn() }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open confirmation</button>
      <ConfirmDialog
        open={open}
        title="Delete progress?"
        confirmLabel="Delete"
        onCancel={() => setOpen(false)}
        onConfirm={onConfirm}
      >
        This action cannot be undone.
      </ConfirmDialog>
    </>
  );
}

describe('ConfirmDialog accessibility', () => {
  it('starts on Cancel, traps focus, closes on Escape, and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open confirmation' });
    await user.click(trigger);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(screen.getByRole('alertdialog').parentElement).toHaveClass('modal-backdrop');
    expect(screen.getByRole('alertdialog').parentElement?.parentElement).toBe(document.body);
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
