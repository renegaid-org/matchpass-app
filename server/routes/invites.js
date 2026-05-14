// server/routes/invites.js — Staff QR invite mint endpoint
// POST /api/gate/invites mints an invite record (via the in-memory invite
// cache) and returns a QR-ready Signet auth URL. The SSE subscription and
// /staff/accept routes are added in subsequent tasks; this file currently
// owns only the mint path.

import { Router } from 'express';
import { checkAuthority } from '../invite-cache.js';

const RELAY_URL = process.env.RELAY_URL || 'wss://relay.trotters.cc';

function buildQrPayload({ gateHost, inviteToken, sessionPubkey, authChallenge }) {
  const url = new URL('https://mysignet.app/');
  url.searchParams.set('auth', '1');
  url.searchParams.set('relay', RELAY_URL);
  url.searchParams.set('origin', gateHost);
  url.searchParams.set('name', 'MatchPass');
  url.searchParams.set('callback', `${gateHost}/api/gate/auth-result`);
  url.searchParams.set('challenge', authChallenge);
  url.searchParams.set('sessionPubkey', sessionPubkey);
  url.searchParams.set('t', String(Math.floor(Date.now() / 1000)));
  url.searchParams.set('accept', 'persona');
  url.searchParams.set('post', `${gateHost}/staff/accept?invite=${inviteToken}`);
  return url.toString();
}

export default function createInvitesRouter({ cache, onMint = () => {}, gateHost }) {
  const router = Router();

  router.post('/', (req, res) => {
    const { role, staff_expires_at, display_name } = req.body || {};
    if (!role) return res.status(400).json({ error: 'role required' });

    try {
      checkAuthority({
        inviterRole: req.staff.role,
        invitedRole: role,
        staffExpiresAt: staff_expires_at,
      });
    } catch (err) {
      const msg = err.message;
      const status =
        msg.includes('staffExpiresAt required') || msg.includes('within 24 hours') ? 400 : 403;
      return res.status(status).json({ error: msg });
    }

    const minted = cache.mint({
      clubPubkey: req.staff.clubPubkey,
      inviterPubkey: req.staff.pubkey,
      role,
      displayName: display_name,
      staffExpiresAt: staff_expires_at,
    });

    const qr_payload = buildQrPayload({
      gateHost,
      inviteToken: minted.invite_token,
      sessionPubkey: minted.session_pubkey,
      authChallenge: minted.auth_challenge,
    });

    // Defence-in-depth: belt-and-braces same-origin check on the `post` URL we
    // just baked into the QR. If gateHost is ever misconfigured (e.g. a typo,
    // protocol-relative slip, or attacker-injected header) we'd rather fail
    // the mint than hand the fan a QR that exfiltrates their auth flow.
    const postUrl = new URL(qr_payload).searchParams.get('post');
    if (!postUrl || new URL(postUrl).origin !== gateHost) {
      return res.status(500).json({ error: 'post URL same-origin invariant failed' });
    }

    onMint(minted.invite_token);

    return res.status(201).json({
      invite_token: minted.invite_token,
      qr_payload,
      pending_expires_at: minted.pending_expires_at,
    });
  });

  return router;
}
