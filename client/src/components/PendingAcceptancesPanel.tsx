/**
 * PendingAcceptancesPanel — shows the queue of QR-accepted personas who are
 * waiting to be added to the staff roster. Renders nothing when the queue is
 * empty so it can sit at the top of the Roster page without taking space.
 *
 * "Sign roster" merges the persona into the current roster and POSTs the
 * signed kind-31920 event to /api/gate/event. The server-side invite-consume
 * hook (Task 10, wired in /api/gate/event) marks the matching invite consumed,
 * so the next poll of /api/gate/invites/accepted naturally drops the row.
 */

import { useState } from 'react';
import type { Nip98Signer } from '../lib/nip98';
import { usePendingAcceptances, type AcceptedInvite } from '../hooks/useInvite';
import { useRoster } from '../hooks/useRoster';

interface Props {
  signer: Nip98Signer;
}

export function PendingAcceptancesPanel({ signer }: Props) {
  const accepted = usePendingAcceptances();
  const { publishWithAddedEntries } = useRoster(signer);
  const [busyTokenHash, setBusyTokenHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (accepted.length === 0) return null;

  const sign = async (a: AcceptedInvite) => {
    setBusyTokenHash(a.token_hash);
    setError(null);
    try {
      await publishWithAddedEntries([
        {
          pubkey: a.persona_pubkey,
          role: a.role,
          displayName: a.display_name ?? '',
          expiresAt: a.staff_expires_at ?? null,
        },
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyTokenHash(null);
    }
  };

  return (
    <div className="section">
      <div className="section-title">Pending acceptances</div>
      {error && (
        <div className="card card-warning" style={{ marginBottom: 8 }}>
          <p style={{ color: 'var(--danger)' }}>{error}</p>
        </div>
      )}
      {accepted.map((a) => {
        const isBusy = busyTokenHash === a.token_hash;
        return (
          <div className="card" key={a.token_hash} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <strong>{a.display_name || 'New staff'}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: '0.85rem' }}>
                  {a.role.replace(/_/g, ' ')}
                </span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  <code>{a.persona_pubkey.slice(0, 16)}…</code>
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void sign(a)}
                disabled={isBusy || busyTokenHash !== null}
              >
                {isBusy ? 'Signing…' : 'Sign roster'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
