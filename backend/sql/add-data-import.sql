-- =============================================================================
-- Data importer — staging tables for third-party interaction feeds (LivePerson).
-- Run against the ai_insight database. Idempotent; safe to re-run.
--
-- Flow: file -> app.import_runs (+ import_conversations, import_messages)
--            -> operator eyeballs / excludes rows in the UI
--            -> explicit promote into app.interactions, interaction_transcripts,
--               interaction_csat and interaction_survey.
--
-- Staging deliberately lives in the `app` schema, not a new `stg` schema:
-- HealthService.checkSchema() only scans TABLE_SCHEMA='app', so tables anywhere
-- else are invisible to the drift guard, and a new schema would need fresh
-- GRANTs for the prod application login.
--
-- import_conversations columns are named after their app.* PROMOTE TARGETS, not
-- after the provider's headers. Promote is therefore a 1:1 INSERT ... SELECT,
-- and adding a second provider needs a new mapping, not a schema change. The
-- full source row is preserved in rawJson (minus columns the PII policy drops).
-- =============================================================================

-- ─── run header ──────────────────────────────────────────────────────────────
IF OBJECT_ID('app.import_runs', 'U') IS NULL
BEGIN
  CREATE TABLE app.import_runs (
    id                  uniqueidentifier NOT NULL
                          CONSTRAINT DF_import_runs_id DEFAULT NEWID()
                          CONSTRAINT PK_import_runs PRIMARY KEY,
    sourceKey           varchar(50)    NOT NULL,   -- 'liveperson'
    mappingVersion      varchar(20)    NULL,       -- mapping config version used
    intake              varchar(16)    NOT NULL,   -- upload | server
    originalFilename    nvarchar(400)  NULL,
    serverPath          nvarchar(1024) NULL,
    fileSizeBytes       bigint         NULL,
    fileSha256          char(64)       NULL,       -- same-file-twice detection
    delimiter           varchar(10)    NULL,       -- sniffed, not assumed
    encoding            varchar(20)    NULL,       -- utf8 | utf8bom | utf16le
    headerJson          nvarchar(MAX)  NULL,       -- ordered header names as found
    mappedColumnsJson   nvarchar(MAX)  NULL,       -- target <- header resolution
    unmappedColumnsJson nvarchar(MAX)  NULL,
    missingColumnsJson  nvarchar(MAX)  NULL,
    naturalKeyColumn    varchar(200)   NULL,       -- resolved conversation-id column

    -- parsing | staged | parse_failed | promoting | promoted | promote_failed
    -- | rolled_back
    status              varchar(24)    NOT NULL
                          CONSTRAINT DF_import_runs_status DEFAULT 'parsing',

    rowsRead            int NULL,
    rowsStaged          int NULL,
    rowsSkipped         int NULL,
    rowsValid           int NULL,
    rowsWarning         int NULL,
    rowsError           int NULL,
    rowsDuplicate       int NULL,
    rowsExisting        int NULL,
    rowsExcluded        int NULL,
    messagesStaged      int NULL,
    transcriptsParsed   int NULL,
    transcriptsPartial  int NULL,
    transcriptsFailed   int NULL,

    promotedInteractions int NULL,
    promotedTranscripts  int NULL,
    promotedCsat         int NULL,
    promotedSurveys      int NULL,
    promoteSkipped       int NULL,

    parseJobId          uniqueidentifier NULL,     -- app.batch_jobs row
    promoteJobId        uniqueidentifier NULL,
    lastError           nvarchar(2000) NULL,
    notes               nvarchar(1000) NULL,
    createdBy           varchar(200)   NULL,
    createdAt           datetime2      NOT NULL
                          CONSTRAINT DF_import_runs_created DEFAULT SYSUTCDATETIME(),
    stagedAt            datetime2      NULL,
    promotedAt          datetime2      NULL,
    rolledBackAt        datetime2      NULL,
    purgedAt            datetime2      NULL
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_runs_status_created' AND object_id = OBJECT_ID('app.import_runs'))
  CREATE INDEX IX_import_runs_status_created ON app.import_runs (status, createdAt DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_runs_sha' AND object_id = OBJECT_ID('app.import_runs'))
  CREATE INDEX IX_import_runs_sha ON app.import_runs (fileSha256);
GO


-- ─── one row per source conversation ─────────────────────────────────────────
IF OBJECT_ID('app.import_conversations', 'U') IS NULL
BEGIN
  CREATE TABLE app.import_conversations (
    id            uniqueidentifier NOT NULL
                    CONSTRAINT DF_import_conv_id DEFAULT NEWID()
                    CONSTRAINT PK_import_conversations PRIMARY KEY,
    importRunId   uniqueidentifier NOT NULL
                    CONSTRAINT FK_import_conv_run FOREIGN KEY
                    REFERENCES app.import_runs(id) ON DELETE CASCADE,
    rowNumber     int          NOT NULL,   -- 1-based data row in the file
    sourceKey     varchar(50)  NOT NULL,

    -- source identity, full length, pre-truncation (for QA)
    srcConversationId       varchar(200) NULL,
    srcSessionId            varchar(200) NULL,
    srcInteractionContextId varchar(200) NULL,

    -- canonical projection of app.interactions (normalised + truncated at stage
    -- time, so what the operator eyeballs is exactly what will land)
    interactionId       varchar(50)   NULL,
    interactionTpsId    varchar(50)   NULL,
    interactionDateTime datetime2     NULL,
    campaign            varchar(50)   NULL,
    agent               varchar(100)  NULL,
    dealer              nvarchar(200) NULL,
    outcome             varchar(200)  NULL,
    vehicleMake         nvarchar(100) NULL,
    vehicleModel        nvarchar(100) NULL,

    -- QA-only: never promoted, but filterable in the eyeball grid
    skill                   nvarchar(200) NULL,
    agentGroup              nvarchar(200) NULL,
    lob                     nvarchar(200) NULL,
    locationName            nvarchar(200) NULL,
    durationSeconds         int NULL,
    srcMessageCount         int NULL,
    srcMessageCountAgent    int NULL,
    srcMessageCountConsumer int NULL,
    closeReason             varchar(100) NULL,
    isPartial               bit NULL,
    isTruncated             bit NULL,

    -- CSAT / quality. csatScore comes from csatRate (the customer-stated score);
    -- mcs is LivePerson's own sentiment score and is kept for analysis only.
    csatScore       int           NULL,
    csatScoreMax    int           NULL,
    csatComment     nvarchar(MAX) NULL,
    csatRespondedAt datetime2     NULL,
    mcs             int           NULL,
    alertedMcs      bit           NULL,

    -- survey
    surveyType        varchar(50)   NULL,
    surveyStatus      varchar(50)   NULL,
    surveyAnswersJson nvarchar(MAX) NULL,  -- [{block,question,answer,...}]

    -- content
    transcriptRaw          nvarchar(MAX) NULL,  -- transcriptAll verbatim
    transcriptJson         nvarchar(MAX) NULL,  -- -> interaction_transcripts.text
    transcriptMessageCount int           NULL,
    transcriptParseStatus  varchar(20)   NULL,  -- parsed|partial|unparsed|empty
    summaryText            nvarchar(MAX) NULL,

    -- provenance / QA
    rawJson          nvarchar(MAX) NOT NULL,      -- whole source row, PII-stripped
    piiRedacted      bit NOT NULL
                       CONSTRAINT DF_import_conv_pii DEFAULT 0,
    -- valid | warning | error | duplicate | existing
    validationStatus varchar(20) NOT NULL
                       CONSTRAINT DF_import_conv_vstatus DEFAULT 'pending',
    validationJson   nvarchar(MAX) NULL,  -- [{level,code,field,message,original}]
    excluded         bit NOT NULL
                       CONSTRAINT DF_import_conv_excl DEFAULT 0,
    excludedReason   nvarchar(400) NULL,
    -- NULL => excluded by the machine (revalidate may clear it); non-NULL => a
    -- human excluded it and revalidate must preserve that.
    excludedBy       varchar(200) NULL,

    -- pending | promoted | skipped | failed
    promoteStatus    varchar(20) NOT NULL
                       CONSTRAINT DF_import_conv_pstatus DEFAULT 'pending',
    -- Pre-generated before insert so child rows can join without a round trip,
    -- and so a re-promote is a no-op.
    promotedInteractionId uniqueidentifier NULL,
    promoteError     nvarchar(1024) NULL,

    createdAt datetime2 NOT NULL
                CONSTRAINT DF_import_conv_created DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_conv_run_row' AND object_id = OBJECT_ID('app.import_conversations'))
  CREATE UNIQUE INDEX IX_import_conv_run_row ON app.import_conversations (importRunId, rowNumber);
GO
-- NOTE: no unique index on (sourceKey, srcConversationId) by design. In-file
-- duplicates must be VISIBLE and flagged for the operator, not rejected
-- mid-parse, and re-staging a file after a discard is legitimate. Uniqueness is
-- enforced at promote time.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_conv_run_status' AND object_id = OBJECT_ID('app.import_conversations'))
  CREATE INDEX IX_import_conv_run_status ON app.import_conversations (importRunId, validationStatus)
    INCLUDE (excluded, promoteStatus, rowNumber);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_conv_srckey' AND object_id = OBJECT_ID('app.import_conversations'))
  CREATE INDEX IX_import_conv_srckey ON app.import_conversations (sourceKey, srcConversationId)
    INCLUDE (promoteStatus, importRunId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_conv_promote' AND object_id = OBJECT_ID('app.import_conversations'))
  CREATE INDEX IX_import_conv_promote ON app.import_conversations (importRunId, promoteStatus)
    INCLUDE (excluded, validationStatus);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_conv_interactionId' AND object_id = OBJECT_ID('app.import_conversations'))
  CREATE INDEX IX_import_conv_interactionId ON app.import_conversations (interactionId);
GO


-- ─── derived messages (split from the inline transcript) ─────────────────────
-- Staged so the operator can see the parsed chat bubbles BEFORE promoting, and
-- so mis-classified speakers are visible rather than silently dropped.
IF OBJECT_ID('app.import_messages', 'U') IS NULL
BEGIN
  CREATE TABLE app.import_messages (
    id           uniqueidentifier NOT NULL
                   CONSTRAINT DF_import_msg_id DEFAULT NEWID()
                   CONSTRAINT PK_import_messages PRIMARY KEY,
    importRunId  uniqueidentifier NOT NULL,
    conversationStageId uniqueidentifier NOT NULL
                   CONSTRAINT FK_import_msg_conv FOREIGN KEY
                   REFERENCES app.import_conversations(id) ON DELETE CASCADE,
    rowNumber    int          NOT NULL,   -- parent row, denormalised for the UI
    seq          int          NOT NULL,   -- 0-based order within the conversation
    source       varchar(16)  NOT NULL,   -- Agent|Customer|System|Bot|Unknown
    sender       nvarchar(200) NULL,      -- verbatim label from the line
    timestampText varchar(40) NULL,       -- verbatim HH:MM[:SS]
    timestampIso  varchar(32) NULL,       -- reconstructed naive-local ISO
    -- Days past the conversation start, from the midnight-rollover walk. Without
    -- this an overnight chat computes negative response times.
    dayOffset    int NOT NULL
                   CONSTRAINT DF_import_msg_day DEFAULT 0,
    content      nvarchar(MAX) NULL,
    charCount    int NULL,
    isAuto       bit NULL,   -- matched an automated-nudge pattern
    isHandover   bit NULL,   -- matched the bot/human handover marker
    -- 0 for Unknown speakers: staged and visible, but excluded from the promoted
    -- transcript so they cannot corrupt the response-time metrics.
    includedInTranscript bit NOT NULL
                   CONSTRAINT DF_import_msg_incl DEFAULT 1,
    parseWarning varchar(200) NULL,
    createdAt datetime2 NOT NULL
                CONSTRAINT DF_import_msg_created DEFAULT SYSUTCDATETIME()
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_msg_conv' AND object_id = OBJECT_ID('app.import_messages'))
  CREATE INDEX IX_import_msg_conv ON app.import_messages (conversationStageId, seq);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_import_msg_run' AND object_id = OBJECT_ID('app.import_messages'))
  CREATE INDEX IX_import_msg_run ON app.import_messages (importRunId, rowNumber);
GO
