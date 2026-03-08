import { Router } from 'express';
import { pool } from '../db/pool.js';

const router = Router();

router.get('/healthz', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

export default router;
