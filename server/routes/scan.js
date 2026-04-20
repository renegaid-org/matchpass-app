import { Router } from 'express';
import { verifyVenueEntry } from '../venue-entry.js';
import {
  SUB_STATES,
  subStateForVerifyError,
  subStateForStatus,
  reasonForSubState,
} from '../constants.js';

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

function respond(res, { status = 200, decision, sub_state, fanPubkey, entry, extra = {} }) {
  const body = {
    decision,
    sub_state,
    reason: reasonForSubState(sub_state),
    ...(fanPubkey ? { fanPubkey } : {}),
    ...(entry ? { x: entry.x, blossom: entry.blossom, photoKey: entry.photoKey } : {}),
    ...extra,
  };
  return res.status(status).json(body);
}

export default function createScanRouter({ chainTipCache, scanTracker }, opts = {}) {
  const router = Router();

  router.post('/', (req, res) => {
    const { venue_entry_event } = req.body;
    if (!venue_entry_event) {
      return respond(res, {
        status: 400,
        decision: 'red',
        sub_state: SUB_STATES.QR_NOT_VENUE_ENTRY,
        extra: { error: 'venue_entry_event required' },
      });
    }

    let entry;
    try {
      entry = verifyVenueEntry(venue_entry_event, opts);
    } catch (err) {
      return respond(res, {
        status: 400,
        decision: 'red',
        sub_state: subStateForVerifyError(err.message),
        extra: { error: err.message },
      });
    }

    // Validate event ID (mandatory)
    const eventId = venue_entry_event.id;
    if (!eventId || typeof eventId !== 'string' || !/^[0-9a-f]{64}$/.test(eventId)) {
      return respond(res, {
        status: 400,
        decision: 'red',
        sub_state: SUB_STATES.QR_INVALID_SIGNATURE,
        extra: { error: 'Missing or invalid event ID' },
      });
    }

    // Replay check
    if (consumedScans.has(eventId)) {
      return respond(res, {
        status: 400,
        decision: 'red',
        sub_state: SUB_STATES.QR_EXPIRED,
        fanPubkey: entry.pubkey,
        entry,
        extra: { error: 'QR already scanned' },
      });
    }
    if (consumedScans.size >= MAX_CONSUMED_SCANS) {
      return respond(res, {
        status: 429,
        decision: 'red',
        sub_state: SUB_STATES.QR_INVALID_SIGNATURE,
        extra: { error: 'Too many scan requests' },
      });
    }
    consumedScans.set(eventId, Date.now());

    // Validate gate_id shape
    const gate = req.body.gate_id || null;
    if (gate && (typeof gate !== 'string' || gate.length > 50)) {
      return res.status(400).json({ error: 'gate_id must be a string under 50 characters' });
    }
    const staffId = req.staff?.pubkey || 'anonymous';
    const dupCheck = scanTracker.checkAndRecord(entry.pubkey, gate, staffId);

    if (dupCheck?.duplicate) {
      scanTracker.recordResult('red');
      return respond(res, {
        decision: 'red',
        sub_state: SUB_STATES.DUPLICATE_ADMISSION,
        fanPubkey: entry.pubkey,
        entry,
        extra: { duplicate: true },
      });
    }

    // Chain-tip lookup
    const tip = chainTipCache.get(entry.pubkey);

    if (!tip) {
      scanTracker.recordResult('amber');
      return respond(res, {
        decision: 'amber',
        sub_state: SUB_STATES.FIRST_VISIT,
        fanPubkey: entry.pubkey,
        entry,
        extra: { status: 0, firstTime: true },
      });
    }

    // 0=clean, 1=yellow, 2=red, 3=banned
    const sub_state = subStateForStatus(tip.status);
    let decision;
    if (tip.status === 3 || tip.status === 2) decision = 'red';
    else if (tip.status === 1) decision = 'amber';
    else decision = 'green';

    scanTracker.recordResult(decision);

    return respond(res, {
      decision,
      sub_state,
      fanPubkey: entry.pubkey,
      entry,
      extra: { status: tip.status },
    });
  });

  return router;
}
