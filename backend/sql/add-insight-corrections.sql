-- =============================================================================
-- Insight corrections — human overrides of AI-extracted fields (QA correction loop)
-- Run against the ai_insight database.
--
-- Stored separately from the insight so the AI's original value is preserved
-- (golden-set fodder + audit trail). Idempotent.
-- =============================================================================

IF OBJECT_ID('app.insight_corrections', 'U') IS NULL
BEGIN
  CREATE TABLE app.insight_corrections (
    id             uniqueidentifier NOT NULL
                     CONSTRAINT DF_insight_corrections_id DEFAULT NEWID()
                     CONSTRAINT PK_insight_corrections PRIMARY KEY,
    recordingId    uniqueidentifier NOT NULL,
    fieldKey       varchar(200)  NOT NULL,
    fieldLabel     nvarchar(300) NOT NULL,
    aiValue        nvarchar(MAX) NULL,
    correctedValue nvarchar(MAX) NULL,
    note           nvarchar(MAX) NULL,
    correctedBy    varchar(200)  NULL,
    createdAt      datetime2 NOT NULL CONSTRAINT DF_insight_corrections_created DEFAULT SYSUTCDATETIME()
  );
  CREATE NONCLUSTERED INDEX IX_insight_corrections_recording ON app.insight_corrections (recordingId);
END;
GO
