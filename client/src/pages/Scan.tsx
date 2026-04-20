import { useCallback, useState } from 'react';
import { CameraCard } from '../components/CameraCard';
import { useScan } from '../hooks/useScan';
import type { Nip98Signer } from '../lib/nip98';
import type { ScanResult, NostrEvent } from '../types';
import { parseVenueEntry, verifyVenueEntry, VenueEntryError } from '../lib/venue-entry';
import { incrementStat } from '../lib/db';

interface Props {
  signer: Nip98Signer;
  stewardPubkey: string;
  gateId: string;
  onResult: (result: ScanResult & { venueEntryEvent: NostrEvent }) => void;
  onSwitchGate: () => void;
}

export function Scan({ signer, stewardPubkey, gateId, onResult, onSwitchGate }: Props) {
  const { scan } = useScan(signer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDecode = useCallback(async (text: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const event = parseVenueEntry(text);
      // Client-side pre-check. Server re-verifies.
      try {
        verifyVenueEntry(event);
      } catch (err) {
        if (err instanceof VenueEntryError) {
          // Render as a red decision locally so the steward sees it.
          const result: ScanResult = {
            decision: 'red',
            sub_state: err.subState as ScanResult['sub_state'],
            fanPubkey: event.pubkey || '',
            reason: err.message,
          };
          await incrementStat(stewardPubkey, 'red');
          onResult({ ...result, venueEntryEvent: event });
          return;
        }
        throw err;
      }
      const result = await scan(event, gateId);
      await incrementStat(stewardPubkey, result.decision === 'green' ? 'green' : result.decision === 'amber' ? 'amber' : 'red');
      onResult({ ...result, venueEntryEvent: event });
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
    } finally {
      // Brief pause so the camera doesn't re-fire while steward reads the result.
      setTimeout(() => setBusy(false), 400);
    }
  }, [busy, gateId, scan, stewardPubkey, onResult]);

  return (
    <div className="fade-in">
      <div className="section">
        <div className="section-title">Gate</div>
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <strong>{gateId || 'No gate set'}</strong>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Duplicate detection uses this ID.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onSwitchGate}>
            Change
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Scan fan QR</div>
        <CameraCard onDecode={onDecode} paused={busy} />
      </div>

      {error && (
        <div
          className="card card-warning"
          role="alert"
          style={{ marginTop: 12 }}
        >
          <p style={{ color: 'var(--danger)' }}>{error}</p>
        </div>
      )}

      <p
        style={{
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.8rem',
          marginTop: 16,
        }}
      >
        Point the camera at the fan's QR. Auto-scans on focus.
      </p>
    </div>
  );
}
