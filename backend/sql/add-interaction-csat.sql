-- =============================================================================
-- CSAT contest assessment — separate pipeline from transcribe/insights.
-- Run against the ai_insight database. Idempotent.
--
-- interaction_csat holds a third-party CSAT score matched to an interaction by
-- interactionTpsId, plus the campaign-specific "should this be contested?"
-- assessment. Its own status lifecycle keeps CSAT volume out of the main stats.
-- Also adds a lightweight hasCsat flag to interactions.
-- =============================================================================

IF OBJECT_ID('app.interaction_csat', 'U') IS NULL
BEGIN
  CREATE TABLE app.interaction_csat (
    id                uniqueidentifier NOT NULL
                        CONSTRAINT DF_interaction_csat_id DEFAULT NEWID()
                        CONSTRAINT PK_interaction_csat PRIMARY KEY,
    interactionTpsId  varchar(50)   NOT NULL,
    recordingId       uniqueidentifier NULL,
    campaign          varchar(50)   NULL,
    score             int           NULL,
    scoreMax          int           NULL,
    comment           nvarchar(MAX) NULL,
    respondedAt       datetime2     NULL,
    rawFeedJson       nvarchar(MAX) NULL,
    status            varchar(30)   NOT NULL CONSTRAINT DF_interaction_csat_status DEFAULT 'pending',
    lastError         nvarchar(1024) NULL,
    decision          varchar(20)   NULL,
    confidence        float         NULL,
    dissatisfaction_source varchar(40) NULL,
    agent_materially_contributed bit NULL,
    rationale         nvarchar(MAX) NULL,
    json              nvarchar(MAX) NULL,
    providerUsed      varchar(50)   NULL,
    model             varchar(120)  NULL,
    prompt_versions_json nvarchar(MAX) NULL,
    input_tokens      int           NULL,
    output_tokens     int           NULL,
    attempts          int           NULL,
    createdAt         datetime2     NOT NULL CONSTRAINT DF_interaction_csat_created DEFAULT SYSUTCDATETIME(),
    assessedAt        datetime2     NULL
  );
END;
GO

-- One CSAT per interaction (feed key) — enables upsert on re-ingest.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_csat_tpsid' AND object_id = OBJECT_ID('app.interaction_csat'))
  CREATE UNIQUE INDEX IX_interaction_csat_tpsid ON app.interaction_csat (interactionTpsId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_csat_recording' AND object_id = OBJECT_ID('app.interaction_csat'))
  CREATE INDEX IX_interaction_csat_recording ON app.interaction_csat (recordingId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_csat_status' AND object_id = OBJECT_ID('app.interaction_csat'))
  CREATE INDEX IX_interaction_csat_status ON app.interaction_csat (status);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_csat_decision' AND object_id = OBJECT_ID('app.interaction_csat'))
  CREATE INDEX IX_interaction_csat_decision ON app.interaction_csat (decision);
GO

-- Lightweight flag on interactions.
IF COL_LENGTH('app.interactions', 'hasCsat') IS NULL
  ALTER TABLE app.interactions ADD hasCsat bit NULL;
GO
