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

2026-05-17
- Parity (equity-parity finance review) campaign — phase 1 backend. New columns
  app.interactions.maturityDate + daysToMaturityAtInteraction (auto-computed by
  a @BeforeInsert/@BeforeUpdate hook on Interaction) and
  app.interaction_insights.campaign_answers_json. Migration:
  backend/sql/add-parity-campaign.sql (also DELETEs the seeded call.base row
  so it reseeds with new {{campaign_qa_section}} / {{campaign_qa_schema}}
  placeholders).
- Three new prompt fragments — call.campaign.Parity, call.campaign.Parity.qa,
  call.campaign.Parity.qa_schema — extracting a 12-item Q&A + ranked
  key_competitor_drivers into campaign_answers_json. composeCallPrompt now
  pairs any campaign's .qa + .qa_schema fragments generically.
- Phase 2 dashboard spec parked at prompts/parity campaign phase 2 - dashboard.txt
  (Client Services widgets, maturity-bucket analytics, four new /uiapi/insights/parity/*
  endpoints). APP_VERSION → 1.3.0.

2026-05-21
- Added vehicleMake / vehicleModel columns to app.interactions for filtering on
  the Client Services dashboard. Migration: backend/sql/add-vehicle-make-model.sql.
  Filter wired through all 7 dashboard endpoints (summary + drill-downs) via
  applyFilters / buildRawFilters. APP_VERSION → 1.7.0.

2026-06-04
- Fixed make/model filters not applying to the Parity campaign-analysis panel and its
  drill-downs on the Client Services dashboard: getParityCampaignAnalysis /
  getParityInteractions accepted vehicleMake/vehicleModel but dropped them when calling
  buildRawFilters. Also added make/model to the dashboard's period-comparison query
  (compareParams) so comparison columns filter consistently. APP_VERSION → 1.7.1.
- Reworked the Parity call-campaign Q&A prompt (seed-fragments.ts) for clearer model
  output: every item is now a yes/no answer with trigger/indicator lists, the four
  "view" items ask "expressed a NEGATIVE view?" (yes/no) instead of capturing
  positive/negative/neutral sentiment, and lifestyle_change_financial was dropped.
  Added an advisor-perspective note to call.campaign.Parity (no finance discussed —
  invite to a dealer account review / valuation / test drive).
- Updated call.campaign.Parity.qa_schema to match, plus the dependent dashboard wiring:
  getParityCampaignAnalysis now buckets views as yes/no; getParityInteractions filters
  on viewAnswer (was viewSentiment) and drops lifestyleFinancialAnswer; controller param
  renamed viewSentiment→viewAnswer. ClientServicesDashboard.vue + InteractionDetailDrawer.vue
  render the yes/no negative-view model.
- Migration: backend/sql/update-parity-qa-yesno.sql DELETEs the three call.campaign.Parity*
  rows so they reseed on restart (seedIfMissing only inserts missing keys). Pre-rework
  interactions keep the old shape and show views as "not raised" until re-processed.
  APP_VERSION → 1.8.0.
- Client Services make/model filters: (1) chained the model dropdown to the selected
  make — getFilterOptions now returns DISTINCT make+model pairs and the dashboard derives
  the model list from the chosen make; (2) made the model filter multi-select (like
  Exclude Outcomes). vehicleModel (single, "=") became vehicleModels (CSV, "IN (...)")
  across applyFilters / buildRawFilters and all 7 controller endpoints; the filter-options
  endpoint return shape changed from string[] to {make, model}[]. APP_VERSION → 1.9.0.
- Fix: the new make+model pairs query in getFilterOptions used SELECT DISTINCT across two
  columns + a two-column ORDER BY, which threw on the MSSQL driver — and because the
  frontend swallows filter-load errors, the whole /summary/filters response failed and BOTH
  the Make and Model filters silently disappeared. Reworked to fetch the two columns plainly
  and dedupe/sort in JS. APP_VERSION → 1.9.1.
- Migration: backend/sql/fix-call-base-qa-placeholders.sql — heals environments whose
  call.base predates the {{campaign_qa_section}} / {{campaign_qa_schema}} placeholders.
  Without those slots the composer resolves a campaign's .qa/.qa_schema fragments but has
  nowhere to inject them, so campaign_answers is never requested and campaign_answers_json
  stays empty (e.g. Parity) while every other field populates. DELETEs call.base only when
  it lacks the schema placeholder (idempotent); restart the backend to reseed the canonical
  base. No app code change — operational fix only.
- Fix: raised AnthropicProvider max_tokens 8000 → 16000. Once call.base began injecting the
  Parity Q&A, the full insights JSON (13 operations dimensions + coaching + client services
  + 11-item campaign_answers + competitor drivers) exceeded 8000 output tokens and the model
  truncated mid-JSON, failing as "Invalid JSON". Also logs a clear warning when a response
  stops on max_tokens. APP_VERSION → 1.9.2.
- Client Services Parity panel + filters polish (frontend, plus drill-down backend fields):
  * Consent + "already decided" now sit side by side; "Consent to Dealer Contact" relabel.
  * View cards: "View on Brand/Current Vehicle/Dealer/Finance Agreement"; chips shortened to
    negative / none; each section's drill-down now shows that section's own summary/detail +
    customer quote (getParityInteractions projects per-section summary/detail/quote).
  * Affordability/Lifestyle chips now red for "yes" (a concern), green for "no".
  * Filters restructured into a two-side panel: left = From/To/Channel then Campaign/Agent
    then Load; right = a 4-row grid lining up Make/Model (col 1) with Outcomes (col 2), with
    a Select all / Clear all toggle on the outcomes list.
  * interactionTpsId shown bottom-right of every drill-down item (added to all drill SELECTs).
  APP_VERSION → 1.9.3. NOTE: backend redeploy needed for the per-section drill content + TPS id.

