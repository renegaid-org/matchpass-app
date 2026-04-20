import { Router } from 'express';

export default function createFlagsRouter({ scanTracker, reviewRequestCache }) {
  const router = Router();

  router.get('/', (req, res) => {
    const flags = scanTracker.listOpenFlags();
    const clubPubkey = req.staff?.clubPubkey || null;
    const reviewRequests = reviewRequestCache
      ? reviewRequestCache.list(clubPubkey ? { clubPubkey } : {}).map(e => ({
          id: e.id,
          pubkey: e.pubkey,
          created_at: e.created_at,
          tags: e.tags,
        }))
      : [];
    return res.json({ flags, reviewRequests });
  });

  router.post('/:id/dismiss', (req, res) => {
    const { id } = req.params;
    const { note } = req.body || {};
    if (note && (typeof note !== 'string' || note.length > 500)) {
      return res.status(400).json({ error: 'note must be a string under 500 characters' });
    }
    const ok = scanTracker.dismissFlag(id, note || null);
    if (!ok) return res.status(404).json({ error: 'Flag not found' });
    return res.json({ ok: true });
  });

  return router;
}
