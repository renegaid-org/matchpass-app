import { Router } from 'express';

export default function createDashboardRouter({ scanTracker, chainTipCache, rosterCache }) {
  const router = Router();

  router.get('/', (req, res) => {
    const stats = scanTracker.getStats();
    return res.json({
      date: new Date().toISOString().split('T')[0],
      scans: { green: stats.green, amber: stats.amber, red: stats.red, total: stats.total },
      duplicateFlags: stats.duplicateFlags,
      cache: { fans: chainTipCache.size, clubs: rosterCache.size },
    });
  });

  return router;
}
