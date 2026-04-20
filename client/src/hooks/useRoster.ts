import { useCallback, useEffect, useState } from 'react';
import { buildNip98AuthHeader, type Nip98Signer } from '../lib/nip98';
import type { NostrEvent } from '../types';

const API_BASE = '/api/gate';

export type StaffRole =
  | 'gate_steward'
  | 'roaming_steward'
  | 'safety_officer'
  | 'safeguarding_officer'
  | 'admin';

export interface StaffEntry {
  pubkey: string;
  role: StaffRole;
  displayName: string;
}

export function useRoster(signer: Nip98Signer | null) {
  const [clubPubkey, setClubPubkey] = useState<string | null>(null);
  const [rosterEvent, setRosterEvent] = useState<NostrEvent | null>(null);
  const [staff, setStaff] = useState<StaffEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signer) return;
    setLoading(true);
    setError(null);
    try {
      const fullUrl = `${window.location.origin}${API_BASE}/roster`;
      const authHeader = await buildNip98AuthHeader('GET', fullUrl, undefined, signer);
      const res = await fetch(`${API_BASE}/roster`, {
        headers: { Authorization: authHeader },
      });
      if (res.status === 404) {
        setRosterEvent(null);
        setStaff([]);
        setClubPubkey(null);
        return;
      }
      const json = await res.json() as {
        clubPubkey: string;
        rosterEvent: NostrEvent;
        staff: StaffEntry[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Roster fetch failed (${res.status})`);
      setClubPubkey(json.clubPubkey);
      setRosterEvent(json.rosterEvent);
      setStaff(json.staff);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [signer]);

  useEffect(() => { refresh(); }, [refresh]);

  const publish = useCallback(async (next: StaffEntry[]) => {
    if (!signer) throw new Error('Not paired with Signet');

    const tags: string[][] = [['d', 'staff-roster']];
    for (const s of next) {
      tags.push(['p', s.pubkey, s.role, s.displayName]);
    }

    const template = {
      kind: 31920,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags,
    };
    const signed = await signer.signEvent(template) as unknown as NostrEvent;

    const fullUrl = `${window.location.origin}${API_BASE}/roster`;
    const body = { event: signed };
    const authHeader = await buildNip98AuthHeader('POST', fullUrl, body, signer);
    const res = await fetch(`${API_BASE}/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });
    const json = await res.json() as { ok?: boolean; eventId?: string; error?: string };
    if (!res.ok) throw new Error(json.error || `Publish failed (${res.status})`);
    await refresh();
    return json;
  }, [signer, refresh]);

  return { clubPubkey, rosterEvent, staff, loading, error, refresh, publish };
}

export const STAFF_ROLES: StaffRole[] = [
  'gate_steward',
  'roaming_steward',
  'safety_officer',
  'safeguarding_officer',
  'admin',
];
