-- =============================================================================
-- Reseeds the Parity call-campaign prompt fragments after the Q&A rework.
-- Run against the ai_assist database, then restart the backend so
-- PromptsService.onModuleInit re-seeds the deleted rows from seed-fragments.ts.
--
-- Why DELETE rather than UPDATE:
--   seedIfMissing() only INSERTs when a key is absent. Removing the rows is
--   the supported way to ship new fragment content (see prompt conventions).
--
-- What changed in the rework (seed-fragments.ts):
--   * call.campaign.Parity         — added the advisor-perspective note
--                                     (no finance discussed; invite to a dealer
--                                      account review / valuation / test drive).
--   * call.campaign.Parity.qa      — every item is now a yes/no answer with
--                                     trigger/indicator lists; the four "view"
--                                     items ask "expressed a NEGATIVE view?"
--                                     (yes/no) instead of capturing sentiment;
--                                     lifestyle_change_financial removed.
--   * call.campaign.Parity.qa_schema — matches the above (views drop
--                                     expressed/sentiment for answer/summary;
--                                     lifestyle_change_financial removed).
--
-- NOTE on existing data: rows already extracted under the OLD schema keep the
-- sentiment-based view shape and lifestyle_change_financial in
-- campaign_answers_json. The dashboard now reads the yes/no view answers, so
-- pre-rework interactions will show those views as "not raised" until they are
-- re-processed. No backfill is performed here.
-- =============================================================================

DELETE FROM app.prompt_templates
WHERE [key] IN (
  'call.campaign.Parity',
  'call.campaign.Parity.qa',
  'call.campaign.Parity.qa_schema'
);
GO
