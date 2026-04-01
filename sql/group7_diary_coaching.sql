-- =============================================================
-- GROUP 7: Diary and Coaching Tables
-- diary_entry, conversation, notification_log
-- coach_reference and annotation deferred to Group 8
-- (they depend on knowledge_chunk which is created in Group 8)
-- =============================================================

CREATE TABLE diary_entry (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id            UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  entry_date            DATE NOT NULL,
  completed_session_id  UUID REFERENCES completed_session(id),
  rpe_overall           NUMERIC(4,2),
  wellness_score        NUMERIC(4,2),
  sleep_quality         NUMERIC(4,2),
  motivation_score      NUMERIC(4,2),
  soreness_score        NUMERIC(4,2),
  stress_life           NUMERIC(4,2),
  session_reflection    TEXT,
  daily_notes           TEXT,
  coach_summary         TEXT,
  coach_flags           TEXT[],
  coach_recommendations TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_diary_entry_athlete_date ON diary_entry(athlete_id, entry_date);
CREATE INDEX idx_diary_entry_session ON diary_entry(completed_session_id);

CREATE TABLE conversation (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id        UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  content           TEXT NOT NULL,
  message_ts        TIMESTAMPTZ NOT NULL,
  channel           TEXT DEFAULT 'whatsapp',
  intent            TEXT,
  linked_session_id UUID REFERENCES completed_session(id),
  linked_goal_id    UUID REFERENCES goal(id),
  metadata          JSONB,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_conversation_athlete ON conversation(athlete_id);
CREATE INDEX idx_conversation_ts      ON conversation(athlete_id, message_ts DESC);

CREATE TABLE notification_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL,
  type       TEXT NOT NULL,
  title      TEXT,
  body       TEXT NOT NULL,
  sent_at    TIMESTAMPTZ NOT NULL,
  delivered  BOOLEAN,
  read_at    TIMESTAMPTZ,
  metadata   JSONB
);
CREATE INDEX idx_notification_athlete ON notification_log(athlete_id);
CREATE INDEX idx_notification_sent    ON notification_log(athlete_id, sent_at DESC);
