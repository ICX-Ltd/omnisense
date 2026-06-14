-- =============================================================================
-- Creates app.llm_usage_log: one row per LLM extraction ATTEMPT (success or
-- failure), so total spend — including fully-failed records that never produce
-- an interaction_insights row — is captured. Run against ai_assist. Idempotent.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.tables t
  JOIN sys.schemas s ON s.schema_id = t.schema_id
  WHERE s.name = 'app' AND t.name = 'llm_usage_log'
)
BEGIN
  CREATE TABLE app.llm_usage_log (
    id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_llm_usage_log_id DEFAULT NEWSEQUENTIALID(),
    recordingId     UNIQUEIDENTIFIER NULL,
    provider        VARCHAR(50) NULL,
    model           VARCHAR(120) NULL,
    interactionType VARCHAR(32) NULL,
    campaign        VARCHAR(50) NULL,
    attempt         INT NOT NULL CONSTRAINT DF_llm_usage_log_attempt DEFAULT 1,
    outcome         VARCHAR(16) NOT NULL,
    truncated       BIT NOT NULL CONSTRAINT DF_llm_usage_log_truncated DEFAULT 0,
    inputTokens     INT NOT NULL CONSTRAINT DF_llm_usage_log_in DEFAULT 0,
    outputTokens    INT NOT NULL CONSTRAINT DF_llm_usage_log_out DEFAULT 0,
    createdAt       DATETIME2 NOT NULL CONSTRAINT DF_llm_usage_log_created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_llm_usage_log PRIMARY KEY (id)
  );
END;
GO

-- Window queries filter/aggregate by createdAt.
IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE name = 'IX_llm_usage_log_createdAt'
    AND object_id = OBJECT_ID('app.llm_usage_log')
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_llm_usage_log_createdAt
    ON app.llm_usage_log (createdAt)
    INCLUDE (provider, model, outcome, inputTokens, outputTokens);
END;
GO
