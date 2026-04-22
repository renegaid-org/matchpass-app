import { useState } from 'react';
import { cardTemplate, CARD_CATEGORIES, type CardCategory } from '../lib/chain';
import { useEvent } from '../hooks/useEvent';
import type { Nip98Signer } from '../lib/nip98';
import { useConfirm } from '../components/ConfirmModal';

interface Props {
  signer: Nip98Signer;
  fanPubkey: string;
  onDone: () => void;
}

export function CardIssue({ signer, fanPubkey, onDone }: Props) {
  const { publish } = useEvent(signer);
  const confirm = useConfirm();
  const [cardType, setCardType] = useState<'yellow' | 'red'>('yellow');
  const [category, setCategory] = useState<CardCategory>('other');
  const [notes, setNotes] = useState('');
  const [matchDate, setMatchDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    // Chain writes are immutable. Red cards trigger a typed confirmation;
    // yellows prompt but don't require typing.
    const isRed = cardType === 'red';
    const { confirmed } = await confirm({
      title: isRed ? 'Issue a RED card?' : 'Issue a yellow card?',
      message: isRed
        ? 'Red cards count toward sanctions and remain on the fan\'s chain for 24 months. This is published to the chain and cannot be undone — only reviewed.'
        : 'Yellow cards remain on the fan\'s chain for 12 months. Published to the chain; can only be dismissed by a safety officer at review.',
      detail: `Category: ${category.replace('-', ' ')} · Match ${matchDate}${notes ? ` · "${notes.slice(0, 120)}${notes.length > 120 ? '…' : ''}"` : ''}`,
      variant: isRed ? 'danger' : 'warning',
      requireType: isRed ? 'RED' : undefined,
      confirmLabel: isRed ? 'Publish red card' : 'Publish yellow card',
    });
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const result = await publish({
        fanPubkey,
        build: (tip) => {
          if (!tip) throw new Error('Fan has no chain — membership required first');
          return cardTemplate({
            fanPubkey,
            previousEventId: tip,
            cardType,
            category,
            matchDate,
            notes,
          });
        },
      });
      setDone(result.body.eventId || 'ok');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="fade-in">
        <div className="card" style={{ textAlign: 'center' }}>
          <h3>Card issued</h3>
          <p style={{ color: 'var(--success)', marginTop: 8 }}>Published to the chain.</p>
          <code style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {done.slice(0, 16)}…
          </code>
          <button className="btn btn-primary" onClick={onDone} style={{ marginTop: 16 }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="card">
        <div className="section-title">Fan</div>
        <code>{fanPubkey.slice(0, 16)}…{fanPubkey.slice(-8)}</code>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="section-title">Card type</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`btn ${cardType === 'yellow' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setCardType('yellow')}
            style={cardType === 'yellow' ? { background: 'var(--warning)' } : undefined}
          >
            Yellow
          </button>
          <button
            className={`btn ${cardType === 'red' ? 'btn-danger' : 'btn-secondary'}`}
            onClick={() => setCardType('red')}
          >
            Red
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="section-title">Category</div>
        <select
          className="input"
          value={category}
          onChange={(e) => setCategory(e.target.value as CardCategory)}
        >
          {CARD_CATEGORIES.filter(c => c !== 'duplicate_admission').map(c => (
            <option key={c} value={c}>{c.replace('-', ' ')}</option>
          ))}
        </select>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="section-title">Match date</div>
        <input
          type="date"
          className="input"
          value={matchDate}
          onChange={(e) => setMatchDate(e.target.value)}
        />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="section-title">Notes (optional)</div>
        <textarea
          className="input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Free text incident description"
        />
      </div>

      {error && (
        <div className="card card-warning" style={{ marginTop: 12 }}>
          <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>
        </div>
      )}

      <button
        className="btn btn-primary btn-lg"
        onClick={submit}
        disabled={busy}
        style={{ marginTop: 16 }}
      >
        {busy ? 'Signing with Signet…' : 'Issue card'}
      </button>
    </div>
  );
}
