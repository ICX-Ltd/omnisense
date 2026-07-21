# Future Suggestions / Roadmap — outstanding only

Backlog of work **not yet started** (or parked). Completed work is recorded in
the dated `SESSION-PROGRESS-*.md` docs, not here — this file is the to-do list.

Status key: **[next]** · **[planned]** · **[parked]**

---

## Quality & the feedback loop
- **Golden-set regression harness** **[next]** — prompt fragments change often and
  `seedIfMissing` only inserts, so a tweak can silently regress extraction
  (wrong `is_opportunity`, wrong Parity answers, etc.) with no signal. Lock it:
  - ~30–50 representative transcripts (calls + chats + Parity), each paired with
    an expected answer key for the fields that matter (is_opportunity,
    lead_generated_for_dealer, competitor_purchased, the Parity answers, interest
    level).
  - A runner that executes the current prompt/extraction over each fixture and
    diffs actual vs expected → per-field accuracy + pass/fail; runnable on demand
    and in CI so a regressing prompt fails loudly before deploy.
  - Build (me): harness, fixture format + loader, diff/scoring, a
    "propose labels from current output for you to correct" helper.
  - Provide (you): the labelled answer key.
  - **Open decision:** fixture source — hand-authored synthetic (no PII, safe to
    commit) vs real anonymised interactions pulled from the DB (more
    representative, need scrubbing first).
- **In-drawer QA correction loop** **[planned]** — let a reviewer override an
  insight field in the drawer and persist the correction → instant golden-set
  fodder + a mistranscription feedback channel for the Deepgram keyword list.

## Analytics depth
- **Agent trajectory over time** **[planned]** — per-agent QC scores as a trend,
  not just a leaderboard snapshot.
- **Operations trend sparklines** **[planned]** — extend the Survey / Campaign
  Insights sparklines to the Operations dashboard headline metrics.
- **Saved (named) views** **[planned]** — build on the deep-linkable URL state so
  a tester can save and re-open named filter sets, not just paste a link.

## Proactive & pipeline (pull → push)
- **Auto-ingest worker** **[planned]** — new interactions transcribed + scored
  automatically as they land, instead of manual batches.
- **Alerting** **[planned]** — every signal is already computed (SLA breach,
  high-risk call, negative-view spike, competitor-mention surge, vulnerable
  customer not handled); nothing pushes it. Threshold alerts → email/Teams.
  *Needs a channel decision (email vs Teams webhook).*
- **Dealer lead handoff** **[planned]** — consent-to-dealer + opportunity are
  captured; emit a lead feed / notification to dealers.

## Compliance & governance (FCA / Consumer Duty)
- **PII redaction before LLM send** **[planned]** — full transcripts (names,
  finance detail) go to US providers and are stored; decide redaction / data-flow
  posture deliberately.
- **Prompt-version stamping** **[planned]** — `prompt_template_history` exists;
  stamp which prompt version produced each insight, for reproducibility / audit.

## AI / model
- **Model registry (editable model lists)** **[planned]** — the insights/narrative
  model dropdowns are hardcoded in the frontend; the transcription model is an env
  var. Move both to a DB table (provider, kind: insights|transcription, model id,
  label, active, default) with an admin editor (like the transcription vocab), so
  new models can be added/enabled without a deploy. Dashboards + the Deepgram/
  provider services read from it. Pairs well with model routing below.
- **Model routing / cost optimisation** **[planned]** — cheap model first,
  escalate on low confidence; caching; tie prompt A/B to the golden set.
- **Full json_schema structured output for Anthropic** **[parked]** — hard schema
  enforcement on the large, campaign-variable insights payload. Retry + streaming
  + JSON-salvage already removed the invalid-JSON failure mode, so deferred.

## Smaller follow-ups
- **Semantic search scale** **[planned]** — currently scores the most recent
  ~3,000 embedded transcripts per query; revisit (ANN index / SQL Server vector
  type) if the corpus grows large.
