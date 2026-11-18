import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import type { ReferenceEntry } from '@/features/lessons/domain/content.schemas';
import { listMathWordEntries, saveMathWordEntries } from '@/features/word-list/word-list.service';
import { AdminContentLoading } from './AdminContentLoading';
import { AdminFeedbackToast } from './AdminFeedbackToast';
import { AdminPageHeader } from './AdminPageHeader';
import { ReferenceRowsEditor } from './ReferenceRowsEditor';

export function MathWordListManagementPage() {
  const [rows, setRows] = useState<ReferenceEntry[] | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void listMathWordEntries().then(setRows).catch(() => setMessage('Unable to load the Math Word List.'));
  }, []);
  if (!rows)
    return message ? (
      <section className="admin-state panel">
        <AdminPageHeader title="Math Word List unavailable" description={message} />
      </section>
    ) : (
      <AdminContentLoading message="Loading Math Word List…" />
    );
  const save = async () => {
    setSaving(true);
    setMessage('');
    try {
      setRows(await saveMathWordEntries(rows));
      setMessage('Math Word List saved.');
    } catch {
      setMessage('Unable to save the Math Word List.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <AdminPageHeader
        title="Math Word List"
        description="Edit the global reference shown in the student Almanac."
      />
      <section className="admin-panel admin-reference-page" aria-label="Math Word List editor">
        <ReferenceRowsEditor rows={rows} onChange={setRows} searchable />
        <div className="admin-actions">
          <Button variant="secondary" type="button" disabled={saving} onClick={() => void save()}>
            Save Math Word List
          </Button>
        </div>
      </section>
      {message && (
        <AdminFeedbackToast
          kind={message.startsWith('Unable') ? 'error' : 'success'}
          message={message}
          onDismiss={() => setMessage('')}
        />
      )}
    </>
  );
}
