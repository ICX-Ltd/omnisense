-- =============================================================================
-- Client (tenant) scoping — app.clients + client_id on interactions,
-- insight_summaries, account (idempotent)
-- =============================================================================
-- Adds the data model for restricting a "client" role (and an admin's "view as"
-- preview) to one client's data. app.clients is a small lookup table rather
-- than a bare string column, so there's a real FK target, a display name, and
-- room to grow. client_id is NOT duplicated onto interaction_insight /
-- interaction_survey / interaction_csat — those already join back to
-- interactions via recordingId in every query, so scoping them is one more
-- `AND ia.clientId = @n` on that existing join rather than a second column
-- that can drift (the same drift problem those tables already have with their
-- own independently-duplicated `campaign` columns).
--
-- Run against the ai_insight database with a DDL-capable login.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.tables t
  JOIN sys.schemas sc ON sc.schema_id = t.schema_id
  WHERE sc.name = 'app' AND t.name = 'clients'
)
BEGIN
  CREATE TABLE app.clients (
    id         uniqueidentifier NOT NULL CONSTRAINT DF_clients_id DEFAULT NEWID(),
    name       nvarchar(100)    NOT NULL,
    [key]      varchar(50)      NOT NULL,
    active     bit              NOT NULL CONSTRAINT DF_clients_active DEFAULT 1,
    createdAt  datetime2        NOT NULL CONSTRAINT DF_clients_createdAt DEFAULT SYSDATETIME(),
    CONSTRAINT PK_clients PRIMARY KEY (id),
    CONSTRAINT UQ_clients_key UNIQUE ([key])
  );
END;
GO

-- Seed the two clients already identifiable in the data (NMGB/Nissan campaigns,
-- and the RAC campaign). Idempotent — safe to re-run.
IF NOT EXISTS (SELECT 1 FROM app.clients WHERE [key] = 'nmgb')
  INSERT INTO app.clients (name, [key]) VALUES ('NMGB (Nissan)', 'nmgb');
GO
IF NOT EXISTS (SELECT 1 FROM app.clients WHERE [key] = 'rac')
  INSERT INTO app.clients (name, [key]) VALUES ('RAC', 'rac');
GO

-- ── app.interactions.clientId ───────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interactions') AND name = 'clientId'
)
BEGIN
  ALTER TABLE app.interactions ADD clientId uniqueidentifier NULL;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_interactions_client')
  ALTER TABLE app.interactions ADD CONSTRAINT FK_interactions_client
    FOREIGN KEY (clientId) REFERENCES app.clients(id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interactions_client' AND object_id = OBJECT_ID('app.interactions'))
  CREATE INDEX IX_interactions_client ON app.interactions (clientId);
GO

-- ── app.insight_summaries.clientId (narratives) ─────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.insight_summaries') AND name = 'clientId'
)
BEGIN
  ALTER TABLE app.insight_summaries ADD clientId uniqueidentifier NULL;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_insight_summaries_client')
  ALTER TABLE app.insight_summaries ADD CONSTRAINT FK_insight_summaries_client
    FOREIGN KEY (clientId) REFERENCES app.clients(id);
GO

-- ── app.account.client_id (ties a 'client'-role user to their one client) ───
-- snake_case, matching this table's existing column convention (role_id,
-- display_name, ...) — unlike interactions/insight_summaries above, which are
-- newer tables already using camelCase columns.
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.account') AND name = 'client_id'
)
BEGIN
  ALTER TABLE app.account ADD client_id uniqueidentifier NULL;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_account_client')
  ALTER TABLE app.account ADD CONSTRAINT FK_account_client
    FOREIGN KEY (client_id) REFERENCES app.clients(id);
GO

-- ── app.import_runs.clientId (stamped onto every interaction the run creates) ─
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.import_runs') AND name = 'clientId'
)
BEGIN
  ALTER TABLE app.import_runs ADD clientId uniqueidentifier NULL;
END;
GO
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_import_runs_client')
  ALTER TABLE app.import_runs ADD CONSTRAINT FK_import_runs_client
    FOREIGN KEY (clientId) REFERENCES app.clients(id);
GO

-- =============================================================================
-- Backfill — CONSERVATIVE ON PURPOSE.
-- =============================================================================
-- The live data has ~20 distinct campaign values, not just two — including
-- dealer-group names (Marshall, Murray, HR Owen, Simon Bailes, Youles
-- Motorcycles, 5-Ways Motorcycle Centre, Clock Garage), another manufacturer
-- (Suzuki GB - 4W), and several campaign codes that plausibly belong to RAC
-- but aren't confirmed (MFS Omni Channel, Reactivation Winback, Reactivation
-- CCR, Mobilize Dealer Confirmation, Parity, ICX, Demo Dealer).
--
-- Only the UNAMBIGUOUS matches are backfilled below: NMGB-prefixed campaigns,
-- and the exact 'RAC' campaign. Everything else is left with clientId = NULL
-- (safe by default — an unassigned row never appears in ANY client-scoped
-- view, only to internal staff who see everything regardless). Re-run this
-- block after confirming the remaining campaign -> client mapping.
-- =============================================================================

UPDATE ia
  SET clientId = (SELECT id FROM app.clients WHERE [key] = 'nmgb')
FROM app.interactions ia
WHERE ia.campaign LIKE 'NMGB%'
  AND ia.clientId IS NULL;
GO

UPDATE ia
  SET clientId = (SELECT id FROM app.clients WHERE [key] = 'rac')
FROM app.interactions ia
WHERE ia.campaign = 'RAC'
  AND ia.clientId IS NULL;
GO
