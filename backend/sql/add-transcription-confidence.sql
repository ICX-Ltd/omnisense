-- =============================================================================
-- Transcription confidence — per-transcript quality signal from Deepgram
-- Run against the ai_insight database.
--
-- Adds two columns to app.interaction_transcripts:
--   confidence         FLOAT         — overall Deepgram alternative confidence (0-1)
--   lowConfidenceJson  NVARCHAR(MAX) — JSON [{word,confidence,count}] of the words
--                                      the model was least sure about (spot-check +
--                                      vehicle keyterm-suggestion loop)
-- Both NULL for providers that don't report confidence (e.g. gpt-4o-transcribe)
-- and for transcripts made before this migration. Idempotent.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_transcripts')
    AND name = 'confidence'
)
BEGIN
  ALTER TABLE app.interaction_transcripts ADD confidence FLOAT NULL;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_transcripts')
    AND name = 'lowConfidenceJson'
)
BEGIN
  ALTER TABLE app.interaction_transcripts ADD lowConfidenceJson NVARCHAR(MAX) NULL;
END;
GO
