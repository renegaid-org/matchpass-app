import { useEffect, useState } from 'react';
import type { PairingStatus } from '../lib/nip46';
import { QRCode } from '../components/QRCode';

interface Props {
  status: PairingStatus;
  onStart: () => Promise<void>;
  onCancel: () => void;
}

export function Pair({ status, onStart, onCancel }: Props) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status.kind === 'idle' && !busy) {
      setBusy(true);
      onStart()
        .catch(err => console.warn('Pair start failed', err))
        .finally(() => setBusy(false));
    }
  }, [status.kind, busy, onStart]);

  if (status.kind === 'error') {
    return (
      <div className="card">
        <h3>Pairing error</h3>
        <p style={{ color: 'var(--danger)' }}>{status.message}</p>
        <button className="btn btn-primary" onClick={onStart} style={{ marginTop: 16 }}>
          Try again
        </button>
      </div>
    );
  }

  if (status.kind === 'connected') {
    return (
      <div className="card">
        <h3>Paired</h3>
        <p style={{ color: 'var(--success)', marginTop: 8 }}>
          Connected to Signet identity:
        </p>
        <code style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          {status.remotePubkey.slice(0, 12)}...{status.remotePubkey.slice(-8)}
        </code>
        <button className="btn btn-secondary" onClick={onCancel} style={{ marginTop: 16 }}>
          Continue
        </button>
      </div>
    );
  }

  if (status.kind === 'waiting') {
    return (
      <div className="fade-in">
        <div className="card" style={{ textAlign: 'center' }}>
          <h3>Pair with Signet</h3>
          <p
            style={{
              fontSize: '0.9rem',
              color: 'var(--text-secondary)',
              marginTop: 8,
              marginBottom: 16,
            }}
          >
            Open Signet on your phone and scan this code.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <QRCode value={status.uri} size={256} />
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            Session: <code>{status.sessionPubkey.slice(0, 12)}…{status.sessionPubkey.slice(-8)}</code>
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
            <button className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
        <p
          style={{
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.8rem',
            marginTop: 16,
          }}
        >
          Waiting for approval in Signet…
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <p>Preparing pairing session…</p>
    </div>
  );
}
