import { useCallback, useEffect, useState } from 'react';
import { buildNip98AuthHeader, type Nip98Signer } from '../lib/nip98';
import type { NostrEvent } from '../types';

const API_BASE = '/api/gate';

export interface ChainFetchResult {
  fanPubkey: string;
  events: NostrEvent[];
  tip: string;
  length: number;
  valid: boolean;
  errors: string[];
  status: number;
  statusName: string;
  activeCards: Array<{ id: string; cardType: string; category: string; createdAt: number }>;
  activeSanctions: Array<{
    id: string;
    sanctionType: string;
    reason: string | null;
    startDate: string;
    endDate: string | null;
    createdAt: number;
  }>;
}

/**
 * Fetch a fan's full credential chain from the gate server.
 *
 * The server walks the relay, verifies signatures and chain linkage,
 * and returns events in order plus the computed status. Used by the
 * officer UI to inspect history and by the PWA to reconcile after a
 * 409 chain-tip mismatch.
 */
export function useChain(signer: Nip98Signer | null, fanPubkey: string | null) {
  const [data, setData] = useState<ChainFetchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!signer || !fanPubkey) return;
    setLoading(true);
    setError(null);
    try {
      const url = `${window.location.origin}${API_BASE}/chain/${fanPubkey}`;
      const authHeader = await buildNip98AuthHeader('GET', url, undefined, signer);
      const res = await fetch(`${API_BASE}/chain/${fanPubkey}`, {
        headers: { Authorization: authHeader },
      });
      const json = (await res.json()) as ChainFetchResult & { error?: string };
      if (!res.ok) {
        if (res.status === 404) {
          setData(null);
          return;
        }
        throw new Error(json.error || `Chain fetch failed (${res.status})`);
      }
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [signer, fanPubkey]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}
