-- =============================================================================
-- OPT-IN: unique source key on app.interactions.
-- Run against the ai_insight database. Idempotent.
--
-- DO NOT RUN THIS BLINDLY. Check GET /uiapi/data-import/dedupe-report first (or
-- the query at the bottom of this file). If it returns any rows, this script
-- will FAIL — that is deliberate.
--
-- WHY
-- The importer already enforces idempotency three ways: rows are flagged
-- 'existing' before promote, every insert carries a NOT EXISTS guard, and the
-- promotedInteractionId stamp makes a re-promote a no-op. But NOT EXISTS is a
-- check-then-act race, so two concurrent promotes could still both insert. This
-- index turns that from a silent duplicate into a catchable 2601/2627.
--
-- It is filtered, so it only constrains rows that actually carry a source key —
-- manually created interactions (POST /recordings) leave both columns NULL and
-- are unaffected.
--
-- WHY IT IS SEPARATE FROM add-data-import.sql
-- Pre-existing data may legitimately violate it. The historic maxcontact loads
-- ran without any de-dupe guard (sql/interaction_build.sql has no NOT EXISTS), so
-- the same history_id may well be present twice. Cleaning that up is a judgement
-- call about real data, not something a migration should do silently.
--
-- CLEANUP ORDER, if the report is not empty:
--   interaction_transcripts and interaction_insights CASCADE from interactions.
--   interaction_csat and interaction_survey DO NOT (no FK) — deal with those
--   FIRST or they are orphaned. Keep the OLDEST row of each duplicate group.
-- =============================================================================

-- Guard: refuse to create the index while duplicates exist, with a message that
-- says how many rather than leaving a bare constraint error.
IF EXISTS (
  SELECT 1
    FROM app.interactions
   WHERE interactionSource IS NOT NULL AND interactionId IS NOT NULL
   GROUP BY interactionSource, interactionId
  HAVING COUNT(*) > 1
)
BEGIN
  DECLARE @groups int, @rows int;
  SELECT @groups = COUNT(*), @rows = SUM(n)
    FROM (SELECT COUNT(*) AS n
            FROM app.interactions
           WHERE interactionSource IS NOT NULL AND interactionId IS NOT NULL
           GROUP BY interactionSource, interactionId
          HAVING COUNT(*) > 1) d;

  DECLARE @msg nvarchar(400) =
    CONCAT('Refusing to create IX_interactions_source_interactionId: ',
           @groups, ' duplicated source key(s) across ', @rows,
           ' rows. Run the report at the bottom of this file and clean up first.');
  THROW 51000, @msg, 1;
END;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE name = 'IX_interactions_source_interactionId'
     AND object_id = OBJECT_ID('app.interactions')
)
  CREATE UNIQUE INDEX IX_interactions_source_interactionId
    ON app.interactions (interactionSource, interactionId)
    WHERE interactionSource IS NOT NULL AND interactionId IS NOT NULL;
GO

-- ─── the report, for convenience ─────────────────────────────────────────────
-- SELECT interactionSource, interactionId, COUNT(*) AS n,
--        MIN(createdAt) AS firstSeen, MAX(createdAt) AS lastSeen
--   FROM app.interactions
--  WHERE interactionSource IS NOT NULL AND interactionId IS NOT NULL
--  GROUP BY interactionSource, interactionId
-- HAVING COUNT(*) > 1
--  ORDER BY COUNT(*) DESC;
