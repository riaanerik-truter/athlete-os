-- =============================================================
-- GROUP 1: Extensions
-- timescaledb, pgvector, uuid-ossp
-- Must run before all other groups.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
