import { useCallback, useEffect, useState } from 'react';
import { db, type PendingEventRecord } from '../lib/db';
import { buildNip98AuthHeader, type Nip98Signer } from '../lib/nip98';
import type { NostrEvent } from '../types';

const API_BASE = '/api/gate';

/**
 * Offline publish queue for signed chain events.
 *
 * Use `queue(signedEvent)` when a network publish fails — the event is
 * stored in IndexedDB and retried whenever `flush()` runs (on
 * `online` event or a manual reconnect nudge). The queue preserves
 * insertion order: events are drained oldest-first and a failure
 * aborts the rest of the drain so a later event never reaches the
 * server before an earlier one.
 */
export function useOfflineQueue(signer: Nip98Signer | null) {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [queueSize, setQueueSize] = useState(0);
  const [flushing, setFlushing] = useState(false);

  const refreshSize = useCallback(async () => {
    const d = await db();
    const count = await d.count('pendingEvents');
    setQueueSize(count);
  }, []);

  useEffect(() => { refreshSize(); }, [refreshSize]);

  const queue = useCallback(async (event: NostrEvent) => {
    const d = await db();
    const rec: PendingEventRecord = {
      id: event.id,
      event,
      queuedAt: Date.now(),
    };
    await d.put('pendingEvents', rec);
    await refreshSize();
  }, [refreshSize]);

  const flush = useCallback(async (): Promise<{ sent: number; remaining: number }> => {
    if (!signer) return { sent: 0, remaining: queueSize };
    const d = await db();
    const items = ((await d.getAll('pendingEvents')) as PendingEventRecord[]).sort(
      (a, b) => a.queuedAt - b.queuedAt,
    );
    let sent = 0;
    setFlushing(true);
    try {
      for (const item of items) {
        const fullUrl = `${window.location.origin}${API_BASE}/event`;
        const body = { event: item.event };
        const authHeader = await buildNip98AuthHeader('POST', fullUrl, body, signer);
        const res = await fetch(`${API_BASE}/event`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: authHeader },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          await d.delete('pendingEvents', item.id);
          sent++;
          continue;
        }
        if (res.status === 409) {
          // Chain-tip mismatch — the event was built against an older
          // tip. Drop it from the queue; the caller needs to re-build.
          // Callers who care about this should re-queue fresh.
          await d.delete('pendingEvents', item.id);
          sent++;
          continue;
        }
        // Any other failure stops the drain so ordering is preserved.
        break;
      }
    } finally {
      setFlushing(false);
      await refreshSize();
    }
    const d2 = await db();
    const remaining = await d2.count('pendingEvents');
    return { sent, remaining };
  }, [signer, queueSize, refreshSize]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const goOnline = () => {
      setOnline(true);
      flush().catch(err => console.warn('Offline queue flush failed', err));
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [flush]);

  return { online, queueSize, flushing, queue, flush };
}
