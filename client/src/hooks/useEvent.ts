/**
 * Publish a signed chain event to matchpass-gate with chain-tip retry.
 *
 * Flow:
 *   1. Fetch tip via GET /api/gate/tip/:pubkey (unless caller provides it)
 *   2. Caller builds template with previous=tip
 *   3. We sign via NIP-46
 *   4. POST /api/gate/event
 *   5. On 409, re-fetch tip, rebuild template (caller-provided builder),
 *      re-sign, retry. Max 3 attempts.
 */

import { useCallback } from 'react';
import { buildNip98AuthHeader, type Nip98Signer } from '../lib/nip98';
import { db, type PendingEventRecord } from '../lib/db';
import type { EventTemplate, NostrEvent } from '../types';

const API_BASE = '/api/gate';

export interface PublishOptions {
  /** Builder that produces an event template given the current chain tip. */
  build: (tip: string | null) => EventTemplate;
  /** Fan pubkey to look up the tip for. Pass null for events without a previous (membership). */
  fanPubkey: string | null;
  /** Upper retry bound for 409 chain-tip mismatches. */
  maxRetries?: number;
}

export interface PublishResult {
  event: NostrEvent;
  status: number;
  body: { ok?: boolean; eventId?: string; error?: string };
  queued?: boolean;
}

async function fetchTip(pubkey: string, signer: Nip98Signer): Promise<string | null> {
  const url = `${window.location.origin}${API_BASE}/tip/${pubkey}`;
  const authHeader = await buildNip98AuthHeader('GET', url, undefined, signer);
  const res = await fetch(`${API_BASE}/tip/${pubkey}`, {
    headers: { Authorization: authHeader },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Tip lookup failed (${res.status})`);
  const body = (await res.json()) as { tipEventId: string };
  return body.tipEventId;
}

export function useEvent(signer: Nip98Signer | null) {
  const publish = useCallback(async (opts: PublishOptions): Promise<PublishResult> => {
    if (!signer) throw new Error('Not paired with Signet');
    const maxRetries = opts.maxRetries ?? 3;

    let attempt = 0;
    let lastError: { currentTip?: string; error: string } | null = null;

    while (attempt < maxRetries) {
      attempt += 1;
      const tip = opts.fanPubkey ? await fetchTip(opts.fanPubkey, signer) : null;
      const template = opts.build(tip);
      const signed = await signer.signEvent(template) as unknown as NostrEvent;

      const fullUrl = `${window.location.origin}${API_BASE}/event`;
      const body = { event: signed };
      const authHeader = await buildNip98AuthHeader('POST', fullUrl, body, signer);
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/event`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        // Network failure — queue the signed event for later flush.
        // NB: we only queue events that don't depend on a chain-tip we
        // haven't confirmed; caller controls this via fanPubkey.
        const d = await db();
        const rec: PendingEventRecord = { id: signed.id, event: signed, queuedAt: Date.now() };
        await d.put('pendingEvents', rec);
        return { event: signed, status: 0, body: { error: (err as Error).message }, queued: true };
      }
      const resBody = await res.json() as { ok?: boolean; eventId?: string; error?: string; currentTip?: string };

      if (res.ok) {
        return { event: signed, status: res.status, body: resBody };
      }
      if (res.status === 409 && resBody.error === 'chain_tip_mismatch') {
        lastError = { currentTip: resBody.currentTip, error: resBody.error };
        // Backoff and retry with fresh tip.
        await new Promise(r => setTimeout(r, 300 * attempt));
        continue;
      }
      throw new Error(resBody.error || `Publish failed (${res.status})`);
    }
    throw new Error(`Chain tip mismatch after ${maxRetries} attempts (currentTip=${lastError?.currentTip})`);
  }, [signer]);

  return { publish };
}
