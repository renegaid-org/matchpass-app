// server/routes/chain.js — Credential chain API routes

import { Router } from 'express';
import { query } from '../db.js';
import { verifyQRProof, isProofFresh, verifyChain, getCurrentStatus, EVENT_KINDS, STATUS, isValidPubkey } from '../chain/index.js';

const router = Router();

/**
 * POST /api/chain/verify-qr
 *
 * Accepts a QR proof from a fan's Signet app, verifies the Schnorr signature,
 * checks the chain tip against the club's cached tip, and returns a gate decision.
 *
 * Body: { proof: "<base64-encoded-proof>" }
 * Returns: { decision: "green"|"amber"|"red", fanPubkey, status, reason? }
 */
router.post('/verify-qr', async (req, res) => {
  const { proof } = req.body;
  if (!proof || typeof proof !== 'string') {
    return res.status(400).json({ error: 'proof field required (base64 string)' });
  }

  // Decode and verify the Schnorr signature
  const decoded = verifyQRProof(proof);
  if (!decoded.valid) {
    return res.status(400).json({ decision: 'red', error: decoded.error });
  }

  // Freshness check (30 seconds)
  if (!isProofFresh(decoded)) {
    return res.status(400).json({
      decision: 'red',
      fanPubkey: decoded.fanPubkey,
      error: 'QR proof is stale',
    });
  }

  // Status check: if the fan claims banned, reject outright
  if (decoded.status === STATUS.BANNED) {
    return res.json({
      decision: 'red',
      fanPubkey: decoded.fanPubkey,
      status: decoded.status,
      reason: 'Fan is banned',
    });
  }

  // Look up the cached chain tip for this fan
  try {
    const tipResult = await query(
      'SELECT tip_event_id, tip_status FROM chain_tips WHERE fan_pubkey = $1',
      [decoded.fanPubkey]
    );

    if (tipResult.rows.length === 0) {
      // First-time visitor: let them in, verify chain from relay in the background
      return res.json({
        decision: 'green',
        fanPubkey: decoded.fanPubkey,
        status: decoded.status,
        reason: 'First-time visitor — background verification pending',
        firstTime: true,
      });
    }

    const cached = tipResult.rows[0];

    // Compare chain tips
    if (decoded.chainTip === cached.tip_event_id) {
      // Tips match: use the cached status (more trustworthy than self-reported)
      const cachedStatus = cached.tip_status;
      let decision = 'green';
      if (cachedStatus === STATUS.BANNED) decision = 'red';
      else if (cachedStatus === STATUS.RED) decision = 'red';
      else if (cachedStatus === STATUS.YELLOW) decision = 'amber';

      return res.json({
        decision,
        fanPubkey: decoded.fanPubkey,
        status: cachedStatus,
      });
    }

    // Tips differ: the fan's chain has moved since last sync
    // Amber — steward should check, background sync will update
    return res.json({
      decision: 'amber',
      fanPubkey: decoded.fanPubkey,
      status: decoded.status,
      reason: 'Chain tip mismatch — background sync required',
      stale: true,
    });

  } catch (err) {
    console.error('Chain tip lookup failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/chain/:pubkey
 *
 * Returns the chain tip and status for a fan (dashboard/admin use).
 */
router.get('/:pubkey', async (req, res) => {
  const { pubkey } = req.params;
  if (!isValidPubkey(pubkey)) {
    return res.status(400).json({ error: 'Invalid pubkey format' });
  }

  try {
    const tipResult = await query(
      'SELECT tip_event_id, tip_status, last_seen FROM chain_tips WHERE fan_pubkey = $1',
      [pubkey]
    );

    if (tipResult.rows.length === 0) {
      return res.status(404).json({ error: 'Fan not found in chain tips' });
    }

    const row = tipResult.rows[0];
    const statusNames = { [STATUS.CLEAN]: 'clean', [STATUS.YELLOW]: 'yellow', [STATUS.RED]: 'red', [STATUS.BANNED]: 'banned' };

    return res.json({
      fanPubkey: pubkey,
      tipEventId: row.tip_event_id,
      status: row.tip_status,
      statusName: statusNames[row.tip_status] || 'unknown',
      lastSeen: row.last_seen,
    });
  } catch (err) {
    console.error('Chain tip fetch failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/chain/sync
 *
 * Accepts an array of chain events from a relay fetch (background sync).
 * Validates the chain, stores signed events that this club authored,
 * and updates the chain tip.
 *
 * Body: { events: [<nostr-event>, ...] }
 * Returns: { valid, tip, status, stored }
 */
router.post('/sync', async (req, res) => {
  const { events } = req.body;
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'events array required' });
  }

  // Verify the chain
  const chainResult = verifyChain(events);
  if (!chainResult.valid) {
    return res.status(400).json({
      error: 'Chain verification failed',
      details: chainResult.errors,
    });
  }

  // Compute current status
  const statusResult = getCurrentStatus(events);

  // Extract fan pubkey from the first event's p tag
  const firstEvent = events[0];
  const pTag = firstEvent.tags.find(t => Array.isArray(t) && t[0] === 'p');
  if (!pTag || !isValidPubkey(pTag[1])) {
    return res.status(400).json({ error: 'Cannot determine fan pubkey from chain' });
  }
  const fanPubkey = pTag[1];

  try {
    // Update the chain tip
    await query(
      `INSERT INTO chain_tips (fan_pubkey, tip_event_id, tip_status, last_seen)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (fan_pubkey)
       DO UPDATE SET tip_event_id = $2, tip_status = $3, last_seen = NOW()`,
      [fanPubkey, chainResult.tip, statusResult.status]
    );

    // Store signed events (all of them — the club needs copies for legal defence)
    let stored = 0;
    for (const event of events) {
      try {
        await query(
          `INSERT INTO signed_events (event_id, kind, fan_pubkey, content, created_at)
           VALUES ($1, $2, $3, $4, to_timestamp($5))
           ON CONFLICT (event_id) DO NOTHING`,
          [event.id, event.kind, fanPubkey, JSON.stringify(event), event.created_at]
        );
        stored++;
      } catch (storeErr) {
        // Skip duplicates, log other errors
        if (!storeErr.message.includes('duplicate')) {
          console.error('Failed to store event:', storeErr.message);
        }
      }
    }

    return res.json({
      valid: true,
      tip: chainResult.tip,
      status: statusResult.status,
      statusName: statusResult.statusName,
      length: chainResult.length,
      stored,
    });
  } catch (err) {
    console.error('Chain sync failed:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
