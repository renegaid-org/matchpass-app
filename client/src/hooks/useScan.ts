import { useCallback } from 'react';
import { buildNip98AuthHeader, type Nip98Signer } from '../lib/nip98';
import type { ScanResult, NostrEvent } from '../types';

const API_BASE = '/api/gate';

export function useScan(signer: Nip98Signer | null) {
  const scan = useCallback(async (
    venueEntryEvent: NostrEvent,
    gateId: string | null,
  ): Promise<ScanResult> => {
    if (!signer) throw new Error('Not paired with Signet');
    const body = { venue_entry_event: venueEntryEvent, gate_id: gateId };
    const fullUrl = window.location.origin + API_BASE + '/scan';
    const authHeader = await buildNip98AuthHeader('POST', fullUrl, body, signer);
    const res = await fetch(API_BASE + '/scan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as ScanResult & { error?: string };
    if (!res.ok && !json.decision) {
      throw new Error(json.error || `Scan failed (${res.status})`);
    }
    return json;
  }, [signer]);

  return { scan };
}
