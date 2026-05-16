/**
 * Staff-onboarding invite client lib.
 *
 * Mints an invite via POST /api/gate/invites (NIP-98 bearer from the
 * inviting officer), then subscribes to SSE for accept/consume/expire
 * notifications. See:
 *   matchpass-prv/docs/superpowers/specs/2026-05-14-staff-onboarding-qr-invite-design.md
 *
 * The `bearer` is the raw NIP-98 token string (base64-encoded kind 27235
 * event) — the lib prefixes "Nostr " when sending. The hook layer
 * (useInvite) is responsible for producing it from the active signer.
 */

export type InviteRole =
  | 'gate_steward'
  | 'roaming_steward'
  | 'safety_officer'
  | 'safeguarding_officer'
  | 'staff_manager'
  | 'admin';

export interface CreateInviteParams {
  role: InviteRole;
  displayName?: string;
  staffExpiresAt?: number;
  bearer: string;
}

export interface InviteMintResponse {
  invite_token: string;
  qr_payload: string;
  pending_expires_at: number;
}

export type InviteEvent =
  | { type: 'accepted'; persona_pubkey: string; accepted_at: number; display_name?: string }
  | { type: 'consumed'; roster_event_id: string }
  | { type: 'expired' };

export async function createInvite(params: CreateInviteParams): Promise<InviteMintResponse> {
  const res = await fetch('/api/gate/invites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Nostr ${params.bearer}`,
    },
    body: JSON.stringify({
      role: params.role,
      display_name: params.displayName,
      staff_expires_at: params.staffExpiresAt,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<InviteMintResponse>;
}

/**
 * No-op for the pilot. Invites naturally expire after 15 minutes; a real
 * cancel route lands in a follow-up if pilot feedback demands it.
 */
export async function cancelInvite(token: string, bearer: string): Promise<void> {
  void token;
  void bearer;
}

/**
 * Open an SSE stream for invite state changes. Auth rides a path-scoped
 * cookie set by the mint response (Task 13). `withCredentials: true` is a
 * no-op until that cookie lands.
 */
export function subscribeToInvite(token: string, onEvent: (e: InviteEvent) => void): () => void {
  const es = new EventSource(`/api/gate/invites/${token}/subscribe`, { withCredentials: true });
  // Server emits frames with `event: invite`, which the EventSource spec
  // routes to a named listener — `onmessage` only fires for frames with no
  // event field, so a plain assignment would silently drop every transition.
  es.addEventListener('invite', (e: MessageEvent) => {
    try {
      onEvent(JSON.parse(e.data) as InviteEvent);
    } catch {
      /* ignore malformed */
    }
  });
  return () => es.close();
}
