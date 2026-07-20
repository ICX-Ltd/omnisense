-- =============================================================================
-- NMGB Survey: transcript-insight storage + call.base placeholder re-seed
-- Run against the ai_insight database.
--
-- What this does:
--   1. Adds app.interaction_insights.campaign_transcript_json (NVARCHAR(MAX) NULL)
--      → A SECOND campaign blob, separate from campaign_answers_json. For NMGB
--        Survey, campaign_answers_json holds the structured survey feed and is
--        nulled/restored around each LLM run by sql/nmgb_survey_backfill.sql.
--        Transcript-derived insights (positives/negatives, competitor make+model,
--        frustrations, quotes) live here instead so the backfill never clobbers
--        them. Written only by the LLM; left untouched by the survey backfill.
--   2. Re-seeds call.base ONLY when it lacks the new
--        {{campaign_transcript_section}} / {{campaign_transcript_schema}}
--      placeholders, so the backend reseeds the current body on next boot.
--      Idempotent — a base that is already current is left untouched.
--
-- The three new NMGB Survey fragments (call.campaign.NMGB Survey,
-- .transcript, .transcript_schema) do not exist yet, so PromptsService
-- seedIfMissing inserts them automatically on next boot — no action needed here.
--
-- ⚠ If you have hand-edited call.base via the prompts admin UI, copy your
--   version out before running — the re-seed reverts it to the shipped body.
-- =============================================================================

-- ─── 1. app.interaction_insights.campaign_transcript_json ────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('app.interaction_insights')
    AND name = 'campaign_transcript_json'
)
BEGIN
  ALTER TABLE app.interaction_insights
    ADD campaign_transcript_json NVARCHAR(MAX) NULL;
END;
GO

-- ─── 2. Force re-seed of call.base (only if missing the new placeholders) ─────
IF OBJECT_ID('app.prompt_templates', 'U') IS NOT NULL
BEGIN
  DELETE FROM app.prompt_templates
  WHERE [key] = 'call.base'
    AND body NOT LIKE '%{{campaign_transcript_schema}}%';
END;
GO
