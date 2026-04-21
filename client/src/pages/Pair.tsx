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
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <img
            src="/logo.svg"
            alt="MatchPass"
            width={72}
            height={72}
            style={{ borderRadius: 16, boxShadow: 'var(--shadow)' }}
          />
          <h1 style={{ marginTop: 12, color: 'var(--accent)', letterSpacing: '-0.02em' }}>
            MatchPass
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 4 }}>
            Gate steward sign-in
          </p>
        </div>

        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ marginBottom: 4 }}>Sign in with Signet</h3>
          <p
            style={{
              fontSize: '0.9rem',
              color: 'var(--text-secondary)',
              marginTop: 8,
              marginBottom: 20,
            }}
          >
            Tap the button if Signet is on this phone, or scan the QR from another device.
          </p>

          <a
            href={status.uri}
            className="btn btn-primary btn-lg"
            style={{ textDecoration: 'none', marginBottom: 16 }}
          >
            Open Signet →
          </a>

          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              margin: '4px 0 12px',
            }}
          >
            — or scan —
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 16,
              padding: 12,
              background: '#FFFFFF',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
            }}
          >
            <QRCode value={status.uri} size={240} />
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            Session: <code>{status.sessionPubkey.slice(0, 12)}…{status.sessionPubkey.slice(-8)}</code>
          </p>
          <div style={{ marginTop: 20 }}>
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
