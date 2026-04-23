/**
 * useStaff — officer read-only view of the roster + today's per-steward scan
 * counts. Fetched from GET /api/gate/staff (officer-role-guarded).
 */
import { useCallback, useEffect, useState } from 'react';
import { buildNip98AuthHeader, type Nip98Signer } from '../lib/nip98';
import type { Role } from '../types';

const API_BASE = '/api/gate';

export interface StaffStats {
  green: number;
  amber: number;
  red: number;
  total: number;
}

export interface StaffMemberView {
  pubkey: string;
  role: Role;
  displayName: string | null;
  /** Unix-seconds expiry; null = permanent. */
  expiresAt: number | null;
  scans: StaffStats;
}

export function useStaff(signer: Nip98Signer | null) {
  const [staff, setStaff] = useState<StaffMemberView[]>([]);
  const [date, setDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signer) return;
    setLoading(true);
    setError(null);
    try {
      const fullUrl = `${window.location.origin}${API_BASE}/staff`;
      const authHeader = await buildNip98AuthHeader('GET', fullUrl, undefined, signer);
      const res = await fetch(`${API_BASE}/staff`, { headers: { Authorization: authHeader } });
      const json = await res.json() as {
        staff?: StaffMemberView[]; date?: string; error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Staff fetch failed (${res.status})`);
      setStaff(json.staff ?? []);
      setDate(json.date ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [signer]);

  useEffect(() => { refresh(); }, [refresh]);

  return { staff, date, loading, error, refresh };
}
