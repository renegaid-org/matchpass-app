import { useEffect, useState } from 'react';
import type { InviteState } from '../hooks/useInvite';
import { QRCode } from './QRCode';

interface Props {
  state: InviteState;
  onClose: () => void;
  /**
   * Server-side cancel. The Cancel button calls this first (DELETE
   * /api/gate/invites/:token) and then closes the modal. Without this, the
   * cache entry would linger until its 15-minute TTL even though the staff
   * manager has clearly abandoned it.
   */
  onCancel?: () => Promise<void>;
}

function fmtCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function InviteQRDisplay({ state, onClose, onCancel }: Props) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    const i = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(i);
  }, []);

  if (!state.invite) return null;
  const remainingSeconds = Math.max(0, state.invite.pending_expires_at - now);

  const handleCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      if (onCancel) await onCancel();
    } finally {
      setCancelling(false);
      onClose();
    }
  };

  if (state.status === 'pending') {
    return (
      <div className="invite-display-card card">
        <h2>Invite ready</h2>
        <QRCode value={state.invite.qr_payload} size={256} />
        <p className="muted">Status: Waiting for scan</p>
        <p className="muted">Expires in {fmtCountdown(remainingSeconds)}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={() => navigator.clipboard.writeText(state.invite!.qr_payload)}
          >
            Copy link
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'accepted') {
    return (
      <div className="invite-display-card card">
        <h2>{state.displayName ?? 'New staff'} signed in</h2>
        <p>
          Persona: <code>{state.personaPubkey?.slice(0, 16)}...</code>
        </p>
        <p>
          This invite is now ready to add to the roster. Open Roster &rarr; Pending
          acceptances to sign.
        </p>
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    );
  }

  if (state.status === 'consumed') {
    return (
      <div className="invite-display-card card">
        <h2>Added to roster</h2>
        <p>{state.displayName ?? 'Staff member'} is now live.</p>
        <button className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  if (state.status === 'expired') {
    return (
      <div className="invite-display-card card">
        <h2>Invite expired</h2>
        <button className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  return null;
}
