-- =============================================================================
-- Remove chat response-time fragments from the LLM prompt pipeline.
--
-- Chat response-time metrics are now computed deterministically in backend
-- code (backend/src/insights/chat-response-time.ts) using the structured
-- HH:MM:SS-source: content format of the transcript. The LLM is no longer
-- asked for them.
--
-- This migration:
--   1) Patches the chat.base body to remove the {{response_time_section}}
--      and {{response_time_schema}} placeholders that no longer have a
--      substitution target.
--   2) Marks chat.response_time and chat.response_time_schema as inactive
--      (isActive = 0) so the composer's getActiveByKey lookup misses them.
--      Rows are kept around so the history snapshot remains intact.
--
-- A chat.base history snapshot is written before the patch. Re-runs are
-- no-ops because we guard on the absence of the deprecated placeholder.
-- =============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

-- ─── chat.base: strip the response-time placeholders ────────────────────────

IF EXISTS (
  SELECT 1 FROM app.prompt_templates
  WHERE [key] = 'chat.base'
    AND body LIKE N'%{{response_time_section}}%'
)
BEGIN
  INSERT INTO app.prompt_template_history
    (promptTemplateId, [key], version, body, label, notes, updatedById)
  SELECT id, [key], version, body, label, notes, updatedById
  FROM app.prompt_templates
  WHERE [key] = 'chat.base';

  -- Remove the standalone section placeholder line.
  -- The substituted value was always wrapped in the section text; removing
  -- the bare placeholder leaves the surrounding whitespace harmless.
  UPDATE app.prompt_templates
  SET body = REPLACE(
              body,
              CHAR(13) + CHAR(10) + N'{{response_time_section}}',
              N''
            )
  WHERE [key] = 'chat.base';

  UPDATE app.prompt_templates
  SET body = REPLACE(
              body,
              CHAR(10) + N'{{response_time_section}}',
              N''
            )
  WHERE [key] = 'chat.base';

  -- Remove the schema placeholder line (with its surrounding blank line
  -- + comma + indentation) from the JSON SCHEMA block.
  UPDATE app.prompt_templates
  SET body = REPLACE(
              body,
              CHAR(13) + CHAR(10) + CHAR(13) + CHAR(10)
                + N'  {{response_time_schema}},',
              N''
            )
  WHERE [key] = 'chat.base';

  UPDATE app.prompt_templates
  SET body = REPLACE(
              body,
              CHAR(10) + CHAR(10) + N'  {{response_time_schema}},',
              N''
            ),
      version    = version + 1,
      updatedAt  = SYSUTCDATETIME()
  WHERE [key] = 'chat.base';

  PRINT 'chat.base patched — placeholders removed, version bumped.';
END
ELSE
BEGIN
  PRINT 'chat.base already free of response-time placeholders — skipping.';
END;

-- ─── chat.response_time + chat.response_time_schema: deactivate ─────────────

UPDATE app.prompt_templates
SET isActive  = 0,
    notes     = N'DEPRECATED — chat response-time metrics are now computed in backend code. See backend/src/insights/chat-response-time.ts.',
    updatedAt = SYSUTCDATETIME()
WHERE [key] IN ('chat.response_time', 'chat.response_time_schema')
  AND isActive = 1;

PRINT 'chat.response_time + chat.response_time_schema deactivated (if present).';

COMMIT TRANSACTION;
GO

SELECT [key], version, isActive, LEN(body) AS body_len
FROM app.prompt_templates
WHERE [key] IN ('chat.base', 'chat.response_time', 'chat.response_time_schema')
ORDER BY [key];
GO
