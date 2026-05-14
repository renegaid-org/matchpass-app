// server/invite-handler.js — Glue layer between the kind-1059 gift-wrap
// relay subscription (server/relay.js) and the invite cache.
//
// The relay's gift-wrap REQ delivers one kind-1059 per Signet auth
// response. Each wrap carries a `['p', sessionPubkey]` tag naming the
// matchpass session that response is for. This handler:
//
//   1. Filters out everything that isn't a kind-1059 with a `p` tag.
//   2. Looks the recipient up in the cache; if no invite is waiting
//      on that session pubkey (or the invite is no longer pending),
//      drops the event silently — production relays will fan out
//      stale wraps and we shouldn't log noise for them.
//   3. Calls unwrapAuthResponse to verify the seal, the inner
//      kind-21236 signature, the persona-vs-seal pubkey binding, and
//      the challenge match.
//   4. On success, calls cache.acceptBySessionPubkey to flip the
//      invite to "accepted" and pin the persona pubkey to it. That
//      method also returns a token hash which the handler hands to
//      the onAccept callback so the SSE layer can fan out to the
//      inviter without ever seeing the plaintext token.
//
// Failures are returned by unwrapAuthResponse (not thrown), so this
// handler logs them at info level and keeps running. The relay
// subscription in server/relay.js already wraps the call in
// Promise.resolve(...).catch so any throw here is logged but does
// not kill the subscription.

import { unwrapAuthResponse } from './invite-unwrap.js';

const KIND_GIFT_WRAP = 1059;

export function createInviteHandler({ cache, onAccept = () => {} }) {
  return async function handleGiftWrap(event) {
    if (!event || event.kind !== KIND_GIFT_WRAP) return;

    // The `p` tag tells us which session pubkey this wrap is addressed to.
    const recipient = event.tags?.find(t => Array.isArray(t) && t[0] === 'p')?.[1];
    if (!recipient) return;

    const rec = cache.getBySessionPubkey(recipient);
    if (!rec || rec.status !== 'pending') return;

    const result = await unwrapAuthResponse({
      wrap: event,
      sessionPrivkey: rec.session_privkey,
      expectedChallenge: rec.auth_challenge,
    });

    if (!result.ok) {
      console.log(`Invite unwrap failed: ${result.error} (session=${recipient.slice(0, 8)}...)`);
      return;
    }

    try {
      const tokenHash = cache.acceptBySessionPubkey(recipient, result.personaPubkey);
      if (tokenHash) onAccept(tokenHash, result);
    } catch (err) {
      console.log(`Invite accept rejected: ${err.message}`);
    }
  };
}
