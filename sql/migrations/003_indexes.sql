CREATE INDEX IF NOT EXISTS idx_prompts_active_category ON prompts (active, category);
CREATE INDEX IF NOT EXISTS idx_prompts_active_sequence ON prompts (active, sequence_index);
CREATE INDEX IF NOT EXISTS idx_commutes_status_started_at ON commutes (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_commute_created_at ON recordings (commute_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_prompt_created_at ON recordings (prompt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings (created_at DESC);
