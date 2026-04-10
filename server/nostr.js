import { Relay } from 'nostr-tools/relay';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { query } from './db.js';
import { isValidPubkey } from './validation.js';

const RELAY_URL = process.env.NOSTR_RELAY_URL || 'wss://relay.example.com';

// Custom event kinds for MatchPass
const MATCHPASS_RED_CARD = 30078;    // Red card issued
const MATCHPASS_SANCTION = 30079;    // Suspension or ban
const MATCHPASS_SANCTION_UPDATE = 30080; // Sanction overturned/expired

let relay = null;
let clubSecretKey = null;
let currentSubscription = null;

// Zeroize club key on process shutdown
function zeroizeKey() {
  if (clubSecretKey) { clubSecretKey.fill(0); clubSecretKey = null; }
  if (relay) { relay.close(); relay = null; }
}
process.on('SIGTERM', zeroizeKey);
process.on('SIGINT', zeroizeKey);

/**
 * Initialise Nostr connection. Call once at server startup.
 * In pilot: the club's Nostr key is derived or configured.
 */
export async function initNostr(secretKeyHex) {
  if (secretKeyHex) {
    clubSecretKey = Uint8Array.from(Buffer.from(secretKeyHex, 'hex'));
  } else {
    // For development: generate ephemeral key
    clubSecretKey = generateSecretKey();
    console.log('Nostr: using ephemeral key. Set NOSTR_SECRET_KEY for production.');
  }

  try {
    relay = await Relay.connect(RELAY_URL);
    console.log(`Nostr: connected to ${RELAY_URL}`);
    await subscribeToNetwork();
  } catch (err) {
    console.error('Nostr: connection failed, cross-club propagation disabled.', err.message);
    relay = null;
  }
}

/**
 * Publish a red card to the network.
 */
export async function publishRedCard(card, clubPubkey) {
  if (!relay || !clubSecretKey) return null;

  const event = finalizeEvent({
    kind: MATCHPASS_RED_CARD,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['fan', card.fan_signet_pubkey],
      ['club', clubPubkey],
      ['category', card.category],
      ['match_date', card.match_date],
      ['card_id', card.card_id],
    ],
    content: '',
  }, clubSecretKey);

  try {
    await relay.publish(event);
    return event.id;
  } catch (err) {
    console.error('Nostr: failed to publish red card', err);
    return null;
  }
}

/**
 * Publish a sanction (suspension or ban) to the network.
 */
export async function publishSanction(sanction, clubPubkey) {
  if (!relay || !clubSecretKey) return null;

  const tags = [
    ['fan', sanction.fan_signet_pubkey],
    ['club', clubPubkey],
    ['type', sanction.sanction_type],
    ['reason', sanction.reason],
    ['start_date', sanction.start_date],
    ['sanction_id', sanction.sanction_id],
  ];
  if (sanction.end_date) tags.push(['end_date', sanction.end_date]);
  if (sanction.match_count) tags.push(['match_count', String(sanction.match_count)]);

  const event = finalizeEvent({
    kind: MATCHPASS_SANCTION,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: '',
  }, clubSecretKey);

  try {
    await relay.publish(event);
    return event.id;
  } catch (err) {
    console.error('Nostr: failed to publish sanction', err);
    return null;
  }
}

/**
 * Publish a sanction status update (overturned, expired).
 */
export async function publishSanctionUpdate(sanctionId, newStatus, clubPubkey) {
  if (!relay || !clubSecretKey) return null;

  const event = finalizeEvent({
    kind: MATCHPASS_SANCTION_UPDATE,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['sanction_id', sanctionId],
      ['club', clubPubkey],
      ['status', newStatus],
    ],
    content: '',
  }, clubSecretKey);

  try {
    await relay.publish(event);
    return event.id;
  } catch (err) {
    console.error('Nostr: failed to publish sanction update', err);
    return null;
  }
}

/**
 * Subscribe to events from other clubs in the network.
 * Filters to known club pubkeys only — rejects events from unknown authors.
 * Export so it can be re-called when new clubs register.
 */
export async function subscribeToNetwork() {
  if (!relay) return;

  // Only accept events from known clubs
  const clubsResult = await query('SELECT nostr_pubkey FROM clubs');
  const knownPubkeys = clubsResult.rows.map(r => r.nostr_pubkey);

  if (knownPubkeys.length === 0) {
    console.log('Nostr: no clubs registered, subscription deferred');
    return;
  }

  if (currentSubscription) {
    currentSubscription.close();
    currentSubscription = null;
  }

  const since = Math.floor(Date.now() / 1000) - 300; // Only recent events on restart
  currentSubscription = relay.subscribe(
    [
      { kinds: [MATCHPASS_RED_CARD, MATCHPASS_SANCTION, MATCHPASS_SANCTION_UPDATE], authors: knownPubkeys, since },
    ],
    {
      onevent: async (event) => {
        try {
          await handleIncomingEvent(event);
        } catch (err) {
          console.error('Nostr: failed to handle incoming event', err);
        }
      },
    }
  );

  console.log(`Nostr: subscribed to ${knownPubkeys.length} club(s)`);
}

/**
 * Handle incoming sanction events from other clubs.
 * Upserts into the local sanctions table.
 */
async function handleIncomingEvent(event) {
  // Verify event signature
  if (!verifyEvent(event)) {
    console.log('Nostr: rejected event with invalid signature');
    return;
  }

  const getTag = (name) => event.tags.find(t => t[0] === name)?.[1];

  if (event.kind === MATCHPASS_SANCTION) {
    const fanPubkey = getTag('fan');
    const sanctionType = getTag('type');
    const reason = getTag('reason');
    const startDate = getTag('start_date');
    const endDate = getTag('end_date') || null;
    const matchCount = getTag('match_count') ? parseInt(getTag('match_count')) : null;
    const sanctionId = getTag('sanction_id');
    const clubPubkey = getTag('club');

    if (!fanPubkey || !sanctionType || !reason || !startDate) return;
    if (!isValidPubkey(fanPubkey)) return;

    // Verify the event was signed by the claimed club
    if (event.pubkey !== clubPubkey) {
      console.log(`Nostr: rejected sanction — signer ${event.pubkey.slice(0,8)} does not match claimed club ${clubPubkey?.slice(0,8)}`);
      return;
    }

    // Validate sanction_type
    if (!['suspension', 'ban'].includes(sanctionType)) return;

    const clubResult = await query(
      'SELECT club_id FROM clubs WHERE nostr_pubkey = $1',
      [clubPubkey]
    );

    if (clubResult.rows.length === 0) {
      console.log(`Nostr: sanction from unknown club ${clubPubkey.slice(0,8)}..., skipping`);
      return;
    }

    const clubId = clubResult.rows[0].club_id;

    const existing = await query(
      'SELECT sanction_id FROM sanctions WHERE nostr_event_id = $1',
      [event.id]
    );
    if (existing.rows.length > 0) return;

    await query(
      `INSERT INTO sanctions (sanction_type, fan_signet_pubkey, issued_by_club, reason, start_date, end_date, match_count, nostr_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sanctionType, fanPubkey, clubId, reason, startDate, endDate, matchCount, event.id]
    );
    console.log(`Nostr: received ${sanctionType} for ${fanPubkey.slice(0,8)}... from ${clubPubkey.slice(0,8)}...`);
  }

  if (event.kind === MATCHPASS_SANCTION_UPDATE) {
    const sanctionId = getTag('sanction_id');
    const newStatus = getTag('status');
    const clubPubkey = getTag('club');
    if (!sanctionId || !newStatus || !clubPubkey) return;

    // Verify the event was signed by the claimed club
    if (event.pubkey !== clubPubkey) {
      console.log(`Nostr: rejected sanction update — signer mismatch`);
      return;
    }

    // Validate status
    if (!['overturned', 'expired'].includes(newStatus)) return;

    // Only allow the issuing club to update their own sanctions
    const sanctionResult = await query(
      `SELECT s.sanction_id FROM sanctions s
       JOIN clubs c ON s.issued_by_club = c.club_id
       WHERE s.sanction_id = $1 AND c.nostr_pubkey = $2`,
      [sanctionId, clubPubkey]
    );

    if (sanctionResult.rows.length === 0) {
      console.log(`Nostr: rejected sanction update — not the issuing club`);
      return;
    }

    await query(
      'UPDATE sanctions SET status = $1 WHERE sanction_id = $2',
      [newStatus, sanctionId]
    );
    console.log(`Nostr: sanction ${sanctionId.slice(0,8)}... updated to ${newStatus}`);
  }
}

export function getRelay() { return relay; }
export function getPublicKeyHex() { return clubSecretKey ? getPublicKey(clubSecretKey) : null; }
