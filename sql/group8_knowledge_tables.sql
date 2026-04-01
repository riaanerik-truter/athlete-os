-- =============================================================
-- GROUP 8: Knowledge Tables
-- knowledge_chunk, methodology_document, coach_reference, annotation
-- coach_reference and annotation are here (not Group 7) because
-- they depend on knowledge_chunk
-- =============================================================

CREATE TABLE knowledge_chunk (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_title    TEXT NOT NULL,
  source_author   TEXT,
  source_type     TEXT NOT NULL,
  page_ref        TEXT,
  evidence_level  TEXT,
  sport_tags      TEXT[],
  topic_tags      TEXT[],
  content         TEXT NOT NULL,
  embedding       vector(1536),
  methodology_ref TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_knowledge_chunk_embedding ON knowledge_chunk USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_knowledge_chunk_tags      ON knowledge_chunk USING GIN(topic_tags);
CREATE INDEX idx_knowledge_chunk_source    ON knowledge_chunk(source_title, source_author);

CREATE TABLE methodology_document (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  methodology_id UUID NOT NULL REFERENCES methodology(id),
  title          TEXT NOT NULL,
  content        TEXT NOT NULL,
  embedding      vector(1536),
  chunk_index    INT,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_methodology_doc_embedding   ON methodology_document USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_methodology_doc_methodology ON methodology_document(methodology_id);

CREATE TABLE coach_reference (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  knowledge_chunk_id UUID NOT NULL REFERENCES knowledge_chunk(id),
  source_type        TEXT NOT NULL,
  source_id          UUID NOT NULL,
  relevance_score    NUMERIC(6,4),
  created_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_coach_reference_athlete ON coach_reference(athlete_id);
CREATE INDEX idx_coach_reference_chunk   ON coach_reference(knowledge_chunk_id);

CREATE TABLE annotation (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id         UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  knowledge_chunk_id UUID NOT NULL REFERENCES knowledge_chunk(id),
  note               TEXT,
  highlight          TEXT,
  tags               TEXT[],
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_annotation_athlete ON annotation(athlete_id);
CREATE INDEX idx_annotation_chunk   ON annotation(knowledge_chunk_id);
