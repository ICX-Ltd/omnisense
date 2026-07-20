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

2026-06-09
- Insights batch processing now runs concurrently. runBatchBackground (recordings.service.ts)
  replaces its serial for-loop with a bounded worker pool (default 5, tunable via
  INSIGHTS_BATCH_CONCURRENCY); cursor++ hands out each id once and progress/errorCount stay
  atomic, so a batch is bottlenecked on the slowest N in flight rather than the sum of all.
  Backend redeploy needed to take effect. APP_VERSION → 1.9.4.

2026-06-10
- Client Services overview reworked. Dropped the redundant Dealer Leads / In-Market /
  Lost Sales / Bought Elsewhere stat cards; replaced with a "Negative View Rate" card —
  share of Parity customers who raised ANY negative view (brand/vehicle/dealer/finance),
  with side-by-side period comparison. New backend aggregate any_negative_view in
  getParityCampaignAnalysis (distinct-customer OR, not a sum of per-view flags);
  denominator is parity-answered total. Card shows "—" outside the Parity campaign.
- Added two volume-breakdown donuts in the overview strip: "By Outcome" and
  "By Vehicle Make". New OutcomeDonut.vue (hand-rolled SVG, no chart lib) with a legend
  + compare-period share. Backed by new by_outcome / by_vehicle_make aggregations in
  getClientServicesMetrics (same applyFilters treatment as by_interest).
- Added a "dealer" chip to every Client Services drill-down row and the detail drawer.
  Source-of-truth change: dealer was LLM-extracted (interaction_insights.dealer_name);
  now reads COALESCE(ia.dealer, ii.dealer_name) — new source column wins, LLM as fallback.
  Migration: backend/sql/add-dealer-to-interactions.sql (adds app.interactions.dealer
  NVARCHAR(200) + filtered index). RUN IT, and have the upstream loader populate the
  column; rows with no source dealer keep showing the model's guess until then. New chip--dealer
  variant in components.css.
- Dealer chips show a "*" (with hover tooltip) when the value was inferred from the transcript
  rather than supplied by the source feed. Backend emits a dealer_inferred flag on every
  dealer-bearing row + the detail drawer; empty-string source values are treated as missing
  (NULLIF) so they fall back and are marked inferred. NOTE: the dealer queries now reference
  ia.dealer, so add-dealer-to-interactions.sql MUST be applied before deploying this backend.
  APP_VERSION → 1.11.0.
- Fix: the Parity "Why competitor wins" and "Competitor brands cited" drill-downs showed the
  generic interaction summary_short instead of competitor-specific text. The model already
  captures competitor_vehicle.quote, competitor_reasons.detail and competitor_reasons.quote in
  campaign_answers_json, but getParityInteractions never projected them. Now projects all three;
  the drills render competitor_reasons_detail as the summary (dimmed summary_short fallback) plus
  a competitor_reasons_quote / competitor_vehicle_quote line — matching the Views/Situation
  sections. Backend redeploy needed; older records without those JSON fields keep the fallback
  until reprocessed.

2026-06-13
- Client Services drill-downs are now independently open/closeable — opening one no longer
  collapses the others. Every section had a single "which row is open" value; the whole Parity
  section shared ONE state, so the four negative-view cards (brand/vehicle/dealer/finance) and
  every other parity drill were mutually exclusive. Replaced per-section single-state with
  per-key maps (open flag + interactions + loading), keyed by each drill's id, across all
  sections: Parity (consent, decision, the 4 views, circumstances, competitor reasons, competitor
  brands), Customer Interest, Competitor Purchases, and Sales Opportunity reasons. The Views and
  Circumstances cards were restructured so each yes/no bucket row owns its own drill panel
  (was one shared panel per card via a startsWith match). Each open re-fetches its own rows.
  Frontend-only. APP_VERSION → 1.12.0.
- Quote grounding (QA trust signal). New backend/src/insights/quote-grounding.ts verifies that
  the LLM's extracted verbatim campaign quotes (consent/decision/the 4 views/affordability/
  lifestyle/dealer-in-touch/competitor/key_competitor_drivers) actually appear in the transcript —
  deterministic, no extra model call. Normalizes text, fast-paths exact substring, else scores
  best sliding-window token coverage; >=0.7 verified, >=0.45 weak, else "missing" (likely a
  fabricated/mis-attributed quote). getInteractionDetail now returns insight.quote_grounding;
  the detail drawer shows a "Quote Grounding" panel (verified/weak/not-found counts + the flagged
  quotes). Unit-tested (quote-grounding.spec.ts, 6 cases). Frontend + backend; backend redeploy
  needed. First slice of the QA data-trust toolkit. APP_VERSION → 1.13.0.
- Insights extraction reliability (fixes the intermittent "Invalid JSON" failures that needed
  manual batch re-runs). Root cause was output truncation: at temperature 0.1 the large insights
  JSON occasionally ran past the token cap and got cut mid-structure, so the SAME record failed on
  one sample and passed on a re-roll. Changes (insights.service.ts + providers/*):
  * Bounded auto-retry in extractInsights — re-rolls on invalid-JSON OR truncation, default 2
    retries (3 attempts), tunable via INSIGHTS_EXTRACT_RETRIES. Automates the manual re-run.
  * Providers now report a `truncated` flag (stop_reason max_tokens / status incomplete /
    finishReason MAX_TOKENS) so a truncated-but-parseable response is rejected, not persisted.
  * Anthropic: raised max_tokens 16000 → 32000 (Haiku 4.5 ceiling is 64k; env
    ANTHROPIC_INSIGHTS_MAX_TOKENS) and switched to streaming (required above ~16k to avoid SDK
    HTTP timeouts).
  * Structured output / JSON mode where supported: OpenAI responses text.format json_object,
    Gemini responseMimeType application/json. Grok leans on salvage+retry (x.ai json-mode is
    unreliable).
  * cleanJsonText hardened to salvage the outermost {...} when the model wraps JSON in prose.
  Unit tests: clean-json-text.spec.ts (7 cases). Backend-only; redeploy needed. NOTE: full
  json_schema structured output for Anthropic was deferred — the payload is large and
  campaign-variable; retry+streaming+salvage already removes the failure mode. APP_VERSION → 1.14.0.
- Insights token-usage & cost tracking (monitor spend in-app, no provider console). Providers now
  return per-call token usage; extractInsights accumulates it and also tracks tokens burned on
  FAILED attempts (retry waste). generateInsights persists per-record:
  insight_input_tokens / _output_tokens / _attempts / _failed_input_tokens / _failed_output_tokens.
  Migration: backend/sql/add-insight-usage.sql (5 INT columns, idempotent — RUN IT).
  New GET /uiapi/insights/usage (getInsightsUsage) aggregates totals + per provider/model, retry
  rate, wasted tokens, and est cost via a price table (DEFAULT_MODEL_PRICES, USD; override/extend
  + change currency via INSIGHTS_PRICES_JSON / INSIGHTS_PRICES_CURRENCY — unpriced models show
  tokens but no cost). New InsightsUsagePanel.vue surfaced at the top of the Batch Dashboard
  (date range + channel + per-model table).
  SPEND GUARD: batch insight runs share an ExtractBudget circuit breaker — once cumulative wasted
  tokens exceed INSIGHTS_BATCH_FAILED_TOKEN_BUDGET (default 5,000,000; 0 = off) the batch stops
  retrying (one shot per remaining record) so a bad run can't run away on cost. Backend redeploy +
  migration needed. NOTE: fully-failed records have no insight row, so their tokens are logged +
  counted in the batch budget but not in the usage dashboard (which covers persisted records).
  APP_VERSION → 1.15.0.
- Per-attempt LLM usage log (captures EVERY attempt, incl. fully-failed records the per-record
  view misses). New entity LlmUsageLog → table app.llm_usage_log (migration
  backend/sql/add-llm-usage-log.sql — RUN IT; registered in app.module + recordings.module).
  extractInsights gained an onAttempt callback fired once per attempt (success/invalid_json/
  truncated/empty) with provider/model/tokens; generateInsights collects them and writes the log
  in a finally (so failures are recorded too, best-effort, never masks the original error).
  getInsightsUsage now returns an `all_attempts` block (joined to interactions for the same
  date/filter window) = complete spend incl. retries + failed records, guarded so it returns null
  until the migration is applied. InsightsUsagePanel shows an "All attempts (incl. retries &
  failed records)" line beneath the per-record stats. Backend redeploy + migration needed.
  APP_VERSION → 1.16.0.
- Transcription usage & cost tracking (the insights tracker above did NOT cover transcription —
  this adds it). Transcription is priced per audio-MINUTE, so it's a separate table
  app.transcription_usage_log (entity TranscriptionUsageLog; migration
  backend/sql/add-transcription-usage-log.sql — RUN IT; registered in app.module +
  recordings.module). transcribeRecordingById logs every attempt (success/error) in a finally with
  provider/model/audioSeconds. Deepgram duration captured from metadata.duration (transcribeUrl now
  returns durationSeconds) = accurate per-minute cost; OpenAI gpt-4o-transcribe doesn't report
  duration so it's logged event-only (no cost) — per decision. getInsightsUsage returns a
  `transcription` block (per provider/model, minutes, est cost) via a per-minute price table
  (DEFAULT_TRANSCRIPTION_PRICES, override TRANSCRIPTION_PRICES_JSON) + a combined insights+
  transcription cost in the panel. Guarded → null until migration applied. Backend redeploy +
  migration needed. FUTURE_SUGGESTIONS.md added (golden-set harness parked + other backlog).
  APP_VERSION → 1.17.0.

2026-06-19
- Parity campaign-analysis visual redesign (ClientServicesDashboard.vue + new ParitySegmentBar.vue).
  Replaced the stack of one bar-row-per-bucket with a single 100% segmented bar: negative/none read
  red→green, three-way questions read yes·n/a·no, with stats + drill-downs below each segment.
  Regrouped the Parity tile into two rows — Customer Decision (consent + decision) beside Customer
  Circumstances, Customer Views below; Competitors is now a 3-column row (identified · why-wins ·
  brands cited, with fixed-width truncating label chips). Period comparison adds a second ghost bar
  with repeated per-period stats and a per-segment volume/percentage-point difference row. On the
  Parity campaign the generic client-services sections (interest, competitor purchases/objections,
  follow-ups, lost sales) are hidden, and the campaign-filter banner moved above the headline stats.
  Frontend-only. APP_VERSION → 1.18.0.
- Operations dashboard layout + chat-response fixes (OperationsDashboard.vue, plus one backend change).
  * Slowest Agents / Slowest Chats reformatted as compact side-by-side tables. Slowest Agents is now
    the FULL cross-agent leaderboard (no longer filtered to the selected agent — backend
    insights-summary.service.ts worst_by_agent passes undefined for agent; REDEPLOY needed), with the
    selected agent's row highlighted. Slowest Chats stays scoped to the selected agent.
  * Chat Response Time tile no longer disappears when the selected agent has no measured chats — it
    shows a "no measured chat responses" note and still renders the all-agents leaderboard. The
    "Comparing <agent> vs overall" banner moved above the chat-response section.
  * Dimension Averages + QA Assessment Averages now sit side by side (two columns). Lowest Scored
    moved into the grid as the 3rd column of the Outcome Distribution row; Sales Opportunity moved
    beside Objection Handling as a two-visual row. Objection-handling totals restyled to reuse the
    Sales Opportunity summary-strip styles. Frontend + 1 backend tweak. APP_VERSION → 1.19.0.
- Renamed nav tabs + page headers: "Operations" → "Operations (QC)", "Client Services" →
  "Campaign Insights" (App.vue + the two dashboard hero titles). Frontend-only. APP_VERSION → 1.19.1.


2026-07-20
- LLM providers (OpenAI/Anthropic/Grok) now set maxRetries (env OPENAI/ANTHROPIC/XAI_MAX_RETRIES,
  default 6) so batch insights ride out 429 rate-limit (TPM) windows instead of failing the record.
  For low-TPM gpt-4o runs also lower INSIGHTS_BATCH_CONCURRENCY (e.g. 2). Gemini SDK has no equivalent knob.
- Survey Analytics: every stat tile is now drillable to its records - overview strip, model performance,
  dealership ratings, dealer visits, Chinese-OEM threat, quarterly trend, and all transcript-insight
  tiles - each drill row opening the detail drawer. New criteria on drill-records + a new
  transcript-drill-records endpoint over campaign_transcript_json; getRecordDetail relaxed to open
  transcript-only records; drawer gained a Transcript Insights section. (Reminder: backfilled survey
  rows must have conversation_type='survey' or nothing renders.)
- Narratives page now renders saved survey briefings with full rich formatting via a new shared
  NarrativeBriefing.vue (SurveyDashboard.vue refactored to import it, removing the duplicated markup/styles).
  Narrative-generation prompts are now editable on the Prompts page as narrative.* fragments (restart
  backend to seed the new rows); keep the {{metrics}} / {{free_text_samples}} placeholders when editing.
  Added a text filter box to the Prompts list. APP_VERSION -> 1.32.0.
