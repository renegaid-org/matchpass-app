import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { ChainTipCache } from './chain-tip-cache.js';
import { RosterCache } from './roster-cache.js';
import { ScanTracker } from './scan-tracker.js';
import { ReviewRequestCache } from './review-request-cache.js';
import { EventAuthorCache } from './chain/event-author-cache.js';
import { setEventAuthorLookup } from './chain/verify.js';
import { ClubDiscovery } from './club-discovery.js';
import {
  connectAndSubscribe,
  getRelayStatus,
  getRelay,
  resubscribeRoster,
  fetchFanChain,
  subscribeToLiveEvents,
  publishEvent,
  attachInviteCache,
  refreshInviteSubscription,
} from './relay.js';
import { verifyNip98, requireRole } from './auth.js';
import { createInviteCache } from './invite-cache.js';
import { createInviteHandler } from './invite-handler.js';

import createScanRouter from './routes/scan.js';
import createEventRouter from './routes/event.js';
import createTipRouter from './routes/tip.js';
import createDashboardRouter from './routes/dashboard.js';
import createFlagsRouter from './routes/flags.js';
import createChainRouter from './routes/chain.js';
import createSubscribeRouter from './routes/subscribe.js';
import createRosterRouter from './routes/roster.js';
import createStaffRouter from './routes/staff.js';
import createInvitesRouter from './routes/invites.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// In-memory state
const chainTipCache = new ChainTipCache();
const rosterCache = new RosterCache();
const scanTracker = new ScanTracker();
const reviewRequestCache = new ReviewRequestCache();
const eventAuthorCache = new EventAuthorCache();
const inviteCache = createInviteCache();
const caches = { chainTipCache, rosterCache, scanTracker, reviewRequestCache, eventAuthorCache };

// Wire the kind-1059 gift-wrap handler into the relay's invite subscription.
// `attachInviteCache` stores both for later use by refreshInviteSubscription —
// it does not itself open any REQ. The first REQ is opened the moment an
// invite is minted (which adds the first active session pubkey).
const inviteHandler = createInviteHandler({
  cache: inviteCache,
  onAccept: (tokenHash, result) => {
    console.log(`Invite ${tokenHash.slice(0, 8)} accepted by persona ${result.personaPubkey.slice(0, 8)}`);
  },
});
attachInviteCache(inviteCache, inviteHandler);

// Re-issue the gift-wrap REQ whenever the active session pubkey set changes.
// Mint adds a pubkey (handled via the route's onMint callback below); consume
// / expire / cancel remove one (handled here via cache.onEvent). Cancel does
// not fire onEvent, but it's only called from cache.cancel() which is not
// reachable from any wired-up code path right now — if that changes, the
// caller should call refreshInviteSubscription itself.
inviteCache.onEvent(() => {
  refreshInviteSubscription(getRelay(), inviteCache.activeSessionPubkeys());
});

// Wire self-review enforcement: verifySignerAuthority now knows how to look up
// who authored the event being reviewed. Closes the server-side gap flagged in
// the 2026-04-20 security audit.
setEventAuthorLookup((eventId) => eventAuthorCache.getAuthor(eventId));

const app = express();

// Trust one proxy hop — required for req.ip to reflect the real client when
// this server runs behind an nginx/Caddy/Cloudflare terminator. Without this,
// express-rate-limit keys every request by the proxy's address and a single
// noisy client exhausts the limit for all peers. Tune TRUST_PROXY env if
// deployed behind multiple proxy layers.
app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  next();
});

// Rate limits
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.use('/api/gate/scan', rateLimit({ windowMs: 60_000, max: 120 }));
app.use('/api/gate/event', rateLimit({ windowMs: 60_000, max: 30 }));

// Static files (steward PWA)
app.use(express.static(join(__dirname, '..', 'public')));

// Health/status (unauthenticated). Minimal body to avoid leaking relay
// endpoint reachability / deployment detail to unauthenticated scanners.
app.get('/api/gate/status', (req, res) => {
  res.json({ ok: true });
});

// Auth middleware
const auth = verifyNip98(rosterCache);

// Routes
app.use('/api/gate/scan', auth, createScanRouter(caches));
app.use('/api/gate/event', auth, createEventRouter({ ...caches, inviteCache }));
// Tip lookup: needed by stewards who can issue chain events (roaming_steward
// for cards, officers for sanctions/review outcomes). Gate stewards never
// call it, so restricting here removes a cross-role chain-membership oracle.
app.use('/api/gate/tip', auth, requireRole('roaming_steward', 'safety_officer', 'safeguarding_officer', 'admin'), createTipRouter(caches));
// Full chain history: officer-only (rich data — PII-adjacent incident notes).
app.use('/api/gate/chain', auth, requireRole('safety_officer', 'safeguarding_officer', 'admin'), createChainRouter({ fetchFanChain }));
app.use('/api/gate/dashboard', auth, requireRole('safety_officer', 'admin'), createDashboardRouter(caches));
app.use('/api/gate/flags', auth, requireRole('safety_officer', 'safeguarding_officer', 'admin'), createFlagsRouter(caches));
app.use('/api/gate/subscribe', auth, createSubscribeRouter({ subscribeToLiveEvents }));
app.use('/api/gate/roster', auth, requireRole('admin'), createRosterRouter({ rosterCache, publishEvent }));
// Officer-accessible read-only view of the roster + today's scan stats.
app.use('/api/gate/staff', auth, requireRole('safety_officer', 'safeguarding_officer', 'admin'), createStaffRouter({ rosterCache, scanTracker }));

// Staff QR invite endpoints. The router applies its own NIP-98 / cookie auth
// internally so we don't mount global `auth` middleware here. The acceptRouter
// renders public landing HTML and intentionally has no auth.
const GATE_HOST = process.env.PUBLIC_GATE_HOST
  || process.env.ALLOWED_ORIGIN
  || `http://localhost:${process.env.PORT || 3000}`;
const { apiRouter: invitesApiRouter, acceptRouter: invitesAcceptRouter } = createInvitesRouter({
  cache: inviteCache,
  // Minting adds a new session pubkey to the cache, so we must (re-)issue
  // the gift-wrap REQ to include it. consume / expire are handled by the
  // cache.onEvent hook above.
  onMint: () => refreshInviteSubscription(getRelay(), inviteCache.activeSessionPubkeys()),
  gateHost: GATE_HOST,
  verifyNip98Middleware: auth,
});
app.use('/api/gate/invites', invitesApiRouter);
app.use('/', invitesAcceptRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Startup
const PORT = process.env.PORT || 3000;
const RELAY_URL = process.env.RELAY_URL || 'wss://relay.trotters.cc';
const CLUB_API = process.env.MATCHPASS_CLUB_API || 'https://matchpass.club';

async function start() {
  const discovery = new ClubDiscovery(CLUB_API, {
    onChange: (pubkeys) => {
      console.log(`Club list changed: ${pubkeys.length} club(s) — resubscribing`);
      resubscribeRoster(pubkeys);
    },
  });
  const clubPubkeys = await discovery.fetch();
  discovery.startPeriodicRefresh();

  await connectAndSubscribe(RELAY_URL, { chainTipCache, rosterCache }, clubPubkeys);

  scheduleMidnightClear(scanTracker);
  scheduleInviteMidnightClear(inviteCache);

  // Prune expired pending invites every 60 s. Expired records fire an 'expired'
  // event before they're dropped, so the cache.onEvent hook will refresh the
  // gift-wrap REQ to drop the now-stale session pubkey from the filter.
  setInterval(() => inviteCache.pruneExpired(), 60_000);

  app.listen(PORT, () => {
    console.log(`matchpass-gate listening on ${PORT}`);
    console.log(`Relay: ${RELAY_URL}`);
    console.log(`Clubs: ${clubPubkeys.length} discovered`);
    console.log(`Cache: ${chainTipCache.size} fan tip(s), ${rosterCache.size} roster(s)`);
  });
}

function scheduleMidnightClear(tracker) {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(() => {
    tracker.clearDay();
    console.log('Scan tracker cleared at midnight');
    setInterval(() => {
      tracker.clearDay();
      console.log('Scan tracker cleared at midnight');
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

// Same pattern as scheduleMidnightClear — wipes any lingering invite records at
// 00:00 local time so the cache never accumulates day-over-day. pruneExpired
// already handles the 15-minute pending TTL; this catches accepted / consumed
// records whose roster events were never published, plus any stale state.
function scheduleInviteMidnightClear(cache) {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();

  setTimeout(() => {
    cache.clearAll();
    console.log('Invite cache cleared at midnight');
    setInterval(() => {
      cache.clearAll();
      console.log('Invite cache cleared at midnight');
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

start().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});

export default app;
