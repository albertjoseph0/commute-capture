const TARGET_PER_PROMPT = parseInt(process.env.TARGET_PER_PROMPT || '10', 10);
const COVERAGE_WEIGHT = parseInt(process.env.COVERAGE_WEIGHT || '5', 10);
const CATEGORY_WEIGHT = parseInt(process.env.CATEGORY_WEIGHT || '3', 10);
const RECENCY_PENALTY = parseInt(process.env.RECENCY_PENALTY || '10', 10);
const PRIORITY_WEIGHT = parseInt(process.env.PRIORITY_WEIGHT || '2', 10);

export async function selectNextPrompt({ db, commuteId }) {
  // Get all active prompts
  const { rows: prompts } = await db.query(
    `SELECT id, sequence_index, text, category, priority, pair_group_id, canonical_transcript, tags, target_contexts
     FROM prompts WHERE active = true ORDER BY sequence_index`
  );

  if (prompts.length === 0) return null;

  // Get prompt IDs already recorded in this commute
  const { rows: commuteRecordings } = await db.query(
    `SELECT prompt_id FROM recordings WHERE commute_id = $1`,
    [commuteId]
  );
  const recordedInCommute = new Set(commuteRecordings.map(r => r.prompt_id));

  // Get total recording counts per prompt
  const { rows: promptCounts } = await db.query(
    `SELECT prompt_id, COUNT(*)::int AS count FROM recordings GROUP BY prompt_id`
  );
  const byPrompt = new Map(promptCounts.map(r => [r.prompt_id, r.count]));

  // Get total recording counts per category
  const { rows: categoryCounts } = await db.query(
    `SELECT p.category, COUNT(r.id)::int AS count
     FROM prompts p LEFT JOIN recordings r ON r.prompt_id = p.id
     WHERE p.active = true
     GROUP BY p.category`
  );
  const byCategory = new Map(categoryCounts.map(r => [r.category, r.count]));
  const totalCategoryRecordings = [...byCategory.values()].reduce((a, b) => a + b, 0);
  const categoryCount = byCategory.size || 1;
  const avgPerCategory = totalCategoryRecordings / categoryCount;

  // Get days since last recording per prompt
  const { rows: recencyRows } = await db.query(
    `SELECT prompt_id, EXTRACT(EPOCH FROM (NOW() - MAX(created_at))) / 86400 AS days_since
     FROM recordings GROUP BY prompt_id`
  );
  const daysSinceLastByPrompt = new Map(recencyRows.map(r => [r.prompt_id, parseFloat(r.days_since)]));

  // Score each prompt
  let best = null;
  let bestScore = -Infinity;

  for (const prompt of prompts) {
    if (recordedInCommute.has(prompt.id)) continue;

    let score = 0;

    // Coverage gap
    const total = byPrompt.get(prompt.id) ?? 0;
    score += Math.max(0, TARGET_PER_PROMPT - total) * COVERAGE_WEIGHT;

    // Category gap
    const catCount = byCategory.get(prompt.category) ?? 0;
    if (catCount < avgPerCategory) {
      score += (avgPerCategory - catCount) * CATEGORY_WEIGHT;
    }

    // Recency penalty
    const daysSince = daysSinceLastByPrompt.get(prompt.id);
    if (daysSince != null && daysSince < 3) score -= RECENCY_PENALTY;

    // Admin priority boost
    score += (prompt.priority ?? 0) * PRIORITY_WEIGHT;

    // Deterministic tie-breaking: lower total count, then lower sequence_index
    if (score > bestScore || (score === bestScore && best && (total < (byPrompt.get(best.id) ?? 0) || (total === (byPrompt.get(best.id) ?? 0) && prompt.sequence_index < best.sequence_index)))) {
      best = prompt;
      bestScore = score;
    }
  }

  return best;
}

export async function getRemainingCount({ db, commuteId }) {
  const { rows: [{ total }] } = await db.query(
    `SELECT COUNT(*)::int AS total FROM prompts WHERE active = true`
  );
  const { rows: [{ recorded }] } = await db.query(
    `SELECT COUNT(*)::int AS recorded FROM recordings WHERE commute_id = $1`,
    [commuteId]
  );
  return total - recorded;
}
