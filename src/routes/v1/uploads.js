import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { createPresignedUpload } from '../../services/storage.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { commute_id, prompt_id, content_type } = req.body;
    if (!commute_id || !prompt_id) {
      throw new AppError(400, 'commute_id and prompt_id are required');
    }

    const { rows: [commute] } = await pool.query(
      `SELECT status FROM commutes WHERE id = $1`, [commute_id]
    );
    if (!commute) throw new AppError(404, 'Commute not found');
    if (commute.status !== 'active') throw new AppError(409, 'Commute is not active');

    const result = await createPresignedUpload({
      commuteId: commute_id,
      promptId: prompt_id,
      contentType: content_type || 'audio/wav',
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
