import { useMemo, useState } from 'react';
import type { Nip98Signer } from '../lib/nip98';
import { useChain } from '../hooks/useChain';
import { useEvent } from '../hooks/useEvent';
import { sanctionTemplate } from '../lib/chain';
import { useConfirm } from '../components/ConfirmModal';

interface Props {
  signer: Nip98Signer;
  fanPubkey: string;
  onBack: () => void;
  onDone: () => void;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function sixMonthsOut() {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0, 10);
}

export function SanctionIssue({ signer, fanPubkey, onBack, onDone }: Props) {
  const chain = useChain(signer, fanPubkey);
  const { publish } = useEvent(signer);
  const confirm = useConfirm();

  const [sanctionType, setSanctionType] = useState<'suspension' | 'ban'>('suspension');
  const [reason, setReason] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endMode, setEndMode] = useState<'date' | 'indefinite'>('date');
  const [endDate, setEndDate] = useState(sixMonthsOut());
  const [linkedCardIds, setLinkedCardIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCards = chain.data?.activeCards ?? [];

  const advisory = useMemo(() => {
    const yellows = activeCards.filter(c => c.cardType === 'yellow').length;
    const reds = activeCards.filter(c => c.cardType === 'red').length;
    if (reds >= 1) {
      return `This fan has ${reds} active red card(s). A ban or multi-match suspension is usually warranted.`;
    }
    if (yellows >= 2) {
      return `This fan has ${yellows} active yellow cards. A one-match suspension is a common step.`;
    }
    return null;
  }, [activeCards]);

  const toggleCardLink = (id: string) => {
    setLinkedCardIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const submit = async () => {
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }
    const effectiveEnd = endMode === 'indefinite' ? 'indefinite' : endDate;
    if (endMode === 'date' && (!endDate || endDate < startDate)) {
      setError('End date must be on or after start date.');
      return;
    }

    const isBan = sanctionType === 'ban';
    const verb = isBan ? 'Publish ban' : 'Publish suspension';
    const effectiveLabel = endMode === 'indefinite' ? 'indefinite' : `until ${endDate}`;
    const { confirmed } = await confirm({
      title: isBan
        ? `Ban this fan ${effectiveLabel}?`
        : `Suspend this fan ${effectiveLabel}?`,
      message: isBan
        ? 'Bans deny the fan entry at every participating club until the sanction ends or is reviewed. Chain writes are permanent.'
        : 'Suspensions deny entry for the configured period. Chain writes are permanent.',
      detail: `From ${startDate} · ${effectiveLabel} · Reason: "${reason.trim().slice(0, 160)}${reason.length > 160 ? '…' : ''}"`,
      variant: 'danger',
      requireType: isBan ? 'BAN' : undefined,
      confirmLabel: verb,
    });
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      await publish({
        fanPubkey,
        build: (tip) => sanctionTemplate({
          fanPubkey,
          previousEventId: tip || '',
          sanctionType,
          reason: reason.trim(),
          startDate,
          endDate: effectiveEnd,
          linkedCardIds,
          notes: notes.trim() || undefined,
        }),
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="section">
        <div className="section-title">Fan</div>
        <div className="card">
          <code style={{ fontSize: '0.8rem' }}>
            {fanPubkey.slice(0, 16)}…{fanPubkey.slice(-8)}
          </code>
          {chain.loading && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Loading chain…
            </div>
          )}
          {chain.data && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Status: {chain.data.statusName} · {activeCards.length} active card(s)
            </div>
          )}
        </div>
      </div>

      {advisory && (
        <div className="card card-warning" style={{ marginBottom: 12 }}>
          <strong>Advisory</strong>
          <p style={{ fontSize: '0.85rem', marginTop: 4 }}>{advisory}</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title">Type</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${sanctionType === 'suspension' ? 'btn-warning' : 'btn-secondary'}`}
            onClick={() => setSanctionType('suspension')}
            type="button"
          >
            Suspension
          </button>
          <button
            className={`btn ${sanctionType === 'ban' ? 'btn-danger' : 'btn-secondary'}`}
            onClick={() => setSanctionType('ban')}
            type="button"
          >
            Ban
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title">Reason (on chain)</div>
        <textarea
          className="input"
          rows={3}
          value={reason}
          maxLength={500}
          placeholder="Short reason the fan and reviewers will see."
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title">Start date</div>
        <input
          type="date"
          className="input"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          disabled={busy}
        />
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title">End</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            className={`btn ${endMode === 'date' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setEndMode('date')}
            type="button"
          >
            By date
          </button>
          <button
            className={`btn ${endMode === 'indefinite' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setEndMode('indefinite')}
            type="button"
          >
            Indefinite
          </button>
        </div>
        {endMode === 'date' && (
          <input
            type="date"
            className="input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={busy}
          />
        )}
        {endMode === 'indefinite' && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            An indefinite sanction should be reviewed before {sixMonthsOut()}.
            This reminder lives on this device only; it's not published on chain.
          </p>
        )}
      </div>

      {activeCards.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-title">Linked cards (optional)</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            Link the cards this sanction is responding to.
          </p>
          {activeCards.map(c => (
            <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
              <input
                type="checkbox"
                checked={linkedCardIds.includes(c.id)}
                onChange={() => toggleCardLink(c.id)}
                disabled={busy}
              />
              <span style={{ fontSize: '0.85rem' }}>
                {c.cardType} · {c.category} ·{' '}
                <code>{c.id.slice(0, 10)}…</code>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="section-title">Internal notes (off chain)</div>
        <textarea
          className="input"
          rows={2}
          value={notes}
          maxLength={1000}
          placeholder="Context for other officers. Stored in the event content, visible on relay."
          onChange={(e) => setNotes(e.target.value)}
          disabled={busy}
        />
      </div>

      {error && (
        <div className="card card-warning" style={{ marginBottom: 12 }}>
          <p style={{ color: 'var(--danger)' }}>{error}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost" onClick={onBack} disabled={busy}>
          Cancel
        </button>
        <button
          className={sanctionType === 'ban' ? 'btn btn-danger' : 'btn btn-warning'}
          onClick={submit}
          disabled={busy || !reason.trim()}
          style={{ flex: 1 }}
        >
          {busy ? 'Publishing…' : sanctionType === 'ban' ? 'Issue ban' : 'Issue suspension'}
        </button>
      </div>
    </div>
  );
}
