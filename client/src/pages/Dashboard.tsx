import { useState } from 'react';
import { useFlags, getReviewFanPubkey } from '../hooks/useFlags';
import type { ReviewRequest } from '../hooks/useFlags';
import type { Nip98Signer } from '../lib/nip98';
import { useConfirm } from '../components/ConfirmModal';
import { useStaff } from '../hooks/useStaff';
import { useDashboard } from '../hooks/useDashboard';

function shortName(member: { displayName: string | null; pubkey: string }) {
  if (member.displayName && member.displayName !== 'external') return member.displayName;
  return `${member.pubkey.slice(0, 10)}…`;
}

function formatExpiry(epoch: number | null | undefined) {
  if (!epoch) return null;
  const d = new Date(epoch * 1000);
  const sameDay = new Date().toDateString() === d.toDateString();
  if (sameDay) return `expires ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return `expires ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

type Tab = 'today' | 'reviews' | 'stewards' | 'history';

interface Props {
  signer: Nip98Signer;
  onIssueCardForFlag: (fanPubkey: string) => void;
  onOpenReview?: (request: ReviewRequest) => void;
  onIssueSanction?: (fanPubkey: string) => void;
}

export function Dashboard({ signer, onIssueCardForFlag, onOpenReview, onIssueSanction }: Props) {
  const [tab, setTab] = useState<Tab>('today');
  const flags = useFlags(signer);
  const confirm = useConfirm();
  const dashboard = useDashboard(signer);
  const staff = useStaff(signer);
  const staffNameByPubkey = new Map(staff.staff.map(s => [s.pubkey, shortName(s)]));
  const staffIdLabel = (id: string | null | undefined) =>
    id ? (staffNameByPubkey.get(id) || `${id.slice(0, 10)}…`) : '?';

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
          <div className="section-title">Today's scans</div>
          <div className="card" style={{ marginBottom: 12 }}>
            {dashboard.loading && !dashboard.data && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>
            )}
            {dashboard.error && (
              <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{dashboard.error}</p>
            )}
            {dashboard.data && (
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1 }}>
                  {dashboard.data.scans.total}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
                  Total admissions · {dashboard.data.date}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <div style={{ flex: 1, textAlign: 'center', padding: 8, background: 'var(--success-light)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)' }}>{dashboard.data.scans.green}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--success)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Green</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', padding: 8, background: 'var(--warning-light)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--warning)' }}>{dashboard.data.scans.amber}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amber</div>
                  </div>
                  <div style={{ flex: 1, textAlign: 'center', padding: 8, background: 'var(--danger-light)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--danger)' }}>{dashboard.data.scans.red}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Red</div>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span>{dashboard.data.cache.fans} fan tip(s) cached</span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ padding: 0, fontSize: '0.75rem', width: 'auto' }}
                    onClick={() => dashboard.refresh()}
                    disabled={dashboard.loading}
                  >
                    {dashboard.loading ? 'Refreshing…' : 'Refresh'}
                  </button>
                </div>
              </div>
            )}
          </div>

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
                <strong>{staffIdLabel(f.firstStaffId)}</strong> —{' '}
                {new Date(f.firstTime).toLocaleTimeString()}
              </div>
              <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
                Then seen at <strong>{f.secondGate || '?'}</strong> by{' '}
                <strong>{staffIdLabel(f.secondStaffId)}</strong> —{' '}
                {new Date(f.secondTime).toLocaleTimeString()}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    const { confirmed, input } = await confirm({
                      title: 'Dismiss duplicate flag?',
                      message: 'This records a dismissal against the flag (no chain event).',
                      input: {
                        placeholder: 'Reason for dismissal (visible to other officers)',
                        maxLength: 500,
                        required: true,
                      },
                      confirmLabel: 'Dismiss',
                    });
                    if (confirmed) {
                      await flags.dismiss(f.id, (input || '').trim() || 'Dismissed by officer');
                    }
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
                {onIssueSanction && (
                  <button
                    className="btn btn-warning btn-sm"
                    onClick={() => onIssueSanction(f.fanPubkey)}
                  >
                    Issue sanction
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'reviews' && (
        <div>
          <div className="section-title">Review requests</div>
          {flags.loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
          {!flags.loading && flags.reviewRequests.length === 0 && (
            <div className="card">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No pending review requests.
              </p>
            </div>
          )}
          {flags.reviewRequests.map(req => {
            const fan = getReviewFanPubkey(req);
            return (
              <div className="card" key={req.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Fan <code>{fan ? `${fan.slice(0, 12)}…` : 'unknown'}</code>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Requested {new Date(req.created_at * 1000).toLocaleString()}
                </div>
                <div style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => onOpenReview?.(req)}
                    disabled={!onOpenReview}
                  >
                    Open review
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'stewards' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="section-title">On duty ({staff.staff.length})</div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ padding: 0, fontSize: '0.75rem', width: 'auto' }}
              onClick={() => { staff.refresh(); dashboard.refresh(); }}
              disabled={staff.loading}
            >
              {staff.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {staff.loading && !staff.staff.length && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading…</p>
          )}
          {staff.error && (
            <div className="card card-warning">
              <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{staff.error}</p>
            </div>
          )}
          {!staff.loading && staff.staff.length === 0 && !staff.error && (
            <div className="card">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No staff on the roster cache yet. The matchpass-gate server hydrates from
                the relay on startup — try again in a moment.
              </p>
            </div>
          )}
          {staff.staff.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {staff.staff
                .slice()
                .sort((a, b) => (b.scans.total - a.scans.total) || a.role.localeCompare(b.role))
                .map((member, i) => (
                  <div
                    key={member.pubkey}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 14px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{shortName(member)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {member.role.replace(/_/g, ' ')}
                        {member.expiresAt && (
                          <span style={{ color: 'var(--warning)', marginLeft: 6 }}>
                            · {formatExpiry(member.expiresAt)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, fontSize: '0.75rem' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--success-light)', color: 'var(--success)', fontWeight: 600 }}>
                        {member.scans.green}
                      </span>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--warning-light)', color: 'var(--warning)', fontWeight: 600 }}>
                        {member.scans.amber}
                      </span>
                      <span style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--danger-light)', color: 'var(--danger)', fontWeight: 600 }}>
                        {member.scans.red}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          )}
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Counts reset at midnight. Aggregate view only — performance management is not a MatchPass feature.
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
