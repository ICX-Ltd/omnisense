-- =============================================================================
-- Heals an older app.prompt_templates 'call.base' row that predates the campaign
-- Q&A placeholders ({{campaign_qa_section}} / {{campaign_qa_schema}}).
--
-- Symptom this fixes:
--   For campaigns that ship a .qa + .qa_schema pair (e.g. Parity), the composer
--   (PromptsService.composeCallPrompt) resolves the fragments but has nowhere to
--   inject them because the base lacks the placeholder slots. The model is never
--   asked for campaign_answers, so interaction_insights.campaign_answers_json
--   stays empty/null while every other field populates normally.
--
-- What this does:
--   DELETEs call.base ONLY when it is missing the schema placeholder, so a base
--   that's already current is left untouched (idempotent / safe to re-run).
--   On the next backend start, PromptsService.seedIfMissing reseeds the canonical
--   call.base from seed-fragments.ts (which carries both placeholders).
--
-- AFTER RUNNING: restart the backend, confirm the log line
--   Seeded prompt fragment "call.base"
-- then reprocess a Parity call and check campaign_answers_json is populated.
--
-- CAUTION: if call.base was hand-customised via the prompt admin UI, reseeding
-- reverts it to the shipped version — re-apply those edits afterwards.
-- =============================================================================

DELETE FROM app.prompt_templates
WHERE [key] = 'call.base'
  AND body NOT LIKE '%{{campaign_qa_schema}}%';
GO
