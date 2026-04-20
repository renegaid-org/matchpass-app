import { useMemo, useState } from 'react';
import type { Nip98Signer } from '../lib/nip98';
import type { ReviewRequest } from '../hooks/useFlags';
import {
  getReviewTargetEventId,
  getReviewFanPubkey,
} from '../hooks/useFlags';
import { useChain } from '../hooks/useChain';
import { useEvent } from '../hooks/useEvent';
import { reviewOutcomeTemplate } from '../lib/chain';
import type { NostrEvent } from '../types';

interface Props {
  signer: Nip98Signer;
  officerPubkey: string;
  request: ReviewRequest;
  onBack: () => void;
  onResolved: () => void;
}

function formatTagValue(tag: string[]) {
  return tag.slice(1).filter(Boolean).join(' · ');
}

function kindLabel(kind: number): string {
  switch (kind) {
    case 31900: return 'Membership';
    case 31901: return 'Gate lock';
    case 31902: return 'Attendance';
    case 31903: return 'Card';
    case 31904: return 'Sanction';
    case 31905: return 'Review outcome';
    default: return `Kind ${kind}`;
  }
}

export function ReviewDetail({ signer, officerPubkey, request, onBack, onResolved }: Props) {
  const fanPubkey = getReviewFanPubkey(request);
  const targetEventId = getReviewTargetEventId(request);

  const chain = useChain(signer, fanPubkey);
  const { publish } = useEvent(signer);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const targetEvent: NostrEvent | null = useMemo(() => {
    if (!chain.data || !targetEventId) return null;
    return chain.data.events.find(e => e.id === targetEventId) ?? null;
  }, [chain.data, targetEventId]);

  const isSelfReview = targetEvent?.pubkey === officerPubkey;

  const act = async (outcome: 'dismissed' | 'downgraded') => {
    if (!fanPubkey || !targetEventId) {
      setError('Missing fan pubkey or target event id on review request.');
      return;
    }
    if (isSelfReview) {
      setError('Self-review is blocked — refer to an external reviewer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await publish({
        fanPubkey,
        build: (tip) => reviewOutcomeTemplate({
          fanPubkey,
          previousEventId: tip || '',
          reviewedEventId: targetEventId,
          outcome,
          reasoning: note.trim() || undefined,
        }),
      });
      onResolved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const referExternal = () => {
    // Pilot behaviour: show a prompt telling the officer to hand off to an
    // external reviewer. Future work: send an NIP-04 DM to external
    // reviewers listed on the roster.
    alert(
      'This review is for an event you authored. Ask another officer — ' +
      'ideally one flagged `external` on your club roster — to open and sign this review.'
    );
  };

  if (!fanPubkey || !targetEventId) {
    return (
      <div className="fade-in">
        <div className="card card-warning">
          <strong>Malformed review request</strong>
          <p style={{ fontSize: '0.85rem', marginTop: 4 }}>
            The review request is missing a fan pubkey or target event id. Nothing to do.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={onBack} style={{ marginTop: 12 }}>Back</button>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="section">
        <div className="section-title">Review request</div>
        <div className="card">
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            From fan <code>{fanPubkey.slice(0, 12)}…</code>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Received {new Date(request.created_at * 1000).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Target event</div>
        {chain.loading && <p style={{ color: 'var(--text-muted)' }}>Loading chain…</p>}
        {chain.error && (
          <div className="card card-warning">
            <p style={{ color: 'var(--danger)' }}>{chain.error}</p>
          </div>
        )}
        {targetEvent ? (
          <div className="card">
            <div style={{ fontWeight: 600 }}>{kindLabel(targetEvent.kind)}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {new Date(targetEvent.created_at * 1000).toLocaleString()} · signed by{' '}
              <code>{targetEvent.pubkey.slice(0, 10)}…</code>
            </div>
            <ul style={{ marginTop: 8, fontSize: '0.8rem', listStyle: 'none', paddingLeft: 0 }}>
              {targetEvent.tags
                .filter(t => !['d', 'p', 'previous'].includes(t[0]))
                .map((t, i) => (
                  <li key={i} style={{ color: 'var(--text-secondary)' }}>
                    <strong>{t[0]}</strong> · {formatTagValue(t)}
                  </li>
                ))}
            </ul>
            {targetEvent.content && (
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {targetEvent.content}
              </div>
            )}
          </div>
        ) : (
          !chain.loading && (
            <div className="card">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                Target event not found in the fan's chain. It may have been replaced
                or the fan has no membership on this relay.
              </p>
            </div>
          )
        )}
      </div>

      {isSelfReview ? (
        <div className="card card-warning">
          <strong>Self-review blocked</strong>
          <p style={{ fontSize: '0.85rem', marginTop: 4 }}>
            You authored this event, so you cannot sign the review outcome.
          </p>
          <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={referExternal}>
            Refer to external reviewer
          </button>
        </div>
      ) : (
        <div className="section">
          <div className="section-title">Decision</div>
          <div className="card">
            <label
              htmlFor="review-note"
              style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}
            >
              Reasoning (shared on chain)
            </label>
            <textarea
              id="review-note"
              className="input"
              rows={3}
              value={note}
              maxLength={500}
              placeholder="Why confirm / downgrade / dismiss?"
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() => act('dismissed')}
              >
                Dismiss (remove from chain)
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => act('downgraded')}
              >
                Downgrade (red → yellow)
              </button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => {
                  alert(
                    'Confirm is a soft decision — no chain event. ' +
                    'The fan is notified via DM in a later session.'
                  );
                  onResolved();
                }}
              >
                Confirm (no chain change)
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="card card-warning" style={{ marginTop: 12 }}>
          <p style={{ color: 'var(--danger)' }}>{error}</p>
        </div>
      )}

      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginTop: 16 }}>
        Back to dashboard
      </button>
    </div>
  );
}
