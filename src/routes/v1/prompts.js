import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';

const router = Router();

const VALID_CATEGORIES = ['free_form', 'task_oriented', 'short_command', 'hard_transcription', 'read_speech', 'turn_taking'];

router.get('/coverage', async (req, res, next) => {
  try {
    const { rows: byCategory } = await pool.query(
      `SELECT p.category, COUNT(r.id)::int AS count
       FROM prompts p LEFT JOIN recordings r ON r.prompt_id = p.id
       WHERE p.active = true
       GROUP BY p.category
       ORDER BY p.category`
    );

    const { rows: byPrompt } = await pool.query(
      `SELECT p.id, p.text, p.category, COUNT(r.id)::int AS count
       FROM prompts p LEFT JOIN recordings r ON r.prompt_id = p.id
       WHERE p.active = true
       GROUP BY p.id, p.text, p.category
       ORDER BY count ASC, p.sequence_index`
    );

    const totalRecordings = byPrompt.reduce((sum, p) => sum + p.count, 0);
    const avgPerPrompt = byPrompt.length > 0 ? totalRecordings / byPrompt.length : 0;
    const underrepresented = byPrompt.filter(p => p.count < avgPerPrompt);

    res.json({ by_category: byCategory, by_prompt: byPrompt, underrepresented });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];

    if (req.query.active !== undefined) {
      params.push(req.query.active === 'true');
      conditions.push(`active = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM prompts ${where} ORDER BY sequence_index`, params
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { text, category, sequence_index, tags, target_contexts, pair_group_id, canonical_transcript, priority } = req.body;

    if (!text || !category || sequence_index == null) {
      throw new AppError(400, 'text, category, and sequence_index are required');
    }
    if (!VALID_CATEGORIES.includes(category)) {
      throw new AppError(400, `category must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }

    const { rows: [prompt] } = await pool.query(
      `INSERT INTO prompts (text, category, sequence_index, tags, target_contexts, pair_group_id, canonical_transcript, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        text, category, sequence_index,
        JSON.stringify(tags || []),
        JSON.stringify(target_contexts || []),
        pair_group_id || null,
        canonical_transcript || null,
        priority || 0,
      ]
    );
    res.status(201).json(prompt);
  } catch (err) {
    if (err.code === '23505') {
      next(new AppError(409, 'A prompt with this sequence_index already exists'));
    } else {
      next(err);
    }
  }
});

export default router;
