import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { selectNextPrompt, getRemainingCount } from '../../services/scheduler.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { start_lat, start_lon, start_accuracy } = req.body;
    if (start_lat == null || start_lon == null || start_accuracy == null) {
      throw new AppError(400, 'start_lat, start_lon, and start_accuracy are required');
    }

    const { rows: [commute] } = await pool.query(
      `INSERT INTO commutes (start_lat, start_lon, start_accuracy, device_motion_json, device_orientation_json, screen_info_json, audio_route_json, client_ua, client_platform, client_viewport, client_locale, client_timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        start_lat, start_lon, start_accuracy,
        req.body.device_motion_json ? JSON.stringify(req.body.device_motion_json) : null,
        req.body.device_orientation_json ? JSON.stringify(req.body.device_orientation_json) : null,
        req.body.screen_info_json ? JSON.stringify(req.body.screen_info_json) : null,
        req.body.audio_route_json ? JSON.stringify(req.body.audio_route_json) : null,
        req.body.client_ua || null,
        req.body.client_platform || null,
        req.body.client_viewport || null,
        req.body.client_locale || null,
        req.body.client_timezone || null,
      ]
    );

    const prompt = await selectNextPrompt({ db: pool, commuteId: commute.id });
    if (prompt) {
      await pool.query(
        `UPDATE commutes SET current_prompt_id = $1 WHERE id = $2`,
        [prompt.id, commute.id]
      );
    }

    const remaining = await getRemainingCount({ db: pool, commuteId: commute.id });

    res.status(201).json({
      id: commute.id,
      status: commute.status,
      started_at: commute.started_at,
      prompt: prompt || null,
      remaining_count: remaining,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows: [commute] } = await pool.query(
      `SELECT c.*, row_to_json(p.*) AS prompt
       FROM commutes c
       LEFT JOIN prompts p ON p.id = c.current_prompt_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!commute) throw new AppError(404, 'Commute not found');

    res.json({
      id: commute.id,
      status: commute.status,
      started_at: commute.started_at,
      ended_at: commute.ended_at,
      current_prompt_index: commute.current_prompt_index,
      prompt: commute.prompt,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    if (req.body.status !== 'ended') {
      throw new AppError(400, 'Only { "status": "ended" } is supported');
    }

    const { rows: [commute] } = await pool.query(
      `SELECT status FROM commutes WHERE id = $1`, [req.params.id]
    );
    if (!commute) throw new AppError(404, 'Commute not found');
    if (commute.status === 'ended') throw new AppError(409, 'Commute already ended');

    const { rows: [updated] } = await pool.query(
      `UPDATE commutes SET status = 'ended', ended_at = NOW() WHERE id = $1 RETURNING id, status, ended_at`,
      [req.params.id]
    );

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
