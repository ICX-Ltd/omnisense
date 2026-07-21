-- =============================================================================
-- Transcription word stats — powers the "% uncertain words" clarity metric
-- Run against the ai_insight database.
--
-- Adds to app.interaction_transcripts:
--   wordCount           INT — total words in the transcript (Deepgram)
--   uncertainWordCount  INT — words below the uncertainty threshold (~0.8)
-- Both NULL until (re)transcribed after this migration. Idempotent.
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.interaction_transcripts') AND name = 'wordCount')
BEGIN
  ALTER TABLE app.interaction_transcripts ADD wordCount INT NULL;
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('app.interaction_transcripts') AND name = 'uncertainWordCount')
BEGIN
  ALTER TABLE app.interaction_transcripts ADD uncertainWordCount INT NULL;
END;
GO
