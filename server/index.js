import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { ChainTipCache } from './chain-tip-cache.js';
import { RosterCache } from './roster-cache.js';
import { ScanTracker } from './scan-tracker.js';
import { ClubDiscovery } from './club-discovery.js';
import { connectAndSubscribe, getRelayStatus } from './relay.js';
import { verifyNip98, requireRole } from './auth.js';

import createScanRouter from './routes/scan.js';
import createEventRouter from './routes/event.js';
import createTipRouter from './routes/tip.js';
import createDashboardRouter from './routes/dashboard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// In-memory state
const chainTipCache = new ChainTipCache();
const rosterCache = new RosterCache();
const scanTracker = new ScanTracker();
const caches = { chainTipCache, rosterCache, scanTracker };

const app = express();

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

// Health/status (unauthenticated)
app.get('/api/gate/status', (req, res) => {
  res.json({
    relay: getRelayStatus(),
    cache: { fans: chainTipCache.size, clubs: rosterCache.size },
    scans: scanTracker.getStats(),
  });
});

// Auth middleware
const auth = verifyNip98(rosterCache);

// Routes
app.use('/api/gate/scan', auth, createScanRouter(caches));
app.use('/api/gate/event', auth, createEventRouter(caches));
app.use('/api/gate/tip', auth, createTipRouter(caches));
app.use('/api/gate/dashboard', auth, requireRole('safety_officer', 'admin'), createDashboardRouter(caches));

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
  const discovery = new ClubDiscovery(CLUB_API);
  const clubPubkeys = await discovery.fetch();
  discovery.startPeriodicRefresh();

  await connectAndSubscribe(RELAY_URL, { chainTipCache, rosterCache }, clubPubkeys);

  scheduleMidnightClear(scanTracker);

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

start().catch(err => {
  console.error('Startup failed:', err);
  process.exit(1);
});

export default app;
