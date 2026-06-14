-- =============================================================================
-- Creates app.transcription_usage_log: one row per transcription attempt.
-- Transcription is priced per audio-MINUTE (not tokens), so it's kept separate
-- from llm_usage_log. audioSeconds = provider-reported audio length (available
-- from Deepgram metadata.duration; NULL for OpenAI gpt-4o-transcribe).
-- Run against ai_assist. Idempotent.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  WHERE s.name = 'app' AND t.name = 'transcription_usage_log'
)
BEGIN
  CREATE TABLE app.transcription_usage_log (
    id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_tx_usage_log_id DEFAULT NEWSEQUENTIALID(),
    recordingId  UNIQUEIDENTIFIER NULL,
    provider     VARCHAR(50) NULL,
    model        VARCHAR(120) NULL,
    audioSeconds FLOAT NULL,
    outcome      VARCHAR(16) NOT NULL,
    createdAt    DATETIME2 NOT NULL CONSTRAINT DF_tx_usage_log_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_transcription_usage_log PRIMARY KEY (id)
  );
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_transcription_usage_log_createdAt'
    AND object_id = OBJECT_ID('app.transcription_usage_log')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_transcription_usage_log_createdAt
    ON app.transcription_usage_log (createdAt)
    INCLUDE (provider, model, outcome, audioSeconds);
END;
GO
