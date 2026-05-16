/**
 * useInvite — officer-side hook for minting a staff invite QR and watching
 * its lifecycle (pending → accepted → consumed | expired) over SSE.
 *
 * The lib's `createInvite` takes a raw NIP-98 bearer string. `useAuth` does
 * not expose a persistent bearer (every request signs a fresh kind-27235),
 * so the hook builds one here via `buildNip98AuthHeader` and strips the
 * "Nostr " prefix before handing it to the lib.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  createInvite,
  cancelInvite,
  subscribeToInvite,
  type InviteRole,
  type InviteEvent,
  type InviteMintResponse,
} from '../lib/invites';
import { buildNip98AuthHeader } from '../lib/nip98';
import { useAuth } from './useAuth';

export interface InviteState {
  invite: InviteMintResponse | null;
  status: 'idle' | 'pending' | 'accepted' | 'consumed' | 'expired' | 'error';
  personaPubkey?: string;
  displayName?: string;
  error?: string;
  /**
   * Set to true if the SSE stream entered the CLOSED state (browser gave up
   * reconnecting after server restart / sustained network drop). The hook
   * does NOT auto-retry — the consumer's UI should show a banner and prompt
   * a refresh. Stays false while EventSource is auto-recovering from
   * transient errors.
   */
  connectionLost?: boolean;
}

export interface AcceptedInvite {
  token_hash: string;
  club_pubkey: string;
  role: InviteRole;
  display_name?: string;
  persona_pubkey: string;
  accepted_at: number;
  staff_expires_at?: number;
  status: 'accepted';
}

/**
 * Poll GET /api/gate/invites/accepted every 5 s and return the current queue
 * of accepted-but-unconsumed invites for the requester's club. Used by the
 * Roster page's PendingAcceptancesPanel so an admin who DIDN'T mint an invite
 * can still see (and sign) it. The per-invite high-frequency state lives on
 * InviteQRDisplay's SSE; this view is the lower-frequency overview.
 */
export function usePendingAcceptances(): AcceptedInvite[] {
  const { signer } = useAuth();
  const [items, setItems] = useState<AcceptedInvite[]>([]);

  useEffect(() => {
    if (!signer) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const fullUrl = `${window.location.origin}/api/gate/invites/accepted`;
        const authHeader = await buildNip98AuthHeader('GET', fullUrl, undefined, signer);
        const res = await fetch('/api/gate/invites/accepted', {
          headers: { Authorization: authHeader },
        });
        if (!res.ok) return;
        const j = await res.json() as { invites: AcceptedInvite[] };
        if (!cancelled) setItems(j.invites ?? []);
      } catch {
        /* swallow — next tick retries */
      }
    };
    void poll();
    const i = setInterval(() => { void poll(); }, 5000);
    return () => { cancelled = true; clearInterval(i); };
  }, [signer]);

  return items;
}

export function useInvite() {
  const { signer } = useAuth();
  const [state, setState] = useState<InviteState>({ invite: null, status: 'idle' });

  const mint = useCallback(async (params: {
    role: InviteRole;
    displayName?: string;
    staffExpiresAt?: number;
  }) => {
    if (!signer) {
      setState({ invite: null, status: 'error', error: 'not signed in' });
      return;
    }
    setState({ invite: null, status: 'idle' });
    try {
      const fullUrl = `${window.location.origin}/api/gate/invites`;
      const body = {
        role: params.role,
        display_name: params.displayName,
        staff_expires_at: params.staffExpiresAt,
      };
      const authHeader = await buildNip98AuthHeader('POST', fullUrl, body, signer);
      // buildNip98AuthHeader returns "Nostr <b64>"; the lib re-adds the prefix.
      const bearer = authHeader.startsWith('Nostr ') ? authHeader.slice(6) : authHeader;
      const invite = await createInvite({ ...params, bearer });
      setState({ invite, status: 'pending' });
    } catch (err) {
      setState({ invite: null, status: 'error', error: (err as Error).message });
    }
  }, [signer]);

  useEffect(() => {
    if (!state.invite || state.status === 'consumed' || state.status === 'expired') return;
    const close = subscribeToInvite(
      state.invite.invite_token,
      (e: InviteEvent) => {
        if (e.type === 'accepted') {
          setState(s => ({
            ...s,
            status: 'accepted',
            personaPubkey: e.persona_pubkey,
            displayName: e.display_name,
            connectionLost: false,
          }));
        } else if (e.type === 'consumed') {
          setState(s => ({ ...s, status: 'consumed', connectionLost: false }));
        } else if (e.type === 'expired') {
          setState(s => ({ ...s, status: 'expired', connectionLost: false }));
        }
      },
      (err) => {
        // EventSource.CLOSED === 2. CONNECTING (0) means it'll auto-retry —
        // don't surface that. Only flip the flag on terminal CLOSED.
        if (err.readyState === 2) {
          setState(s => ({ ...s, connectionLost: true }));
        }
      },
    );
    return close;
  }, [state.invite, state.status]);

  // Manual cancel — hits DELETE /api/gate/invites/:token then resets hook
  // state to idle so the UI returns to a clean slate. Caller (the QR card's
  // Cancel button) is expected to close its own modal AFTER this resolves.
  const cancel = useCallback(async () => {
    if (!signer || !state.invite) return;
    try {
      const token = state.invite.invite_token;
      const fullUrl = `${window.location.origin}/api/gate/invites/${token}`;
      const authHeader = await buildNip98AuthHeader('DELETE', fullUrl, undefined, signer);
      const bearer = authHeader.startsWith('Nostr ') ? authHeader.slice(6) : authHeader;
      await cancelInvite(token, bearer);
      setState({ invite: null, status: 'idle' });
    } catch (err) {
      setState(s => ({ ...s, status: 'error', error: (err as Error).message }));
    }
  }, [signer, state.invite]);

  return { state, mint, cancel };
}
