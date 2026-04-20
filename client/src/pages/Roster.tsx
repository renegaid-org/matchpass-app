import { useEffect, useState } from 'react';
import type { Nip98Signer } from '../lib/nip98';
import {
  useRoster,
  STAFF_ROLES,
  type StaffEntry,
  type StaffRole,
} from '../hooks/useRoster';

interface Props {
  signer: Nip98Signer;
  adminPubkey: string;
  onBack: () => void;
}

const PUBKEY_RE = /^[0-9a-f]{64}$/;

function sameRoster(a: StaffEntry[], b: StaffEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].pubkey !== b[i].pubkey) return false;
    if (a[i].role !== b[i].role) return false;
    if (a[i].displayName !== b[i].displayName) return false;
  }
  return true;
}

export function Roster({ signer, adminPubkey, onBack }: Props) {
  const { staff, loading, error, publish, refresh } = useRoster(signer);
  const [draft, setDraft] = useState<StaffEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [newPubkey, setNewPubkey] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('gate_steward');
  const [newName, setNewName] = useState('');
  const [newExternal, setNewExternal] = useState(false);

  useEffect(() => {
    setDraft(staff);
  }, [staff]);

  const dirty = !sameRoster(staff, draft);

  const updateRow = (idx: number, patch: Partial<StaffEntry>) => {
    setDraft(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const removeRow = (idx: number) => {
    setDraft(prev => prev.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    setPublishError(null);
    if (!PUBKEY_RE.test(newPubkey.trim())) {
      setPublishError('Pubkey must be 64 lowercase hex characters.');
      return;
    }
    if (draft.some(s => s.pubkey === newPubkey.trim())) {
      setPublishError('That pubkey is already on the roster.');
      return;
    }
    const displayName = newExternal && newRole === 'safety_officer'
      ? 'external'
      : newName.slice(0, 100);
    setDraft(prev => [
      ...prev,
      { pubkey: newPubkey.trim(), role: newRole, displayName },
    ]);
    setNewPubkey('');
    setNewName('');
    setNewRole('gate_steward');
    setNewExternal(false);
  };

  const save = async () => {
    setPublishError(null);
    if (draft.length === 0) {
      setPublishError('Roster must have at least one entry.');
      return;
    }
    const self = draft.find(s => s.pubkey === adminPubkey);
    if (!self || self.role !== 'admin') {
      setPublishError('You must keep your own pubkey on the roster as an admin.');
      return;
    }
    setBusy(true);
    try {
      await publish(draft);
    } catch (err) {
      setPublishError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="section">
        <div className="section-title">Current roster</div>
        {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
        {error && (
          <div className="card card-warning">
            <p style={{ color: 'var(--danger)' }}>{error}</p>
            <button className="btn btn-secondary btn-sm" onClick={refresh} style={{ marginTop: 8 }}>
              Retry
            </button>
          </div>
        )}
        {draft.map((s, i) => (
          <div className="card" key={s.pubkey} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: '0.8rem', marginBottom: 4 }}>
              <code>{s.pubkey.slice(0, 16)}…{s.pubkey.slice(-8)}</code>
              {s.pubkey === adminPubkey && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>(you)</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <select
                className="input"
                value={s.role}
                style={{ flex: '0 0 auto' }}
                onChange={(e) => updateRow(i, { role: e.target.value as StaffRole })}
                disabled={busy}
              >
                {STAFF_ROLES.map(r => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <input
                className="input"
                value={s.displayName}
                maxLength={100}
                placeholder="Display name (or 'external')"
                style={{ flex: 1, minWidth: 120 }}
                onChange={(e) => updateRow(i, { displayName: e.target.value })}
                disabled={busy}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => removeRow(i)}
                disabled={busy || s.pubkey === adminPubkey}
                title={s.pubkey === adminPubkey ? 'You cannot remove yourself' : 'Remove'}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="section-title">Add staff</div>
        <div className="card">
          <input
            className="input"
            value={newPubkey}
            maxLength={64}
            placeholder="64-hex pubkey"
            onChange={(e) => setNewPubkey(e.target.value.toLowerCase())}
            disabled={busy}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <select
              className="input"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as StaffRole)}
              disabled={busy}
            >
              {STAFF_ROLES.map(r => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <input
              className="input"
              value={newName}
              maxLength={100}
              placeholder="Display name"
              style={{ flex: 1 }}
              onChange={(e) => setNewName(e.target.value)}
              disabled={busy || newExternal}
            />
          </div>
          {newRole === 'safety_officer' && (
            <label style={{ display: 'block', marginTop: 8, fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={newExternal}
                onChange={(e) => setNewExternal(e.target.checked)}
                disabled={busy}
              />{' '}
              Mark as external reviewer (overrides display name)
            </label>
          )}
          <button
            className="btn btn-secondary"
            onClick={addRow}
            disabled={busy}
            style={{ marginTop: 12 }}
          >
            Add to draft
          </button>
        </div>
      </div>

      {publishError && (
        <div className="card card-warning" style={{ marginBottom: 12 }}>
          <p style={{ color: 'var(--danger)' }}>{publishError}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost" onClick={onBack} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={busy || !dirty}
          style={{ flex: 1 }}
        >
          {busy ? 'Publishing…' : dirty ? 'Publish roster' : 'No changes'}
        </button>
      </div>
    </div>
  );
}
