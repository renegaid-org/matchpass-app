import { useState } from 'react';
import { useInvite } from '../hooks/useInvite';
import type { InviteRole } from '../lib/invites';
import { InviteQRDisplay } from './InviteQRDisplay';

interface Props {
  onClose: () => void;
}

const EXPIRY_PRESETS: Array<{ label: string; offsetSeconds: number | null }> = [
  { label: '4 hours', offsetSeconds: 4 * 3600 },
  { label: 'End of match day', offsetSeconds: null }, // computed at submit
  { label: '2 days', offsetSeconds: 2 * 86400 },
  { label: 'Permanent (admin only)', offsetSeconds: 0 }, // 0 → no expiry
];

function endOfMatchDayUtc(): number {
  const now = new Date();
  now.setUTCHours(23, 59, 0, 0);
  return Math.floor(now.getTime() / 1000);
}

export function AddStaffWizard({ onClose }: Props) {
  const [role, setRole] = useState<InviteRole>('gate_steward');
  const [expiryPreset, setExpiryPreset] = useState(1);
  const [displayName, setDisplayName] = useState('');
  const { state, mint, cancel } = useInvite();

  if (state.status !== 'idle' && state.invite) {
    return <InviteQRDisplay state={state} onClose={onClose} onCancel={cancel} />;
  }

  const handleGenerate = () => {
    const preset = EXPIRY_PRESETS[expiryPreset];
    const staffExpiresAt =
      preset.offsetSeconds === null
        ? endOfMatchDayUtc()
        : preset.offsetSeconds === 0
          ? undefined
          : Math.floor(Date.now() / 1000) + preset.offsetSeconds;
    mint({ role, displayName: displayName || undefined, staffExpiresAt });
  };

  return (
    <div className="addstaff-card card">
      <h2>Add staff</h2>
      <label>
        Role
        <select value={role} onChange={e => setRole(e.target.value as InviteRole)}>
          <option value="gate_steward">Door Steward</option>
          <option value="roaming_steward">Roaming Steward</option>
          <option value="safety_officer">Safety Officer</option>
          <option value="safeguarding_officer">Safeguarding Officer</option>
          <option value="staff_manager">Staff Manager</option>
        </select>
      </label>
      <label>
        Expires
        <select
          value={expiryPreset}
          onChange={e => setExpiryPreset(Number(e.target.value))}
        >
          {EXPIRY_PRESETS.map((p, i) => (
            <option key={i} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name (optional)
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Marcus"
        />
      </label>
      <button className="btn btn-primary" onClick={handleGenerate}>
        Generate invite
      </button>
      {state.status === 'error' && (
        <p className="error" style={{ color: 'var(--danger)' }}>
          {state.error}
        </p>
      )}
    </div>
  );
}
