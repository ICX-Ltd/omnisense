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


2026-07-21
- In-drawer QA correction loop: reviewers can now correct AI insight fields from the shared
  interaction drawer via a pencil (Summary, QA overall/section scores, each QA answer, and Campaign
  Q&A answers). Corrections are logged separately in app.insight_corrections (AI original preserved as
  a golden-set / audit trail), shown as a "corrected" badge + a Reviewer Corrections list. New
  CorrectionsModule (uiapi/corrections). Run sql/add-insight-corrections.sql on prod. APP_VERSION -> 1.54.0.
- Model registry: sql/add-model-options.sql now also seeds the previous hardcoded model lists
  (insights + transcription) so the registry is populated immediately, matching the on-boot seeder.
- Prompt-version stamping: each insight now records which prompt fragments (and the version of each)
  produced it. composeCallPrompt/composeChatPrompt return a {key: version} map that flows through
  extractInsights into a new prompt_versions_json column on interaction_insights; the drawer gains a
  Provenance section (model, provider, extractor, generated-at, per-fragment version chips). Existing
  rows stay null and backfill on re-run. Run sql/add-insight-prompt-versions.sql on prod. -> 1.55.0.
- Operations (QC) dashboard: rolling 12-month headline sparklines (Avg QC score, Avg QA score,
  Low-score alert rate, Volume) via a new getOperationsMonthlyTrends aggregation + summary/operations-
  trends endpoint. Own rolling window (independent of the day-level date filter) but honours the same
  campaign/agent/outcome filters; arrows coloured by direction. No migration. APP_VERSION -> 1.56.0.
- Agent Trajectory: new getAgentTrajectory aggregation + summary/agent-trajectory endpoint gives each
  agent's rolling 12-month avg QC-score trend (not just a leaderboard snapshot). Operations (QC)
  dashboard shows an Agent Trajectory tile — one sparkline per agent, latest score + first->latest
  delta, sortable by latest / most-improved / biggest-decline, click an agent to filter. Only agents
  scored in >=2 months are shown. No migration. APP_VERSION -> 1.57.0.
- Fix (1.57.1): summary/operations-trends + summary/agent-trajectory returned 400 (parseDateRange
  required from+to); both endpoints now parse `to` only. Agent Trajectory tile always renders with an
  explicit empty state instead of hiding silently.
- interaction_insights tidy-up (1.57.2): documented a column-governance rule in the entity header
  (json = source of truth; a dedicated column only when SQL filters/groups/aggregates/indexes it; else
  json + a display blob). Dropped two dead columns (key_entities_json, data_quality_json — written but
  never read; still in raw json). Run sql/drop-insight-dead-columns.sql on prod.
- Fix (1.57.2): System Health false positive — migration manifest listed table 'insight_summary' but
  the real table is 'insight_summaries' (plural), so drift always reported it missing. Corrected.

2026-07-24
- UI/UX polish pass (frontend-only, 1.60.x–1.67.x): adopted a Lucide icon system with tinted
  IconChip, a consistent KPI-tile style (soft card + accent stripe + embedded sparkline plate),
  unified/collapsible filter panels across the 4 dashboards, aurora header + login accents,
  chip-family taxonomy, and the "Summary" page reworked into a "Data Overview" DB/data snapshot.
  Settings gear now groups Prompts / AI Models / System Health; dashboards grouped under a
  "Dashboards" menu (CSAT relabeled "CSAT Assessment"). Agent Trajectory tile rebuilt as an aligned
  table (fixed columns + header row).
- System Health provider probes + schema-drift manifest: on-demand live LLM provider connectivity
  checks (valid key / invalid / out-of-tokens) and a MIGRATION_MANIFEST that flags any expected
  table/column/index missing on the server (names the SQL file to run). NOTE: add a manifest row in
  health.service.ts whenever a migration adds schema the app reads, or the drift guard is blind to it.
- CSAT drawer + review workflow:
  * Side-by-side transcript view on a CSAT record ("View transcript/comments" splits 50/50), plus
    reviewer comments (user + date + text). Migration: backend/sql/add-csat-reviewer-comments.sql.
  * Supervisor review — a deselectable Accept/Disagree toggle per assessed record. Outcome derived
    server-side: accepting a CONTEST or disagreeing with a DO NOT CONTEST both mean "raise with
    client" (the key metric, exported and passed back). New "Raise with client" / "Do not raise" KPI
    tiles with sparklines; all four decision/review tiles click through to a record modal with CSV
    export; grid + drill show a "Raise with client" Yes/No column. POST /uiapi/csat/item/:id/review
    {action: accept|disagree|clear}. Migration: backend/sql/add-csat-review-outcome.sql.
- Survey feed answers moved OUT of interaction_insights.campaign_answers_json into their own table
  app.interaction_survey (recordingId link, surveyType, answersJson), populated at load time. This
  RETIRES the survey backfill entirely (the LLM never touches the new table). Parity still uses
  campaign_answers_json (untouched); LLM transcript insights stay in campaign_transcript_json. New
  Data Overview "Survey Output" tile. Migrations (run in order): add-interaction-survey.sql (DDL),
  migrate-survey-answers-to-interaction-survey.sql (one-time, run BEFORE the next LLM batch),
  nmgb_survey_load.sql (ongoing load, replaces the deleted nmgb_survey_backfill.sql).
- Labelling: "Models" → "AI Models" (settings + page title "AI Model Registry" + "Check for new AI
  Models") to distinguish from vehicle models.
- Deploy checklist for this batch — run these idempotent scripts on ai_insight, then check System
  Health (Schema/migrations should go green): add-csat-reviewer-comments.sql, add-csat-review-outcome.sql,
  add-interaction-survey.sql, migrate-survey-answers-to-interaction-survey.sql, nmgb_survey_load.sql.
  APP_VERSION → 1.71.1.

2026-07-27
- Admin password reset for another user. Backend: PATCH /uiapi/users/:id/password, gated dev/admin
  only (RESET_ROLES in user.controller.ts — deliberately narrower than canSeeAdminTools, which also
  admits supervisors). Rehashes with bcrypt cost 10 and clears refresh_token_hash / session_expires_at
  so the target's old password and live session both die; modified_by_id records who did it.
- New "Reset User Password" tile in User Set Up (ResetUserPasswordAdmin.vue) — user picker from
  GET /uiapi/users, new + confirm fields, confirmation prompt before it fires.
- backend/sql/reset-user-password.sql for doing it by hand on dev/prod: generate the hash with
  node -e "require('bcrypt').hash(process.argv[1],10).then(console.log)" 'NewPassword' from /backend,
  paste it plus the email into the DECLAREs. No DDL — nothing to migrate. APP_VERSION → 1.72.0.
- Known gap, not addressed: POST /uiapi/users/create and PATCH /uiapi/users/:id/deactivate still have
  no server-side role check; only the UI hides them.

2026-07-28
- CSAT: closed the loop after a supervisor marks a record "raise with client". reviewOutcome still
  means it SHOULD go to the client; new raisedAt/raisedBy mean it HAS gone. Set in bulk when
  exporting the "Raise with client" drill-down (checkbox in the export header, ticked by default) or
  per record from its own toolbar. Row checkboxes + a bulk action bar drive both.
- CSAT client response: clientOutcome 'accepted' (contest upheld, no longer a fail) or 'rejected'
  (stands as a fail), with clientRespondedAt / clientResponseBy / clientResponseComment. The comment
  is REQUIRED in the UI so the client's reasoning is always on record. Works over a multi-select;
  recording a response back-fills raisedAt for anything sent outside the app.
- CSAT date filter — the page is a weekly task, so board + list + drill-down exports are all scoped
  to one range (presets + From/To, defaults to last 7 days). Records are dated by
  COALESCE(respondedAt, createdAt), the same expression the monthly trend already grouped by, so a
  record can't drift between the tiles and the table.
- CSAT tiles: 15 down to 8 cards, every value clickable (12 drill-downs, was 9). Grouped counts share
  a card as clickable cells, the outer cells painting the card's edge stripe so opposing pairs read
  green-left / red-right. Titled by stage: AI Assessment, Internal Assessment, Client Requests,
  Client Decision. status=pending_any is a pseudo-filter for the Pending tile (a single status can't
  express pending + awaiting_transcript + assessing).
- Deploy: run add-csat-client-response.sql on ai_insight (idempotent, no data migration) — registered
  in the schema-drift manifest, so System Health flags it until applied. APP_VERSION → 1.73.0.

2026-07-30
- Data Import (phases 0-1): a UI-driven importer for third-party interaction feeds, replacing the
  hand-run "SSMS wizard into temp.* then INSERT...SELECT" process. File -> staging -> eyeball ->
  (phase 2) promote. New admin page under the gear menu, dev/admin only.
- Mapping-driven, LivePerson first. Everything provider-specific lives in one file
  (backend/src/data-import/mappings/source-mappings.ts): column mapping, date order, natural-key
  candidates, CSAT columns, survey Q&A pairs, PII drop list. A second provider is a new mapping, not
  a schema change — staging columns are named after their app.* promote targets, not the feed's
  headers, so promote is a 1:1 INSERT...SELECT.
- Three load-bearing constants, each guarding a silent failure: status='transcribed' (anything else
  and startBatchInsightsChats never picks the rows up), campaign must match /rac/i (or the chat
  insights prompt skips the RAC QA + objection-handling sections — W_VALUE_campaign warns on a miss),
  and provider='openai' with interactionSource='liveperson' (provider is the LLM provider and
  normalizeProvider only accepts openai|anthropic|grok|gemini).
- Transcripts are normalised into the JSON message array the app already reads
  ([{id,source,sender,timestamp,content}] — parseChatTranscript + InteractionDetailDrawer), not the
  plain "HH:MM-agent:" line format, which does its arithmetic in seconds-from-midnight and so
  computes NEGATIVE response times for any overnight chat. A day-offset walk anchors each message on
  the conversation start date; timestamps are naive-local so bubbles show the agent's wall-clock.
  Unrecognised speakers are staged and visible but excluded from the promoted transcript rather than
  mis-attributed into the response-time metrics.
- Intake: browser upload (streams to disk via IMPORT_UPLOAD_DIR — never memory) and a server inbox
  (IMPORT_INBOX_DIR), which is the intended path for the real monthly export. Both converge on one
  parse path. Delimiter and encoding are SNIFFED, not assumed: the LivePerson export is named .csv
  but is tab-separated, and an Excel re-save can make it UTF-16LE. Consumer PII (contact details,
  customerInfo-*, IP) is dropped before rawJson is built, so it never reaches the database.
- POST /uiapi/data-import/runs/preview parses the first 200 rows and reports delimiter, encoding,
  resolved key column, column mapping and issue counts while writing NOTHING — usable against a
  sample before any table exists.
- Upload storage: multer's destination is resolved PER REQUEST (helpers/upload-storage.ts,
  lazyImportDiskStorage) and passed to FileInterceptor at the call site, NOT via
  MulterModule.register in the module. Module decorators evaluate as soon as the file is imported,
  which happens BEFORE ConfigModule.forRoot() loads .env into process.env — so reading
  IMPORT_UPLOAD_DIR there always saw it unset and silently fell back to in-memory buffering, which is
  the one thing this must never do. Env vars read lazily at request time (IMPORT_INBOX_DIR) were
  unaffected. multer is now a declared dependency rather than a transitive one, since diskStorage is
  imported directly.
- Deploy: run backend/sql/add-data-import.sql on ai_insight (idempotent; 3 tables, 9 indexes) —
  registered in the schema-drift manifest, so System Health flags it until applied. New dependencies
  csv-parse, multer (declared). Optional env: IMPORT_INBOX_DIR, IMPORT_UPLOAD_DIR,
  IMPORT_MAX_UPLOAD_BYTES, IMPORT_STAGE_CHUNK_ROWS, IMPORT_PROMOTE_BATCH_ROWS. Both directories must
  live OUTSIDE the repo — a real export contains customer PII. Also fixed "csat" missing from VALID_TABS in
  App.vue (?tab=csat silently fell back). APP_VERSION → 1.75.0.
- Access: dev/admin ONLY, deliberately narrower than the canSeeAdminTools gating every other admin
  surface uses — the importer loads raw customer conversations into the live interaction tables, so
  supervisors are excluded. New useAccess.canImportData gates the menu item AND the render (a
  ?tab=dataimport deep link would otherwise reach a page that 403s on every call). Keep it in step
  with READ_ROLES/WRITE_ROLES in data-import.controller.ts.
- Mapping finalised against a REAL 9,742-row export (Conversation-info, 13-29 Jul 2026, 53 MB).
  Everything the mapping expected was present and nothing needed changing except campaign:
  * COMMA separated with a UTF-8 BOM — not tab, which the header we were first shown implied. The
    sniffer got it right without being told, which is the whole reason it sniffs.
  * 329 columns, conversationId is column 1, max id length 36 (GUIDs) — comfortably inside
    interactionId varchar(50), so no migration needed there.
  * All 200 previewed transcripts parsed, 0 malformed records across all 9,742 rows, 0 blank start
    times, 0 rows needing any of the E_* error codes.
  * csatRate range is exactly 1-5 on 883 scored rows, confirming scoreMax=5. With
    CSAT_ASSESS_MAX_SCORE=3 that means ~408 contest-assessed (scores 1-3) and ~475 excluded (4-5).
  * 152 rows are flagged isPartial by the source, so expect ~152 W_PARTIAL_CONVERSATION warnings.
  * 40% of rows sit on skill SITE-RAC-web-sales-bot-en. Under the RAC handover rule those produce no
    measurable human response pairs — correct behaviour, not a fault.
- Campaign auto-prefixing: 28 of 30 distinct campaignName values already contain "RAC"; two did not —
  "prmsg tWQVPTpxg" (904 rows) and "NA" (350 rows), 1,254 rows / 12.9%. Since everything on this
  LivePerson account is RAC business, a value failing mustMatch is now PREFIXED ("RAC - prmsg
  tWQVPTpxg", "RAC - NA") rather than merely warned about, so those rows keep their RAC QA scoring.
  A prefix rather than an alias list because the "prmsg" suffix is a generated id that will differ
  next month. The prefix survives truncation — the value is shortened around it, never the reverse.
  No per-row warning is raised for a repaired value: flagging 13% of a real export for a configured,
  expected transformation would just train people to ignore the status. Real-file preview went from
  167 valid / 33 warning to 197 valid / 3 warning, the 3 being genuine isPartial rows.
  WIDTH WARNING: the longest real campaign, "Web - RAC Sales - NonCashback Affiliates (Desktop)", is
  EXACTLY 50 characters — zero headroom. A slightly longer value in a future export gets truncated
  (with a warning) and would fragment dashboard grouping; widening interactions.campaign is a
  migration on an indexed column.
- Phase 2 DONE: promote + rollback, built together so there is never a state where data can be
  promoted but not undone. Promote is set-based and chunked (one transaction per chunk — a 200k-row
  transaction would blow the log), idempotent at three layers, and writes app.interactions ->
  interaction_transcripts -> interaction_csat -> interaction_survey in that order.
  Rollback deletes interaction_survey and import-created CSAT explicitly (neither has an FK to
  interactions), UNLINKS pre-existing CSAT back to 'unmatched' rather than destroying feed data,
  then deletes the interactions so transcripts and insights go by cascade, and returns the run to
  'staged' so it can be corrected and promoted again.
- Verified against the live database, promote -> rollback -> promote -> rollback: 15 promotable of 21
  staged, 15 interactions / 15 transcripts / 1 CSAT / 1 survey created each time, and the 75
  pre-existing liveperson rows (from the old manual import) untouched throughout. Contract checks all
  pass: status='transcribed', interactionType='chat', provider='openai',
  interactionSource='liveperson', effectiveDate populated by the computed column,
  daysToMaturityAtInteraction NULL, hasCsat set only where a CSAT exists, transcript model
  'liveperson-import' holding a JSON array with id+sender, midnight chat rolled to the next day in
  the live transcript, CSAT status 'pending' at score 2, _importRunId stamped for rollback, and
  surveyType 'liveperson_post_chat'. Re-promote is refused; re-importing the same file returns 15
  'existing' + 1 duplicate + 5 error and 0 promotable.
- Two more bugs found by running it rather than reading it:
  * interaction_csat.comment was the RAW multi-value survey cell ("Waited far too long for
    recovery;No") — every answer glued together, which would then be read as the customer's verbatim
    by the contest assessment. Now split on the multi-value delimiter, taking the first non-empty
    answer; the full Q&A set was already preserved in interaction_survey.answersJson.
  * Rollback reported 0 rows deleted after successfully deleting everything. TypeORM's query()
    exposes only the first recordset, and for `DELETE <alias> FROM ...; SELECT @@ROWCOUNT` that is
    not the SELECT (INSERT ... SELECT happens to behave differently, which is why promote's counts
    were right). Counts are now taken with a SELECT before the deletes, inside the same transaction
    and using the same predicates. The same latent problem in promote's `skipped` count was fixed
    too — it read 0 and happened to be correct.
- Schema-drift manifest: add-data-import.sql is registered and was confirmed working — it reported
  "3 table/columns and 9 indexes missing. Run: add-data-import.sql" before the migration was applied,
  and the check is green afterwards. MigrationDef gained an `optional` flag for opt-in migrations:
  missing items are still LISTED so dev/prod divergence stays visible, but they do not affect the
  status, because leaving System Health permanently amber over a deliberate choice just trains people
  to ignore it. The status detail now says "All N required ... present. 1 optional item not applied"
  rather than claiming everything is present while listing something missing.
  Also registered add-csat-reviewer-comments.sql (interaction_csat.reviewerCommentsJson), which was
  missing from the manifest — the CSAT page reads that column, so its absence would have been a
  runtime failure the drift guard could not see. It is present on this database, so no new alarm.
  Registered create-indexes.sql too — its 21 indexes (IX_interactions_effectiveDate_type,
  IX_interactions_type_campaign, IX_insights_*, IX_transcripts_recordingId, IX_summaries_* ...) were
  all absent from the manifest, so an environment that never ran that script reported green while
  every dashboard query table-scanned interactions and interaction_insights. All 21 were verified
  present on dev before registering, so it raises no pre-existing warning; the drift check now covers
  116 required items, up from 95.
- New opt-in migration backend/sql/add-interactions-source-key-unique.sql: a filtered UNIQUE index on
  (interactionSource, interactionId), which turns the NOT EXISTS check-then-act race into a catchable
  2601/2627. It THROWS with a count if duplicates exist rather than failing obscurely. Not part of
  add-data-import.sql because historic maxcontact loads ran with no de-dupe guard, so pre-existing
  data may legitimately violate it. GET /uiapi/data-import/dedupe-report currently returns 0 groups
  on this database, so it would apply cleanly.
- Rollback is dev-only (DANGER_ROLES) and needs "ROLLBACK <first 8 of the run id>" typed back, since
  it destroys promoted interactions and cascades away any insights generated from them — real LLM
  spend, which the confirm modal states explicitly before you commit.
- End-to-end through the existing pipeline, verified on live data: the chat-insights batch selected
  the imported rows (proving the status='transcribed' + interactionType='chat' contract), completed
  with 0 errors, moved them to insights_done, and populated qa_scores_json with the RAC QA block
  (proving the /rac/i campaign contract). Response-time metrics needed a second look: on transcripts
  with no "you are now connected to" marker every gap is null and every agent line reads as auto —
  that is CORRECT, because chat-response-time.ts sets pastHandover = !rac, so RAC chats only count
  agent replies after the handover. On a transcript that has the marker the metrics are exactly right:
  three pre-handover lines treated as bot, then one human pair, customer 09:15:20 -> agent 09:15:40,
  gap 20s, measured=1, avg=20. Speaker classification and the handover marker both survive promote.

- CSAT page transcript viewer: was a raw <pre> dump, so an imported chat rendered as a wall of JSON.
  It now uses the same bubble rendering as the interaction drawer.
- Transcript parsing extracted to composables/useChatTranscript.ts and rendering to
  components/ChatTranscript.vue, used by BOTH the drawer and the CSAT page — previously the drawer
  held the only parser and the CSAT pane had none at all, which is exactly how they drifted. The
  drawer keeps its own Chat/Raw toggle in the section title (show-toggle="false"), so its layout is
  unchanged; its duplicate parse code and now-unused fmtTime are gone.
  Side benefit: the CSAT page now renders the OLD manually-imported liveperson chats
  ("HH:MM:SS-consumer: ...") as bubbles too, which it never did.
  Also fixed a latent gap the extraction exposed — a DOUBLE-ENCODED transcript (a JSON string
  wrapping a JSON array) fell back to raw text in the UI even though the backend unwraps it and reads
  it fine, so the metrics and the display disagreed. Now unwrapped once and retried as both shapes.
  Verified against real database rows: live imported JSON transcripts, an old line-format transcript,
  a real diarized "Speaker N:" call transcript (24 turns, call view unchanged), plus prose/null/empty
  fallbacks. NOTE: the frontend has no test runner, so this is covered by that verification rather
  than by unit tests. APP_VERSION -> 1.77.0.

- SECURITY: JWT_SECRET was configured but completely ignored, app-wide. All five modules did
  `JwtModule.register({ secret: process.env.JWT_SECRET || 'dev-secret-change-me' })`, and a module
  decorator evaluates as soon as its file is imported — BEFORE ConfigModule.forRoot() loads .env into
  process.env. So the expression always took the fallback branch and every token was signed and
  verified with the literal 'dev-secret-change-me', a value committed to this repository. Anyone who
  could read the repo could forge a valid admin token. Verified before the fix: a token signed with
  the committed fallback was accepted (200) while one signed with the real .env secret was rejected
  (401); after the fix, exactly inverted.
- Fixed with one shared modules/auth/jwt-shared.module.ts using JwtModule.registerAsync, so the
  secret is resolved by a FACTORY at module-init time (after .env is loaded) and lives in exactly one
  place instead of five copies of the same broken expression. AuthModule's signOptions.expiresIn was
  dropped as dead configuration — every sign() call in AuthService already passes ACCESS_TTL /
  REFRESH_TTL explicitly.
- modules/auth/jwt.config.ts now REFUSES TO START when NODE_ENV=production and JWT_SECRET is unset,
  is the dev placeholder, or is under 16 chars. An app that will not boot is safer than one issuing
  forgeable admin tokens. JWT_SECRET + NODE_ENV added to env.validation.ts; note an EMPTY
  JWT_SECRET now fails Joi validation and blocks boot in every environment, which is deliberate.
- Staging smoke-tested against real tables (21-row fixture): 21 staged, 75 messages, 10 valid /
  5 warning / 5 error / 1 duplicate, all four set-based validation passes firing, midnight rollover
  producing 2025-02-19T23:59:30 -> 2025-02-20T00:01:15, PII accounting reconciling exactly
  (55 dropped + 243 empty + 31 populated = 329), and discard cascading 21 conversations + 75 messages
  to zero. Three bugs found and fixed in the process:
  * Insert chunk size was a hardcoded guess of 46 columns; import_conversations has 52, so 43-row
    chunks would have emitted ~2150 parameters and blown MSSQL's 2100 cap on the very first insert.
    Now derived from live entity metadata, so adding a column cannot reintroduce it.
  * Row detail reported ~298 "columns dropped by the PII policy" because it inferred drops from
    absence in rawJson — which also omits empty cells. It now computes drops from the policy itself
    and reports empty columns separately.
  * Re-keying was a ONE-WAY DOOR: it appended E_NO_KEY to validationJson by string concatenation, so
    pointing at a blank column errored every row and pointing back left the injected error behind
    permanently — not even revalidate could recover the run. Re-key now re-projects each row through
    stageRow() (issues recomputed, never accumulated) and round-trips exactly; a regression test
    pins that invariant.
- IMPACT ON DEPLOY: the signing secret genuinely changes, so every existing session is invalidated —
  all users are logged out once and must sign in again. Nothing else to run. BEFORE DEPLOYING TO
  PROD, confirm JWT_SECRET is actually set there (web.config <env>), or the app will refuse to start
  by design. APP_VERSION → 1.76.0 so the login screen confirms the deploy landed.
