# Future Suggestions / Backlog

QA-era ideas raised but not yet built. Captured here so they aren't lost.

---

## 1. Golden-set regression harness (PARKED — agreed to revisit)

**Why:** the prompt fragments in `seed-fragments.ts` change frequently, and
`seedIfMissing` only inserts. A prompt tweak can silently regress extraction
(wrong `is_opportunity`, wrong Parity answers, etc.) with no signal until a
stakeholder spots a bad number. This locks extraction quality.

**Shape:**
- A small fixture set: ~30–50 representative transcripts (calls + chats + a few
  Parity), each paired with an **expected answer key** for the fields that
  matter: `is_opportunity`, `lead_generated_for_dealer`, `competitor_purchased`,
  the 12 Parity campaign answers, interest level, etc.
- A runner that executes the **current** prompt/extraction over each fixture and
  **diffs** actual vs expected → per-field accuracy + overall pass/fail.
- Runnable on demand (npm script) and in CI, so a regressing prompt change fails
  loudly before deploy.

**Build vs. provide:**
- Build (me): harness, fixture format + loader, diff/scoring, 3–5 example
  fixtures, a "propose labels from current output for you to correct" helper to
  make labelling fast.
- Provide (you): the labelled answer key for the real set.

**Open decision:** fixture transcript source —
- *Hand-authored synthetic* (no PII, safe to commit), or
- *Real anonymised* interactions pulled from the DB (more representative, need
  scrubbing first).

---

## 2. Other ideas raised (not yet started)

- **Semantic search over transcripts** (embeddings) — "find calls where the
  customer mentioned moving abroad." Current `searchInteractions` is id/TPS only.
  Strong QA spot-check tool and a real client feature.
- **PII redaction before LLM send** — full transcripts (names, finance details)
  are sent to US providers and stored. Decide redaction / data-flow posture
  deliberately (FCA / Consumer Duty context).
- **Deep-linkable dashboard state** — filters + open drill-downs in the URL
  query, so a QA tester can paste the exact view they're looking at. Also enables
  saved views.
- **Export current view to CSV/XLSX** — stakeholders will ask for it.
- **Trend-over-time** for headline rates (negative-view rate, opportunity rate)
  rather than only period-vs-period.
- **Migration-drift guard at startup** — `synchronize: false` + hand-run SQL
  means a forgotten migration breaks queries (nearly happened with `add-dealer`).
  Assert expected columns/indexes exist on boot; log loudly if missing.
- **QA correction loop** — let a reviewer override an insight field in the
  drawer and persist the correction → instant golden-set fodder + a
  mistranscription feedback channel for the Deepgram keyword-boost list.
- **Full json_schema structured output for Anthropic** — hard schema enforcement
  on the (large, campaign-variable) insights payload. Deferred; retry + streaming
  + JSON-salvage already removed the invalid-JSON failure mode.
