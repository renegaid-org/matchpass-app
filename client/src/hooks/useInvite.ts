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
    const close = subscribeToInvite(state.invite.invite_token, (e: InviteEvent) => {
      if (e.type === 'accepted') {
        setState(s => ({
          ...s,
          status: 'accepted',
          personaPubkey: e.persona_pubkey,
          displayName: e.display_name,
        }));
      } else if (e.type === 'consumed') {
        setState(s => ({ ...s, status: 'consumed' }));
      } else if (e.type === 'expired') {
        setState(s => ({ ...s, status: 'expired' }));
      }
    });
    return close;
  }, [state.invite, state.status]);

  return { state, mint };
}
