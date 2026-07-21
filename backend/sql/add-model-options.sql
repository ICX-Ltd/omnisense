-- =============================================================================
-- Model registry — editable insights/transcription model lists
-- Run against the ai_insight database.
--
-- The backend also seeds this table from the previous hardcoded lists on first
-- boot when empty; the seed block below populates the same "examples we had"
-- immediately so the registry is not empty before the first restart. Both are
-- guarded on an empty table, so whichever runs first wins and the other skips.
-- Idempotent.
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

-- Seed the previous hardcoded model lists — only when the table is empty.
IF NOT EXISTS (SELECT 1 FROM app.model_options)
BEGIN
  INSERT INTO app.model_options (kind, provider, modelId, label, isDefault, sortOrder) VALUES
    -- insights (modelId '' = the provider's own default)
    ('insights', 'openai',    '',                   N'Default — gpt-4o-mini (fast)',            1, 0),
    ('insights', 'openai',    'gpt-4o',             N'gpt-4o (higher quality)',                 0, 1),
    ('insights', 'anthropic', '',                   N'Default — claude-haiku-4-5 (fast)',       1, 0),
    ('insights', 'anthropic', 'claude-sonnet-5',    N'claude-sonnet-5 (higher quality)',        0, 1),
    ('insights', 'anthropic', 'claude-opus-4-8',    N'claude-opus-4-8 (highest quality)',       0, 2),
    ('insights', 'grok',      '',                   N'Default — grok-4-1-fast',                 1, 0),
    ('insights', 'gemini',    '',                   N'Default — gemini-1.5-flash (fast)',       1, 0),
    ('insights', 'gemini',    'gemini-1.5-pro',     N'gemini-1.5-pro (higher quality)',         0, 1),
    -- transcription
    ('transcription', 'deepgram', 'nova-3',            N'nova-3 (default — accents, keyterm prompting)', 1, 0),
    ('transcription', 'deepgram', 'nova-2-phonecall', N'nova-2-phonecall (phone-tuned)',                0, 1),
    ('transcription', 'deepgram', 'nova-2',            N'nova-2',                                        0, 2),
    ('transcription', 'openai',   'gpt-4o-transcribe', N'gpt-4o-transcribe',                            0, 3);
END;
GO
