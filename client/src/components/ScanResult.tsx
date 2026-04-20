import { useEffect, useRef, useState } from 'react';
import type { ScanResult as ScanResultType } from '../types';
import { fetchAndDecryptPhoto } from '../lib/blossom';

type Tone = 'green' | 'amber' | 'red';

interface Props {
  result: ScanResultType;
  onDone: () => void;
  onPhotoMismatch?: () => void;
  onHoldForOfficer?: () => void;
}

const TONE_STYLES: Record<Tone, { bg: string; fg: string; label: string; icon: string }> = {
  green: { bg: 'var(--success-light)', fg: 'var(--success)', label: 'ADMIT', icon: '✓' },
  amber: { bg: 'var(--warning-light)', fg: 'var(--warning)', label: 'CHECK', icon: '!' },
  red: { bg: 'var(--danger-light)', fg: 'var(--danger)', label: 'DENY', icon: '✕' },
};

export function ScanResult({ result, onDone, onPhotoMismatch, onHoldForOfficer }: Props) {
  const tone = TONE_STYLES[result.decision as Tone];
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const photoUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!result.blossom || !result.x || !result.photoKey) return;
    let cancelled = false;
    setPhotoLoading(true);
    fetchAndDecryptPhoto({
      blossomUrl: result.blossom,
      photoHash: result.x,
      photoKey: result.photoKey,
    })
      .then(p => {
        if (cancelled) {
          URL.revokeObjectURL(p.blobUrl);
          return;
        }
        if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
        photoUrlRef.current = p.blobUrl;
        setPhotoUrl(p.blobUrl);
      })
      .catch(err => {
        if (!cancelled) setPhotoError(err.message);
      })
      .finally(() => {
        if (!cancelled) setPhotoLoading(false);
      });

    return () => {
      cancelled = true;
      if (photoUrlRef.current) {
        URL.revokeObjectURL(photoUrlRef.current);
        photoUrlRef.current = null;
      }
    };
  }, [result.blossom, result.x, result.photoKey]);

  const crossClubBan =
    result.decision === 'red' &&
    (result.sub_state === 'banned' ||
      result.sub_state === 'active_red_card' ||
      result.sub_state === 'suspension_active');

  const isDuplicate = result.sub_state === 'duplicate_admission';

  return (
    <div className="fade-in">
      <div
        style={{
          background: tone.bg,
          color: tone.fg,
          borderRadius: 'var(--radius)',
          padding: 32,
          textAlign: 'center',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ fontSize: '3rem', fontWeight: 700, lineHeight: 1 }}>{tone.icon}</div>
        <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: 8, letterSpacing: '0.05em' }}>
          {tone.label}
        </div>
        {result.reason && (
          <div style={{ fontSize: '1rem', fontWeight: 500, marginTop: 8, opacity: 0.9 }}>
            {result.reason}
          </div>
        )}
      </div>

      {crossClubBan && (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            This is a cross-club decision if the fan is not your club's member — honoured
            here by policy.
          </p>
        </div>
      )}

      {isDuplicate && (
        <div className="card card-warning" style={{ marginTop: 12 }}>
          <strong>Hold for officer</strong>
          <p style={{ fontSize: '0.85rem', marginTop: 4 }}>
            This fan has already been admitted today by a different steward or at a different
            gate. Do not deny outright — ask them to wait and call a safety officer.
          </p>
        </div>
      )}

      {(result.blossom || photoLoading) && (
        <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
          <div className="section-title" style={{ textAlign: 'left' }}>
            Fan photo
          </div>
          {photoLoading && (
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Loading photo…</p>
          )}
          {photoError && (
            <div>
              <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
                Photo verification failed: {photoError}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 4 }}>
                Check manually with other ID.
              </p>
            </div>
          )}
          {photoUrl && (
            <img
              src={photoUrl}
              alt="Fan photo"
              style={{
                width: '100%',
                maxWidth: 240,
                borderRadius: 'var(--radius)',
                margin: '8px auto 0',
                display: 'block',
              }}
            />
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 24 }}>
        <button className="btn btn-primary btn-lg" onClick={onDone}>
          Done
        </button>
        {onPhotoMismatch && photoUrl && (
          <button className="btn btn-secondary" onClick={onPhotoMismatch}>
            Photo doesn't match
          </button>
        )}
        {onHoldForOfficer && (isDuplicate || result.decision === 'red') && (
          <button className="btn btn-secondary" onClick={onHoldForOfficer}>
            Hold for officer
          </button>
        )}
      </div>

      <div style={{ marginTop: 16, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
        <div>
          Fan: <code>{result.fanPubkey?.slice(0, 12)}…</code>
        </div>
        <div>Sub-state: {result.sub_state}</div>
      </div>
    </div>
  );
}
