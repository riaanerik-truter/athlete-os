-- =============================================================
-- GROUP 10: Ingestion Support Table
-- sync_state
-- =============================================================

CREATE TABLE sync_state (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id     UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  source         TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  last_item_id   TEXT,
  sync_status    TEXT DEFAULT 'pending',
  error_message  TEXT,
  error_count    INT DEFAULT 0,
  next_sync_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_sync_state_athlete_source ON sync_state(athlete_id, source);
