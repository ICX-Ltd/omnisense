-- =============================================================================
-- CSAT raise tracking + client response
-- =============================================================================
-- Closes the loop after a supervisor marks a record 'raise_with_client':
--
--   1. RAISED    — the record has actually been sent to the client. Set in bulk
--                  when exporting the "Raise with client" list, or per record by
--                  hand. raisedAt NULL = reviewed as raiseable but not yet sent.
--   2. RESPONDED — the client came back on it:
--                    'accepted' = client accepts the contest, no longer a fail
--                    'rejected' = client insists it stands as a fail
--                  clientResponseComment explains their decision (required in
--                  the UI, so we always know WHY).
--
-- raisedAt and clientOutcome get dedicated indexed columns because the board
-- filters/groups on them. clientResponseComment is display-only free text, but
-- it belongs to a single decision (not a thread) so it is its own column rather
-- than going in reviewerCommentsJson.
--
-- Run against the ai_insight database. Idempotent.
-- =============================================================================

IF COL_LENGTH('app.interaction_csat', 'raisedAt') IS NULL
  ALTER TABLE app.interaction_csat ADD raisedAt datetime2 NULL;
GO
IF COL_LENGTH('app.interaction_csat', 'raisedBy') IS NULL
  ALTER TABLE app.interaction_csat ADD raisedBy varchar(120) NULL;
GO

-- 'accepted' (contest upheld, no longer a fail) | 'rejected' (still a fail)
IF COL_LENGTH('app.interaction_csat', 'clientOutcome') IS NULL
  ALTER TABLE app.interaction_csat ADD clientOutcome varchar(20) NULL;
GO
IF COL_LENGTH('app.interaction_csat', 'clientRespondedAt') IS NULL
  ALTER TABLE app.interaction_csat ADD clientRespondedAt datetime2 NULL;
GO
IF COL_LENGTH('app.interaction_csat', 'clientResponseBy') IS NULL
  ALTER TABLE app.interaction_csat ADD clientResponseBy varchar(120) NULL;
GO
IF COL_LENGTH('app.interaction_csat', 'clientResponseComment') IS NULL
  ALTER TABLE app.interaction_csat ADD clientResponseComment nvarchar(MAX) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_csat_raised' AND object_id = OBJECT_ID('app.interaction_csat'))
  CREATE INDEX IX_interaction_csat_raised ON app.interaction_csat (raisedAt);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_interaction_csat_client_outcome' AND object_id = OBJECT_ID('app.interaction_csat'))
  CREATE INDEX IX_interaction_csat_client_outcome ON app.interaction_csat (clientOutcome);
GO
