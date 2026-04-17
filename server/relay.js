import { Relay } from 'nostr-tools/relay';
import { verifyEvent } from 'nostr-tools/pure';
import { EVENT_KINDS, STAFF_ROSTER_KIND } from './chain/types.js';

let relay = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let _caches = null;
let _clubPubkeys = [];
let _relayUrl = null;

function shutdown() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (relay) { relay.close(); relay = null; }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

/**
 * Connect to the relay and subscribe to chain + roster events.
 * Populates caches from existing events, then subscribes to live updates.
 *
 * @param {string} relayUrl - e.g. wss://relay.trotters.cc
 * @param {object} caches - { chainTipCache, rosterCache }
 * @param {string[]} clubPubkeys - pubkeys of verified clubs
 */
export async function connectAndSubscribe(relayUrl, caches, clubPubkeys) {
  const { chainTipCache, rosterCache } = caches;

  // Store for reconnection
  _relayUrl = relayUrl;
  _caches = caches;
  _clubPubkeys = clubPubkeys;

  try {
    relay = await Relay.connect(relayUrl);
    console.log(`Relay: connected to ${relayUrl}`);
  } catch (err) {
    console.error(`Relay: connection failed — ${err.message}`);
    relay = null;
    return;
  }

  relay.onclose = () => {
    console.log('Relay: connection lost');
    relay = null;
    reconnect(_relayUrl);
  };

  // 1. Fetch existing roster events first (needed for signer context)
  if (clubPubkeys.length > 0) {
    const rosterEvents = await collectEvents(relay, [{ kinds: [STAFF_ROSTER_KIND], authors: clubPubkeys }]);
    for (const event of rosterEvents) {
      if (verifyEvent(event)) {
        try { rosterCache.set(event.pubkey, event); } catch (err) {
          console.error('Relay: malformed roster event, skipping:', err.message);
        }
      }
    }
    console.log(`Relay: fetched ${rosterEvents.length} roster event(s)`);
  }

  // 2. Fetch existing chain events
  const chainKinds = Object.values(EVENT_KINDS);
  const chainEvents = await collectEvents(relay, [{ kinds: chainKinds }]);
  for (const event of chainEvents) {
    if (verifyEvent(event)) handleChainEvent(event, chainTipCache, rosterCache);
  }
  console.log(`Relay: fetched ${chainEvents.length} chain event(s), ${chainTipCache.size} fan tip(s)`);

  subscribeToChainEvents(relay, caches);
  subscribeToRosterEvents(relay, rosterCache, clubPubkeys);
}

/**
 * Subscribe to live chain events.
 */
function subscribeToChainEvents(r, caches) {
  const { chainTipCache, rosterCache } = caches;
  const chainKinds = Object.values(EVENT_KINDS);
  r.subscribe(
    [{ kinds: chainKinds }],
    {
      onevent: (event) => {
        if (!verifyEvent(event)) return;
        handleChainEvent(event, chainTipCache, rosterCache);
      },
    }
  );
}

/**
 * Subscribe to live roster events.
 */
function subscribeToRosterEvents(r, rosterCache, clubPubkeys) {
  if (clubPubkeys.length === 0) return;
  r.subscribe(
    [{ kinds: [STAFF_ROSTER_KIND], authors: clubPubkeys }],
    {
      onevent: (event) => {
        if (!verifyEvent(event)) return;
        try {
          rosterCache.set(event.pubkey, event);
          console.log(`Relay: roster update from ${event.pubkey.slice(0, 12)}`);
        } catch (err) {
          console.error('Relay: malformed roster event, skipping:', err.message);
        }
      },
    }
  );
}

/**
 * Reconnect with exponential backoff (max 60s).
 */
async function reconnect(relayUrl) {
  if (reconnectTimer) return; // already scheduled
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
  reconnectAttempts++;
  console.log(`Relay: reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    try {
      relay = await Relay.connect(relayUrl);
      console.log(`Relay: reconnected to ${relayUrl}`);
      reconnectAttempts = 0;

      relay.onclose = () => {
        console.log('Relay: connection lost');
        relay = null;
        reconnect(relayUrl);
      };

      subscribeToChainEvents(relay, _caches);
      subscribeToRosterEvents(relay, _caches.rosterCache, _clubPubkeys);
    } catch (err) {
      console.error(`Relay: reconnect failed — ${err.message}`);
      relay = null;
      reconnect(relayUrl);
    }
  }, delay);
}

/**
 * Collect events from relay until EOSE or timeout (15s).
 */
function collectEvents(relay, filters, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const collected = [];
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      sub.close();
      resolve(collected);
    };
    const timeout = setTimeout(done, timeoutMs);
    const sub = relay.subscribe(filters, {
      onevent: (event) => collected.push(event),
      oneose: done,
    });
  });
}

/**
 * Handle a chain event — update the chain tip cache.
 * Uses created_at as a simple ordering heuristic.
 * Status is derived from the event kind; non-status events preserve existing status.
 *
 * Membership events (31900) are signed by the fan — accepted if signature valid.
 * All other events must be signed by a rostered staff member.
 */
function handleChainEvent(event, chainTipCache, rosterCache) {
  // Reject events with created_at more than 10 minutes in the future
  const now = Math.floor(Date.now() / 1000);
  if (event.created_at > now + 600) return;

  // Signer authority check: non-membership events must come from rostered staff
  if (event.kind !== EVENT_KINDS.MEMBERSHIP) {
    const staff = rosterCache?.findStaff(event.pubkey);
    if (!staff) return; // Signer not in any club roster — reject silently
  }

  const pTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'p');
  if (!pTag || !pTag[1]) return;
  const fanPubkey = pTag[1];

  const existing = chainTipCache.get(fanPubkey);
  // Only update if newer (by created_at). Full chain walk happens at sync time.
  if (existing && existing._createdAt && event.created_at <= existing._createdAt) return;

  // Derive status from event kind
  let status = 0;
  if (event.kind === EVENT_KINDS.CARD) {
    const cardType = event.tags?.find(t => t[0] === 'card_type')?.[1];
    if (cardType === 'red') status = 2;
    else if (cardType === 'yellow') status = 1;
  } else if (event.kind === EVENT_KINDS.SANCTION) {
    const sanctionType = event.tags?.find(t => t[0] === 'sanction_type')?.[1];
    if (sanctionType === 'ban') status = 3;
    else status = 2; // suspension
  } else if (event.kind === EVENT_KINDS.REVIEW_OUTCOME) {
    const outcome = event.tags?.find(t => t[0] === 'outcome')?.[1];
    if (outcome === 'dismissed') status = 0;
    else status = 1; // downgraded = yellow at most
  } else if ([EVENT_KINDS.MEMBERSHIP, EVENT_KINDS.GATE_LOCK, EVENT_KINDS.ATTENDANCE].includes(event.kind)) {
    // Non-status-changing events: preserve any existing status
    status = existing?.status ?? 0;
  }

  chainTipCache.set(fanPubkey, { tipEventId: event.id, status });
  // Store created_at for ordering comparison (internal use)
  const tip = chainTipCache.get(fanPubkey);
  tip._createdAt = event.created_at;
}

/**
 * Publish a signed event to the relay.
 * @param {object} event - Signed Nostr event
 */
export async function publishEvent(event) {
  if (!relay) throw new Error('Relay not connected');
  await relay.publish(event);
}

/**
 * Update the club pubkey list and resubscribe to roster events.
 * Called when ClubDiscovery detects a change.
 * @param {string[]} clubPubkeys - Updated list of club pubkeys
 */
export function resubscribeRoster(clubPubkeys) {
  _clubPubkeys = clubPubkeys;
  if (relay && _caches) {
    subscribeToRosterEvents(relay, _caches.rosterCache, clubPubkeys);
  }
}

/**
 * Get relay connection status.
 */
export function getRelayStatus() {
  return { connected: !!relay };
}
