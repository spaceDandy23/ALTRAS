import { useEffect, useState } from 'react';
import { LoadingState } from '@/components/ui/LoadingState';
import type { ReferenceEntry } from '@/features/lessons/domain/content.schemas';
import { listMathWordEntries, saveMathWordEntries } from '@/features/word-list/word-list.service';
import { ReferenceRowsEditor } from './ReferenceRowsEditor';

export function MathWordListManagementPage() {
  const [rows, setRows] = useState<ReferenceEntry[] | null>(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void listMathWordEntries().then(setRows).catch(() => setMessage('Unable to load the Math Word List.'));
  }, []);
  if (!rows) return message ? <p role="alert">{message}</p> : <LoadingState variant="page" />;
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
    <section className="admin-panel admin-reference-page">
      <header><span className="eyebrow">Administrator workspace</span><h1>Math Word List</h1><p>Edit the global reference shown in the student Almanac.</p></header>
      <ReferenceRowsEditor rows={rows} onChange={setRows} />
      <div className="admin-actions"><button type="button" disabled={saving} onClick={() => void save()}>Save Math Word List</button></div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
