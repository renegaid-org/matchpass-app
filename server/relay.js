import { Relay } from 'nostr-tools/relay';
import { verifyEvent } from 'nostr-tools/pure';
import { EVENT_KINDS, STAFF_ROSTER_KIND } from './chain/types.js';

let relay = null;

function shutdown() {
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

  try {
    relay = await Relay.connect(relayUrl);
    console.log(`Relay: connected to ${relayUrl}`);
  } catch (err) {
    console.error(`Relay: connection failed — ${err.message}`);
    relay = null;
    return;
  }

  // 1. Fetch existing roster events first (needed for signer context)
  if (clubPubkeys.length > 0) {
    const rosterEvents = await collectEvents(relay, [{ kinds: [STAFF_ROSTER_KIND], authors: clubPubkeys }]);
    for (const event of rosterEvents) {
      if (verifyEvent(event)) rosterCache.set(event.pubkey, event);
    }
    console.log(`Relay: fetched ${rosterEvents.length} roster event(s)`);
  }

  // 2. Fetch existing chain events
  const chainKinds = Object.values(EVENT_KINDS);
  const chainEvents = await collectEvents(relay, [{ kinds: chainKinds }]);
  for (const event of chainEvents) {
    if (verifyEvent(event)) handleChainEvent(event, chainTipCache);
  }
  console.log(`Relay: fetched ${chainEvents.length} chain event(s), ${chainTipCache.size} fan tip(s)`);

  // 3. Subscribe to live chain events
  relay.subscribe(
    [{ kinds: chainKinds }],
    {
      onevent: (event) => {
        if (!verifyEvent(event)) return;
        handleChainEvent(event, chainTipCache);
      },
    }
  );

  // 4. Subscribe to live roster events
  if (clubPubkeys.length > 0) {
    relay.subscribe(
      [{ kinds: [STAFF_ROSTER_KIND], authors: clubPubkeys }],
      {
        onevent: (event) => {
          if (!verifyEvent(event)) return;
          rosterCache.set(event.pubkey, event);
          console.log(`Relay: roster update from ${event.pubkey.slice(0, 12)}`);
        },
      }
    );
  }
}

/**
 * Collect events from relay until EOSE or timeout (15s).
 */
function collectEvents(relay, filters, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const collected = [];
    const timeout = setTimeout(() => { sub.close(); resolve(collected); }, timeoutMs);
    const sub = relay.subscribe(filters, {
      onevent: (event) => collected.push(event),
      oneose: () => { clearTimeout(timeout); sub.close(); resolve(collected); },
    });
  });
}

/**
 * Handle a chain event — update the chain tip cache.
 * Uses created_at as a simple ordering heuristic.
 */
function handleChainEvent(event, chainTipCache) {
  const pTag = event.tags?.find(t => Array.isArray(t) && t[0] === 'p');
  if (!pTag || !pTag[1]) return;
  const fanPubkey = pTag[1];

  const existing = chainTipCache.get(fanPubkey);
  // Only update if newer (by created_at). Full chain walk happens at sync time.
  if (existing && existing._createdAt && event.created_at <= existing._createdAt) return;

  // Simple status: 0 (clean) by default. Accurate status requires full chain walk.
  // For gate scan, the chain tip + status is a cache — the QR proof is the authority.
  chainTipCache.set(fanPubkey, { tipEventId: event.id, status: 0 });
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
 * Get relay connection status.
 */
export function getRelayStatus() {
  return { connected: !!relay };
}
