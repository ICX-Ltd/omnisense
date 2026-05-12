-- now hooked up to ICX Ltd omnisense repository

we need to add the outcome to the interactions table and add a filter to the page to exclude multiple outcomes when doing summaries and narratives

local dev
cd "C:/DATA/ICX/ICX Applications/JakartaGit/auto-ignite-insights"
git add .
git commit -m "add..."
git push origin main

################################
TO DO 
################################

button to rerun errors

to reprocess transcriptions
set staus on interactions to transcribed
and delete from interactino_insights


################################
Updates
################################

2026-04-27
- Added prompts/ folder + workflow conventions in CLAUDE.md (prompt-file lookup, README Updates rule).
- Gitignored prompts/, CLAUDE.md, .claude/.

2026-05-04
- Tightened CHAT_RAC_OPPORTUNITY seed fragment (backend/src/modules/prompts/seed-fragments.ts):
  added MINIMUM INTENT THRESHOLD, OVERRIDE rule for new-sale journeys after lapse/service signals,
  Tesco Clubcard / payment-completion / purchase-confirmation positive signals.
- Note: seedIfMissing only inserts new rows — existing DBs need a manual update of chat.rac.opportunity.
- Operations dashboard now distinguishes "Unable to Classify" (opportunity_json present, is_opportunity NULL)
  from fully classified rows. New stat + drill-down panel in OperationsDashboard.vue, backed by a new
  "__unclassified" reason in getOpportunityMetrics / getInteractionsByOpportunityReason.
- Added diagnostic logging around the insights upsert in recordings.service.ts to capture field-length
  details when the MSSQL TDS parameter error recurs on the server.

2026-05-12
- Added chat agent response-time metrics. New prompt fragments (chat.response_time,
  chat.response_time_schema) ask the model to emit per-turn customer→agent pairs with
  is_auto_message flagging; backend aggregates avg/longest/last/SLA-breach counts
  (180s threshold, hardcoded in recordings.service.ts) and persists them on
  interaction_insights. New GET /insights/ops/chat-response-time endpoint and
  OperationsDashboard.vue tile.
- DB migrations: backend/sql/add-chat-response-metrics.sql (six columns + filtered
  index) and backend/sql/update-chat-prompts-response-time.sql (patches chat.base
  placeholders and inserts the two new fragments — idempotent).
- Reminder: seedIfMissing still only inserts missing rows, so existing DBs need
  the SQL migration; truncating prompt_templates and re-booting will seed cleanly.
- Added APP_VERSION constant at frontend/src/version.ts, rendered bottom-right
  of the login screen. Bump this every session that ships changes (SemVer:
  MAJOR breaking, MINOR feature, PATCH fix). Now at 1.1.0.

