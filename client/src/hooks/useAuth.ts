/**
 * Top-level auth hook — holds the NIP-46 client, exposes pairing state,
 * signer, and logout. Restores a session from IndexedDB on mount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Nip46Client, type PairingStatus } from '../lib/nip46';
import { loadSession, saveSession, clearSession } from '../lib/db';

const DEFAULT_RELAY = 'wss://relay.trotters.cc';

export function useAuth() {
  const clientRef = useRef<Nip46Client | null>(null);
  const [status, setStatus] = useState<PairingStatus>({ kind: 'idle' });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadSession();
      if (cancelled) return;
      if (saved) {
        const client = new Nip46Client({
          relayUrl: saved.relayUrl,
          existing: {
            sessionSecretHex: saved.sessionSecretHex,
            remotePubkey: saved.remotePubkey,
            relayUrl: saved.relayUrl,
          },
        });
        const off = client.onStatus(setStatus);
        await client.start().catch(err => {
          console.warn('Could not reconnect saved session', err);
          setStatus({ kind: 'error', message: (err as Error).message });
        });
        clientRef.current = client;
        setReady(true);
        return () => off();
      }
      setReady(true);
      return;
    })();
    return () => { cancelled = true; };
  }, []);

  const startPairing = useCallback(async (relayUrl = DEFAULT_RELAY) => {
    clientRef.current?.disconnect();
    const client = new Nip46Client({ relayUrl });
    client.onStatus(async (s) => {
      setStatus(s);
      if (s.kind === 'connected') {
        await saveSession({
          sessionSecretHex: client.sessionSecretHex,
          remotePubkey: s.remotePubkey,
          relayUrl: client.relayUrl,
          pairedAt: Date.now(),
        });
      }
    });
    await client.start();
    clientRef.current = client;
  }, []);

  const unpair = useCallback(async () => {
    clientRef.current?.forget();
    clientRef.current = null;
    await clearSession();
    setStatus({ kind: 'idle' });
  }, []);

  const signer = status.kind === 'connected' && clientRef.current
    ? {
        signEvent: (template: { kind: number; created_at: number; tags: string[][]; content: string }) =>
          clientRef.current!.signEvent(template),
      }
    : null;

  return {
    ready,
    status,
    signer,
    remotePubkey: status.kind === 'connected' ? status.remotePubkey : null,
    startPairing,
    unpair,
  };
}
