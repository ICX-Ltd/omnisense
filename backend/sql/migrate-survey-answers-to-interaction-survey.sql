-- =============================================================================
-- One-time migration: existing survey answers -> app.interaction_survey
-- =============================================================================
-- Copies the survey feed answers that currently sit on interaction_insights
-- (conversation_type='survey', campaign_answers_json) into the new standalone
-- table. Run ONCE, AFTER add-interaction-survey.sql and BEFORE the next LLM
-- insights batch (so the answers haven't been nulled yet).
--
-- Idempotent: skips interactions already present in interaction_survey.
-- Leaves interaction_insights untouched (campaign_answers_json becomes dead for
-- surveys but harms nothing; Parity still uses that column).
-- =============================================================================

INSERT INTO app.interaction_survey (recordingId, interactionTpsId, campaign, surveyType, answersJson, respondedAt)
SELECT
  ii.recordingId,
  i.interactionTpsId,
  COALESCE(i.campaign, ii.campaign_detected),
  'nmgb'                                  AS surveyType,
  ii.campaign_answers_json                AS answersJson,
  i.interactionDateTime                   AS respondedAt
FROM app.interaction_insights ii
INNER JOIN app.interactions i ON i.id = ii.recordingId
WHERE ii.conversation_type = 'survey'
  AND ii.campaign_answers_json IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM app.interaction_survey s WHERE s.recordingId = ii.recordingId
  );
GO
