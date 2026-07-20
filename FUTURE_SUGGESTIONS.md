# Future Suggestions / Roadmap

Living backlog for OmniSense. Grounded in the app as it stands: an interaction-
intelligence pipeline (ingest → transcribe → LLM-extract → dashboards/narratives)
across calls, chats and surveys, multiple campaigns (Parity, NMGB Survey) and
LLM providers. Strong on extraction + dashboards; the thin spots are operational
robustness, the quality/feedback loop, retrieval, proactive delivery, and
compliance — which is where these strands aim.

Status key: **[in progress]** · **[next]** · **[planned]** · **[parked]**

---

## Strand 1 — Reliability & operations  **[in progress]**
The class of pain we hit live (Deepgram "fetch failed" that was really the
recording host unreachable; a missing column that would silently break every
drawer). Highest leverage for least code.

- **System Health page** **[in progress]** — one admin screen that live-checks:
  DB connectivity, each provider API key present, Deepgram reachability, the
  recording host (maxcall) reachability, prompt fragments seeded, and expected
  DB columns/tables present. Cheap checks always-on; outbound connectivity tests
  on demand. Today's "fetch failed" would have been a red tick, not an hour of
  digging.
- **Migration-drift guard on boot** **[in progress]** — assert expected
  columns/indexes/tables exist at startup and log loudly if missing (surfaced in
  the Health page too). `campaign_transcript_json` missing would have broken
  every `getInteractionDetail`. `synchronize:false` + hand-run SQL makes this a
  real risk (nearly bit us on add-dealer).
- **Rerun errors / reprocess transcriptions buttons** **[next]** — the TODO at
  the top of README.txt. Batch dashboard: retry all `error`-status records; reset
  a set to `transcribed` + delete their insight rows to reprocess. Now that
  `lastError` carries the real cause (describeError), a dead-letter list of
  persistent failures + their reason is very usable.

## Strand 2 — Quality & the feedback loop (QA data-trust toolkit)
- **Golden-set regression harness** **[planned]** — ~30–50 representative
  transcripts (calls + chats + Parity) paired with an expected answer key for the
  fields that matter (is_opportunity, lead_generated_for_dealer,
  competitor_purchased, the Parity answers, interest level). A runner diffs
  current extraction vs expected → per-field accuracy + pass/fail, on demand and
  in CI, so a regressing prompt change fails loudly before deploy. Build (me):
  harness, fixture format+loader, diff/scoring, a "propose labels from current
  output for you to correct" helper. Provide (you): the labelled key. Open
  decision: hand-authored synthetic (no PII) vs real anonymised (needs scrubbing).
- **In-drawer QA correction loop** **[planned]** — reviewer overrides an insight
  field in the drawer; persist it → golden-set fodder + a mistranscription
  feedback channel into the Deepgram keyword-boost list. Every QC review becomes
  training data.
- **Transcription confidence** **[planned]** — Deepgram returns per-word
  confidence; surface low-confidence calls for spot-check, auto-suggest additions
  to VEHICLE_REPLACEMENTS / keyterms.

## Strand 3 — Retrieval & discovery
- **Semantic search over transcripts** **[planned]** — embeddings so QA/clients
  can ask "find calls where the customer mentioned moving abroad." Current search
  is id/TPS only. Also unlocks "similar interactions" and unsupervised theme
  discovery (clusters beyond the fixed prompt questions). Biggest single new
  capability.

## Strand 4 — Analytics depth (mostly quick wins)
- **Trend-over-time** **[planned]** — sparklines for headline rates
  (negative-view, opportunity, defection); we only do period-vs-period now.
- **Deep-linkable / saved views** **[planned]** — filters + open drill-downs in
  the URL query so a tester can paste the exact view; enables saved views.
- **Export current view to CSV/XLSX** **[planned]** — stakeholders will ask.
- **Drill-down evidence quotes** **[next]** — drill rows show the generic
  `purchase_reason`/`agent_notes`, not the dimension-specific quote that matched
  the tile (frustration/competitor-reason/sentiment). Return + render the matching
  evidence.
- **Transcription successes column** **[next]** — the usage panel Count includes
  failed attempts (they log a row with null audioSeconds). Backend already returns
  `successes`/`measured`; the table just doesn't show them, so failures look like
  cost-bearing transcriptions.
- **Agent trajectory** **[planned]** — per-agent QC scores over time, not just a
  leaderboard snapshot.

## Strand 5 — Proactive & pipeline (pull → push)
- **Auto-ingest worker** **[planned]** — new interactions transcribed + scored
  automatically as they land, instead of manual batches.
- **Alerting** **[planned]** — every signal is already computed (SLA breach,
  high-risk call, negative-view spike, competitor-mention surge); nothing pushes
  it. Threshold alerts → email/Teams.
- **Dealer lead handoff** **[planned]** — consent-to-dealer + opportunity are
  captured; emit a lead feed / notification to dealers.

## Strand 6 — Compliance & governance (FCA / Consumer Duty context)
- **PII redaction before LLM send** **[planned]** — full transcripts (names,
  finance detail) go to US providers and are stored; decide redaction/data-flow
  posture deliberately.
- **Consumer Duty / vulnerability rollup** **[planned]** — a vulnerability QA
  question already exists; a dedicated vulnerable-customer dashboard is a genuine
  regulated-market feature.
- **Prompt-version stamping** **[planned]** — prompt_template_history exists;
  stamp which prompt version produced each insight, for reproducibility/audit.

## Strand 7 — AI/model
- **Full json_schema structured output for Anthropic** **[parked]** — hard schema
  enforcement on the large, campaign-variable insights payload. Retry + streaming
  + JSON-salvage already removed the invalid-JSON failure mode, so deferred.
- **Model routing / cost optimisation** **[planned]** — cheap model first,
  escalate on low confidence; caching; tie prompt A/B to the golden set. We track
  cost — the next step is to optimise it.
