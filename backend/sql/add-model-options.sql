-- =============================================================================
-- Model registry — editable insights/transcription model lists
-- Run against the ai_insight database.
--
-- The backend seeds this table from the previous hardcoded lists on first boot
-- when empty, so no data seeding is needed here. Idempotent.
-- =============================================================================

IF OBJECT_ID('app.model_options', 'U') IS NULL
BEGIN
  CREATE TABLE app.model_options (
    id        uniqueidentifier NOT NULL
                CONSTRAINT DF_model_options_id DEFAULT NEWID()
                CONSTRAINT PK_model_options PRIMARY KEY,
    kind      varchar(20)   NOT NULL,   -- 'insights' | 'transcription'
    provider  varchar(40)   NOT NULL,   -- openai | anthropic | grok | gemini | deepgram
    modelId   varchar(120)  NOT NULL,   -- '' = provider default (insights)
    label     nvarchar(200) NOT NULL,
    active    bit NOT NULL CONSTRAINT DF_model_options_active DEFAULT 1,
    isDefault bit NOT NULL CONSTRAINT DF_model_options_default DEFAULT 0,
    sortOrder int NOT NULL CONSTRAINT DF_model_options_sort DEFAULT 0,
    createdAt datetime2 NOT NULL CONSTRAINT DF_model_options_created DEFAULT SYSUTCDATETIME()
  );
END;
GO
