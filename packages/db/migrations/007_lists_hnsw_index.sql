-- Switch lists embedding index from IVFFlat to HNSW
-- IVFFlat with lists=50 degrades when table has fewer than 50 rows.
-- HNSW has no minimum row requirement and handles incremental inserts better.

DROP INDEX IF EXISTS idx_lists_embedding;

CREATE INDEX idx_lists_embedding ON lists
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
