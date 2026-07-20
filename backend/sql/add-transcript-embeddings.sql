-- =============================================================================
-- Semantic search — transcript embedding storage
-- Run against the ai_insight database.
--
-- Adds two columns to app.interaction_transcripts:
--   embedding       NVARCHAR(MAX) — JSON array of floats (OpenAI text-embedding-3-small, 512 dims)
--   embeddingModel  VARCHAR(100)  — the model that produced it
-- Both NULL until the "Embed transcripts" batch runs. Idempotent.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_transcripts') AND name = 'embedding'
)
BEGIN
  ALTER TABLE app.interaction_transcripts ADD embedding NVARCHAR(MAX) NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_transcripts') AND name = 'embeddingModel'
)
BEGIN
  ALTER TABLE app.interaction_transcripts ADD embeddingModel VARCHAR(100) NULL;
END;
GO
