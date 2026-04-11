// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query as dbQuery } from './db.js';
import clubsRouter from './routes/clubs.js';
import seasonsRouter from './routes/seasons.js';
import staffRouter from './routes/staff.js';
import scanRouter from './routes/scan.js';
import cardsRouter from './routes/cards.js';
import sanctionsRouter from './routes/sanctions.js';
import linkagesRouter from './routes/linkages.js';
import dashboardRouter from './routes/dashboard.js';
import chainRouter from './routes/chain.js';
import authRouter from './routes/auth.js';
import { initNostr } from './nostr.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https:; connect-src 'self' wss: ws:"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  next();
});

app.use(express.static(join(__dirname, '..', 'public')));

// Global rate limit
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Stricter limit for card issuance
app.use('/api/cards', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many card issuance requests' },
}));

// Stricter limit for scan
app.use('/api/scan', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many scan requests' },
}));

// Stricter limit for auth login
app.use('/api/auth/login', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts' },
}));

// Rate limiter for chain QR verification (gate scanner hardware — unauthenticated)
app.use('/api/chain/verify-qr', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many QR verification requests' },
}));

// Rate limiter for chain sync
app.use('/api/chain/sync', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many chain sync requests' },
}));

app.use('/api/auth', authRouter);
app.use('/api/clubs', clubsRouter);
app.use('/api/seasons', seasonsRouter);
app.use('/api/staff', staffRouter);
app.use('/api/scan', scanRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/sanctions', sanctionsRouter);
app.use('/api/linkages', linkagesRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/chain', chainRouter);

// Daily scan log cleanup (30-day retention)
setInterval(async () => {
  try {
    const result = await dbQuery("DELETE FROM scan_log WHERE created_at < NOW() - INTERVAL '30 days'");
    if (result.rowCount > 0) {
      console.log(`Scan log cleanup: removed ${result.rowCount} records older than 30 days`);
    }
  } catch (err) {
    console.error('Scan log cleanup failed:', err.message);
  }
}, 24 * 60 * 60 * 1000); // Run every 24 hours

// Global error handler — prevent stack trace leaks
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

// Initialise Nostr relay connection for cross-club propagation
initNostr(process.env.NOSTR_SECRET_KEY || null);

app.listen(PORT, () => console.log(`matchpass.app listening on ${PORT}`));

export default app;
