import { useCallback, useEffect, useState } from 'react';
import { buildNip98AuthHeader, type Nip98Signer } from '../lib/nip98';

const API_BASE = '/api/gate';

export interface DuplicateFlag {
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
}

export function useFlags(signer: Nip98Signer | null) {
  const [flags, setFlags] = useState<DuplicateFlag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signer) return;
    setLoading(true);
    setError(null);
    try {
      const fullUrl = `${window.location.origin}${API_BASE}/flags`;
      const authHeader = await buildNip98AuthHeader('GET', fullUrl, undefined, signer);
      const res = await fetch(`${API_BASE}/flags`, { headers: { Authorization: authHeader } });
      const json = (await res.json()) as { flags: DuplicateFlag[]; error?: string };
      if (!res.ok) throw new Error(json.error || `Flags fetch failed (${res.status})`);
      setFlags(json.flags || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [signer]);

  const dismiss = useCallback(async (id: string, note: string) => {
    if (!signer) return;
    const fullUrl = `${window.location.origin}${API_BASE}/flags/${id}/dismiss`;
    const body = { note };
    const authHeader = await buildNip98AuthHeader('POST', fullUrl, body, signer);
    const res = await fetch(`${API_BASE}/flags/${id}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Dismiss failed (${res.status})`);
    await refresh();
  }, [signer, refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  return { flags, loading, error, refresh, dismiss };
}
