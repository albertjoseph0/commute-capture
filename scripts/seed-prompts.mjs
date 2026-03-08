import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

async function main() {
  const dataPath = join(__dirname, '..', 'data', 'prompts.json');
  const prompts = JSON.parse(await readFile(dataPath, 'utf8'));

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const query = `
    INSERT INTO prompts (sequence_index, category, text, canonical_transcript, pair_group_id, priority, tags, target_contexts)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (sequence_index) DO UPDATE SET
      category = EXCLUDED.category,
      text = EXCLUDED.text,
      canonical_transcript = EXCLUDED.canonical_transcript,
      pair_group_id = EXCLUDED.pair_group_id,
      priority = EXCLUDED.priority,
      tags = EXCLUDED.tags,
      target_contexts = EXCLUDED.target_contexts
  `;

  // Deactivate any prompts not in the current seed set
  const seedIndexes = prompts.map(p => p.sequence_index);
  await client.query(
    `UPDATE prompts SET active = false WHERE sequence_index != ALL($1::int[])`,
    [seedIndexes]
  );

  let upserted = 0;
  for (const p of prompts) {
    await client.query(query, [
      p.sequence_index,
      p.category,
      p.text,
      p.canonical_transcript ?? null,
      p.pair_group_id ?? null,
      p.priority ?? 0,
      JSON.stringify(p.tags ?? []),
      JSON.stringify(p.target_contexts ?? []),
    ]);
    upserted++;
  }

  console.log(`Upserted ${upserted} prompts.`);
  await client.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
