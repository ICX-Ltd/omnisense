-- =============================================================================
-- Editable transcription vocabulary (keyterms + replacements)
-- Run against the ai_insight database.
--
-- Runtime-editable version of VEHICLE_KEYTERMS / VEHICLE_REPLACEMENTS. The
-- backend seeds this table from the hardcoded defaults on first boot when it is
-- empty, so no data seeding is needed here. Idempotent.
-- =============================================================================

IF OBJECT_ID('app.transcription_vocab', 'U') IS NULL
BEGIN
  CREATE TABLE app.transcription_vocab (
    id          uniqueidentifier NOT NULL
                  CONSTRAINT DF_transcription_vocab_id DEFAULT NEWID()
                  CONSTRAINT PK_transcription_vocab PRIMARY KEY,
    kind        varchar(20)   NOT NULL,   -- 'keyterm' | 'replacement'
    term        nvarchar(200) NOT NULL,   -- keyterm, or the mis-heard word
    replaceWith nvarchar(200) NULL,       -- correction (replacements only)
    active      bit           NOT NULL
                  CONSTRAINT DF_transcription_vocab_active DEFAULT 1,
    createdAt   datetime2     NOT NULL
                  CONSTRAINT DF_transcription_vocab_created DEFAULT SYSUTCDATETIME()
  );
END;
GO
