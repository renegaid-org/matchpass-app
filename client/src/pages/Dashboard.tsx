import { useState } from 'react';
import { useFlags } from '../hooks/useFlags';
import type { Nip98Signer } from '../lib/nip98';

type Tab = 'today' | 'reviews' | 'stewards' | 'history';

interface Props {
  signer: Nip98Signer;
  onIssueCardForFlag: (fanPubkey: string) => void;
}

export function Dashboard({ signer, onIssueCardForFlag }: Props) {
  const [tab, setTab] = useState<Tab>('today');
  const flags = useFlags(signer);

  return (
    <div className="fade-in">
      <div
        role="tablist"
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 16,
          background: 'var(--bg-secondary)',
          padding: 4,
          borderRadius: 'var(--radius-sm)',
        }}
      >
        {(['today', 'reviews', 'stewards', 'history'] as Tab[]).map(t => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              background: tab === t ? 'var(--bg-card)' : 'transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: 'none',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: tab === t ? 'var(--shadow)' : 'none',
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'today' && (
        <div>
          <div className="section-title">Duplicate admissions</div>
          {flags.loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
          {flags.error && (
            <div className="card card-warning">
              <p style={{ color: 'var(--danger)' }}>{flags.error}</p>
            </div>
          )}
          {!flags.loading && flags.flags.length === 0 && (
            <div className="card">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No open duplicate flags today.
              </p>
            </div>
          )}
          {flags.flags.map(f => (
            <div className="card" key={f.id} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Fan <code>{f.fanPubkey.slice(0, 12)}…</code>
              </div>
              <div style={{ fontSize: '0.85rem', marginTop: 8 }}>
                First admitted at <strong>{f.firstGate || '?'}</strong> by{' '}
                <code>{(f.firstStaffId || '').slice(0, 10)}…</code> —{' '}
                {new Date(f.firstTime).toLocaleTimeString()}
              </div>
              <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
                Then seen at <strong>{f.secondGate || '?'}</strong> by{' '}
                <code>{(f.secondStaffId || '').slice(0, 10)}…</code> —{' '}
                {new Date(f.secondTime).toLocaleTimeString()}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    const note = prompt('Reason for dismissal?') || 'Dismissed by officer';
                    await flags.dismiss(f.id, note);
                  }}
                >
                  Dismiss
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => onIssueCardForFlag(f.fanPubkey)}
                >
                  Convert to card
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'reviews' && (
        <div className="card">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Review-request surface lands in Sprint B Task B3. Subscribe to kind 31910 events
            and list them here.
          </p>
        </div>
      )}

      {tab === 'stewards' && (
        <div className="card">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Steward roster view lands with admin mode. Aggregate scan counts (never per-steward
            performance) land in Sprint B.
          </p>
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Season-level queries to the relay (cards issued, sanctions, review outcomes) land
            in Sprint B Task B1.
          </p>
        </div>
      )}
    </div>
  );
}
