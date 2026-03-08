import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { selectNextPrompt, getRemainingCount } from '../../services/scheduler.js';

const router = Router();

router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const b = req.body;
    if (!b.commute_id || !b.prompt_id || !b.object_url || !b.object_key) {
      throw new AppError(400, 'commute_id, prompt_id, object_url, and object_key are required');
    }
    if (!b.duration_ms || !b.capture_started_at || !b.capture_ended_at || !b.upload_completed_at) {
      throw new AppError(400, 'duration_ms, capture_started_at, capture_ended_at, and upload_completed_at are required');
    }
    if (b.file_size_bytes == null || !b.content_type) {
      throw new AppError(400, 'file_size_bytes and content_type are required');
    }

    await client.query('BEGIN');

    // Lock commute row
    const { rows: [commute] } = await client.query(
      `SELECT id, status FROM commutes WHERE id = $1 FOR UPDATE`, [b.commute_id]
    );
    if (!commute) throw new AppError(404, 'Commute not found');
    if (commute.status !== 'active') throw new AppError(409, 'Commute is not active');

    // Get prompt text for snapshot
    const { rows: [prompt] } = await client.query(
      `SELECT text FROM prompts WHERE id = $1`, [b.prompt_id]
    );
    if (!prompt) throw new AppError(404, 'Prompt not found');

    // Insert recording
    const { rows: [recording] } = await client.query(
      `INSERT INTO recordings (
        commute_id, prompt_id, prompt_text_snapshot, object_key, object_url,
        duration_ms, file_size_bytes, content_type,
        capture_started_at, capture_ended_at, upload_completed_at,
        location_lat, location_lon, location_speed, location_heading, location_altitude, location_accuracy,
        motion_accel_x, motion_accel_y, motion_accel_z,
        motion_accel_gravity_x, motion_accel_gravity_y, motion_accel_gravity_z,
        motion_rot_alpha, motion_rot_beta, motion_rot_gamma, motion_interval_ms,
        orientation_alpha, orientation_beta, orientation_gamma, orientation_absolute,
        compass_heading, compass_accuracy,
        audio_track_settings_json, audio_devices_json,
        audio_context_sample_rate, audio_context_base_latency,
        screen_orientation_type, screen_orientation_angle,
        client_ua, client_platform, client_locale
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12, $13, $14, $15, $16, $17,
        $18, $19, $20,
        $21, $22, $23,
        $24, $25, $26, $27,
        $28, $29, $30, $31,
        $32, $33,
        $34, $35,
        $36, $37,
        $38, $39,
        $40, $41, $42
      ) RETURNING id`,
      [
        b.commute_id, b.prompt_id, prompt.text, b.object_key, b.object_url,
        b.duration_ms, b.file_size_bytes, b.content_type,
        b.capture_started_at, b.capture_ended_at, b.upload_completed_at,
        b.location_lat ?? null, b.location_lon ?? null, b.location_speed ?? null,
        b.location_heading ?? null, b.location_altitude ?? null, b.location_accuracy ?? null,
        b.motion_accel_x ?? null, b.motion_accel_y ?? null, b.motion_accel_z ?? null,
        b.motion_accel_gravity_x ?? null, b.motion_accel_gravity_y ?? null, b.motion_accel_gravity_z ?? null,
        b.motion_rot_alpha ?? null, b.motion_rot_beta ?? null, b.motion_rot_gamma ?? null, b.motion_interval_ms ?? null,
        b.orientation_alpha ?? null, b.orientation_beta ?? null, b.orientation_gamma ?? null, b.orientation_absolute ?? null,
        b.compass_heading ?? null, b.compass_accuracy ?? null,
        b.audio_track_settings_json ? JSON.stringify(b.audio_track_settings_json) : null,
        b.audio_devices_json ? JSON.stringify(b.audio_devices_json) : null,
        b.audio_context_sample_rate ?? null, b.audio_context_base_latency ?? null,
        b.screen_orientation_type ?? null, b.screen_orientation_angle ?? null,
        b.client_ua ?? null, b.client_platform ?? null, b.client_locale ?? null,
      ]
    );

    // Select next prompt
    const nextPrompt = await selectNextPrompt({ db: client, commuteId: b.commute_id });

    // Update commute state
    await client.query(
      `UPDATE commutes SET current_prompt_id = $1, current_prompt_index = current_prompt_index + 1 WHERE id = $2`,
      [nextPrompt?.id || null, b.commute_id]
    );

    await client.query('COMMIT');

    const remaining = await getRemainingCount({ db: pool, commuteId: b.commute_id });

    res.status(201).json({
      recording_id: recording.id,
      next_prompt: nextPrompt || null,
      remaining_count: remaining,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      next(new AppError(409, 'Recording already exists for this prompt in this commute'));
    } else {
      next(err);
    }
  } finally {
    client.release();
  }
});

router.get('/', async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];

    if (req.query.commute_id) {
      params.push(req.query.commute_id);
      conditions.push(`r.commute_id = $${params.length}`);
    }
    if (req.query.category) {
      params.push(req.query.category);
      conditions.push(`p.category = $${params.length}`);
    }

    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM recordings r JOIN prompts p ON p.id = r.prompt_id ${where}`,
      params
    );

    params.push(limit);
    params.push(offset);
    const { rows: recordings } = await pool.query(
      `SELECT r.*, p.category AS prompt_category
       FROM recordings r JOIN prompts p ON p.id = r.prompt_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ recordings, total });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows: [recording] } = await pool.query(
      `SELECT r.*, p.category AS prompt_category, p.text AS prompt_text
       FROM recordings r JOIN prompts p ON p.id = r.prompt_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!recording) throw new AppError(404, 'Recording not found');
    res.json(recording);
  } catch (err) {
    next(err);
  }
});

export default router;
