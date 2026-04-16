import { Router } from 'express';
import { isValidPubkey } from '../chain/types.js';

const STATUS_NAMES = { 0: 'clean', 1: 'yellow', 2: 'red', 3: 'banned' };

export default function createTipRouter({ chainTipCache }) {
  const router = Router();

  router.get('/:pubkey', (req, res) => {
    const { pubkey } = req.params;
    if (!isValidPubkey(pubkey)) {
      return res.status(400).json({ error: 'Invalid pubkey format' });
    }
    const tip = chainTipCache.get(pubkey);
    if (!tip) {
      return res.status(404).json({ error: 'Fan not in chain cache' });
    }
    return res.json({
      fanPubkey: pubkey, tipEventId: tip.tipEventId,
      status: tip.status, statusName: STATUS_NAMES[tip.status] || 'unknown',
    });
  });

  return router;
}
