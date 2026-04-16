import { Router } from 'express';
import { verifyVenueEntry } from '../venue-entry.js';

// Replay prevention for venue entry events (60s TTL)
const MAX_CONSUMED_SCANS = 10_000;
const consumedScans = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [id, ts] of consumedScans) {
    if (ts < cutoff) consumedScans.delete(id);
  }
}, 15_000);

export function _resetScanCache() {
  consumedScans.clear();
}

export default function createScanRouter({ chainTipCache, scanTracker }, opts = {}) {
  const router = Router();

  router.post('/', (req, res) => {
    const { venue_entry_event } = req.body;
    if (!venue_entry_event) {
      return res.status(400).json({ error: 'venue_entry_event required' });
    }

    let entry;
    try {
      entry = verifyVenueEntry(venue_entry_event, opts);
    } catch (err) {
      return res.status(400).json({ decision: 'red', error: err.message });
    }

    // Validate event ID (mandatory)
    const eventId = venue_entry_event.id;
    if (!eventId || typeof eventId !== 'string' || !/^[0-9a-f]{64}$/.test(eventId)) {
      return res.status(400).json({ decision: 'red', error: 'Missing or invalid event ID' });
    }

    // Replay check
    if (consumedScans.has(eventId)) {
      return res.status(400).json({ decision: 'red', error: 'QR already scanned' });
    }
    if (consumedScans.size >= MAX_CONSUMED_SCANS) {
      return res.status(429).json({ decision: 'red', error: 'Too many scan requests' });
    }
    consumedScans.set(eventId, Date.now());

    // Duplicate admission check
    const gate = req.body.gate_id || null;
    if (gate && (typeof gate !== 'string' || gate.length > 50)) {
      return res.status(400).json({ error: 'gate_id must be a string under 50 characters' });
    }
    const staffId = req.staff?.pubkey || 'anonymous';
    const dupCheck = scanTracker.checkAndRecord(entry.pubkey, gate, staffId);

    if (dupCheck?.duplicate) {
      scanTracker.recordResult('red');
      return res.json({
        decision: 'red', fanPubkey: entry.pubkey,
        reason: 'Duplicate admission — flagged for review', duplicate: true,
      });
    }

    // Look up fan status from chain tip cache
    const tip = chainTipCache.get(entry.pubkey);

    if (!tip) {
      scanTracker.recordResult('amber');
      return res.json({
        decision: 'amber', fanPubkey: entry.pubkey, status: 0,
        reason: 'First visit — not yet in chain cache', firstTime: true,
        x: entry.x, blossom: entry.blossom, photoKey: entry.photoKey,
      });
    }

    // 0=clean, 1=yellow, 2=red, 3=banned
    let decision, reason = null;
    if (tip.status === 3) { decision = 'red'; reason = 'Banned'; }
    else if (tip.status === 2) { decision = 'red'; reason = 'Active red card or suspension'; }
    else if (tip.status === 1) { decision = 'amber'; reason = 'Yellow card'; }
    else { decision = 'green'; }

    scanTracker.recordResult(decision);

    return res.json({
      decision, fanPubkey: entry.pubkey, status: tip.status, reason,
      x: entry.x, blossom: entry.blossom, photoKey: entry.photoKey,
    });
  });

  return router;
}
