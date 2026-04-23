/**
 * useDashboard — today's aggregate scan counts + duplicate-flag list from
 * GET /api/gate/dashboard. Server returns ephemeral data that resets at
 * midnight; this hook polls on mount and on the refresh trigger.
 */
import { useCallback, useEffect, useState } from 'react';
import { buildNip98AuthHeader, type Nip98Signer } from '../lib/nip98';

const API_BASE = '/api/gate';

export interface DashboardStats {
  date: string;
  scans: { green: number; amber: number; red: number; total: number };
  duplicateFlags: Array<{
    id: string;
    fanPubkey: string;
    firstGate: string | null;
    firstStaffId: string | null;
    firstTime: number;
    secondGate: string | null;
    secondStaffId: string | null;
    secondTime: number;
    dismissed: boolean;
    note: string | null;
  }>;
  cache: { fans: number; clubs: number };
}

export function useDashboard(signer: Nip98Signer | null) {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signer) return;
    setLoading(true);
    setError(null);
    try {
      const fullUrl = `${window.location.origin}${API_BASE}/dashboard`;
      const authHeader = await buildNip98AuthHeader('GET', fullUrl, undefined, signer);
      const res = await fetch(`${API_BASE}/dashboard`, { headers: { Authorization: authHeader } });
      const json = await res.json() as DashboardStats & { error?: string };
      if (!res.ok) throw new Error(json.error || `Dashboard fetch failed (${res.status})`);
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [signer]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}
