import { useEffect, useRef, useState } from 'react';
import {
  addUnlinkedIncident,
  listUnlinkedIncidents,
  deleteUnlinkedIncident,
  type UnlinkedIncidentRecord,
} from '../lib/db';

const CATEGORIES = [
  'disorder',
  'intoxication',
  'suspected-age',
  'pitch-incursion',
  'abuse-racial',
  'abuse-religious',
  'abuse-sexual',
  'abuse-other',
  'theft',
  'weapons',
  'other',
];

function uuid(): string {
  return crypto.randomUUID();
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

function downloadJson(records: UnlinkedIncidentRecord[]) {
  const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `unlinked-incidents-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function UnlinkedIncident({ onBack }: { onBack: () => void }) {
  const [list, setList] = useState<UnlinkedIncidentRecord[]>([]);
  const [desc, setDesc] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    const items = await listUnlinkedIncidents();
    setList(items);
  };

  useEffect(() => { refresh(); }, []);

  const save = async () => {
    if (!desc.trim()) {
      setError('Describe what happened before saving.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addUnlinkedIncident({
        id: uuid(),
        description: desc.trim(),
        category,
        time: Date.now(),
        photoDataUrl,
      });
      setDesc('');
      setCategory(CATEGORIES[0]);
      setPhotoDataUrl(undefined);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      setError('Photo must be under 5MB.');
      return;
    }
    try {
      setPhotoDataUrl(await fileToDataUrl(file));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this incident note?')) return;
    await deleteUnlinkedIncident(id);
    await refresh();
  };

  return (
    <div className="fade-in">
      <div className="section">
        <div className="section-title">New unlinked incident</div>
        <div className="card">
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            Stored on this device only. Never sent to the server or to
            anyone else. Use this when you want to remember something
            but couldn't scan a fan.
          </p>
          <textarea
            className="input"
            rows={3}
            placeholder="What happened?"
            value={desc}
            maxLength={1000}
            onChange={(e) => setDesc(e.target.value)}
            disabled={busy}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={busy}
            >
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{c.replace('-', ' ')}</option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFile}
              disabled={busy}
            />
          </div>
          {photoDataUrl && (
            <img
              src={photoDataUrl}
              alt="Attached"
              style={{
                width: '100%',
                maxWidth: 240,
                borderRadius: 'var(--radius)',
                marginTop: 8,
              }}
            />
          )}
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={busy || !desc.trim()}
            style={{ marginTop: 12, width: '100%' }}
          >
            {busy ? 'Saving…' : 'Save note'}
          </button>
          {error && (
            <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 8 }}>{error}</p>
          )}
        </div>
      </div>

      <div className="section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="section-title">Your notes ({list.length})</div>
          {list.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => downloadJson(list)}
            >
              Export JSON
            </button>
          )}
        </div>
        {list.length === 0 && (
          <div className="card">
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              No saved notes yet.
            </p>
          </div>
        )}
        {list.map(item => (
          <div className="card" key={item.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ fontSize: '0.85rem' }}>{item.category.replace('-', ' ')}</strong>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {new Date(item.time).toLocaleString()}
              </span>
            </div>
            <p style={{ fontSize: '0.9rem', marginTop: 6, whiteSpace: 'pre-wrap' }}>
              {item.description}
            </p>
            {item.photoDataUrl && (
              <img
                src={item.photoDataUrl}
                alt="Attached"
                style={{ width: '100%', maxWidth: 240, borderRadius: 'var(--radius)', marginTop: 6 }}
              />
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => remove(item.id)}
              style={{ marginTop: 8 }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginTop: 16 }}>
        Back
      </button>
    </div>
  );
}
