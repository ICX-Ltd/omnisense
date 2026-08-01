-- =============================================================================
-- REQUIRED for the data importer. Run against the ai_insight database.
-- Idempotent, non-unique, additive — always safe to apply.
--
-- WHY THIS IS NOT OPTIONAL
--
-- Every insert in the promote path carries the guard
--
--   NOT EXISTS (SELECT 1 FROM app.interactions i
--                WHERE i.interactionSource = c.sourceKey
--                  AND i.interactionId     = c.interactionId)
--
-- which is what makes a re-promote a no-op instead of a duplicate. Without an
-- index on those two columns SQL Server has to scan app.interactions once per
-- staged row, inside the promote transaction. On a real 9,742-row import that
-- took the production site down: the transaction held locks on app.interactions
-- long enough that every other query backed up behind it and the app stopped
-- responding (502s at the proxy).
--
-- The same two columns are also compared by the "already imported" validation
-- pass that runs at the end of staging, so this helps there too.
--
-- DELIBERATELY NON-UNIQUE. add-interactions-source-key-unique.sql adds a UNIQUE
-- filtered index over the same columns, which additionally turns a concurrent
-- double-promote into a catchable 2601/2627 — but that one cannot be applied
-- while duplicate source keys exist, so it stays opt-in. This index has no such
-- precondition and is the one that matters for performance.
-- =============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
   WHERE name = 'IX_interactions_source_key'
     AND object_id = OBJECT_ID('app.interactions')
)
  CREATE INDEX IX_interactions_source_key
    ON app.interactions (interactionSource, interactionId);
GO
