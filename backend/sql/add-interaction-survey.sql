-- =============================================================================
-- interaction_survey — survey feed answers in their own table (idempotent DDL)
-- =============================================================================
-- Survey tick-box answers used to be squeezed into
-- interaction_insights.campaign_answers_json, which the LLM run nulls (forcing a
-- backfill to restore them). Holding them here — a table the LLM never writes —
-- removes the backfill: the insights pipeline can never clobber the answers.
--
-- Linked to an interaction by recordingId (= interaction.id). One row per survey
-- response. Run against the ai_insight database with a DDL-capable login.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.tables t
  JOIN sys.schemas sc ON sc.schema_id = t.schema_id
  WHERE sc.name = 'app' AND t.name = 'interaction_survey'
)
BEGIN
  CREATE TABLE app.interaction_survey (
    id                uniqueidentifier NOT NULL CONSTRAINT DF_interaction_survey_id DEFAULT NEWID(),
    recordingId       uniqueidentifier NOT NULL,
    interactionTpsId  varchar(50)      NULL,
    campaign          varchar(50)      NULL,
    surveyType        varchar(50)      NOT NULL CONSTRAINT DF_interaction_survey_type DEFAULT 'nmgb',
    answersJson       nvarchar(MAX)    NULL,
    respondedAt       datetime2        NULL,
    createdAt         datetime2        NOT NULL CONSTRAINT DF_interaction_survey_createdAt DEFAULT SYSDATETIME(),
    CONSTRAINT PK_interaction_survey PRIMARY KEY (id)
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_survey_recording' AND object_id = OBJECT_ID('app.interaction_survey'))
  CREATE INDEX IX_interaction_survey_recording ON app.interaction_survey (recordingId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_survey_tpsid' AND object_id = OBJECT_ID('app.interaction_survey'))
  CREATE INDEX IX_interaction_survey_tpsid ON app.interaction_survey (interactionTpsId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_survey_type' AND object_id = OBJECT_ID('app.interaction_survey'))
  CREATE INDEX IX_interaction_survey_type ON app.interaction_survey (surveyType);
GO
