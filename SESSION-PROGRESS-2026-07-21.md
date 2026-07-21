# Session progress & test plan — 2026-07-21 (app v1.45.0)

Everything shipped this session, with **where it is** and **how to test it**.
All local/unpushed. Backend + frontend both build clean.

---

## 0. DO THIS FIRST — deploy prerequisites

Several features stay empty until these are done. **System Health (new tab) will
tell you exactly which SQL migrations are missing.**

1. **Run SQL migrations** (needs a DDL-capable login; `ai_app_login` can't ALTER):
   - `backend/sql/add-nmgb-survey-transcript.sql`  → `campaign_transcript_json` + reseed `call.base`
   - `backend/sql/add-transcription-confidence.sql` → `confidence`, `lowConfidenceJson`
   - `backend/sql/add-transcript-embeddings.sql`    → `embedding`, `embeddingModel`
   ```
   sqlcmd -S <host>,1433 -U <ddl_login> -P <pw> -d ai_insight -C -I -i backend\sql\<file>.sql
   ```
2. **Restart the backend** → reseeds `call.base` + the NMGB prompt fragments.
3. **Fix the maxcall download (NAT hairpin):** add to `C:\Windows\System32\drivers\etc\hosts`:
   ```
   127.0.0.1    maxcall.icxsolutions.co.uk
   ```
   then `ipconfig /flushdns`. Verify: `curl.exe -sS -o NUL -w "%{http_code}`n" "https://maxcall.icxsolutions.co.uk/api/main/downLoad/669965/1962000"` returns fast (200), not a 21s timeout.
4. **Re-run the pipeline** (Batch dashboard): Requeue all errors → Transcribe → (batch) Insights → Embed transcripts.
5. **After any survey insights run:** re-run `sql/nmgb_survey_backfill.sql` (the LLM nulls `campaign_answers_json`; the backfill restores it).
6. Deploy `backend/dist` and `frontend/dist`.

---

## 1. Survey drawer consolidation
**What:** the Survey dashboard now uses the SAME detail drawer as Operations / Campaign Insights (no more bespoke survey drawer). All survey sections preserved + Ask AI + call transcript as a conversation.
**Where:** Survey Analytics → click any stat tile → drill list → click a record.
**Test:**
- Drawer opens with: Vehicle & Status, Purchase Status, Initial Interest, Dealership Experience, All Survey Answers, Not-Purchase Reasons, Purchased Instead, Improvements, Agent Notes, Transcript Insights.
- **Ask AI** button works (top of drawer).
- Call transcript renders as **speaker bubbles** (falls back to raw text if not diarized).
- Parity "Campaign Q&A" panels are hidden for survey records (correct).

## 2. System Health  (NEW admin tab)
**What:** live health checks + migration-drift guard.
**Where:** top nav → **System Health** (admin/supervisor/dev only).
**Test:**
- Cards: Database, Schema/migrations, Prompt fragments, LLM provider keys, Transcription config.
- **Schema card names any missing migration file** (red) — should be green once section 0 is done.
- Click **Run connectivity tests** → Deepgram reachable (OK) + Recording host reachable. Before the hosts fix, the recording host card should be RED with the timeout + NAT-hairpin hint.

## 3. Transcription confidence
**What:** Deepgram per-call confidence + the words it was least sure about.
**Where:** any CALL drawer → Transcript section.
**Prereq:** re-transcribe after the confidence migration (older transcripts are null).
**Test:**
- Confidence chip in the transcript header (green/amber/red %).
- "Low-confidence terms" panel + **"What's this?"** explainer (explains why common words like "the"/"was" appear — audio clarity, not accuracy).

## 4. Failed records — dead-letter + requeue / reprocess
**Where:** Batch Dashboard → **Failed Records & Reprocessing** tile.
**Test:**
- Lists `error` records with their **real cause** (e.g. `connect ETIMEDOUT maxcall...:443`), not "fetch failed".
- **Requeue all errors** → resets them (re-transcribe if no transcript, else re-run insights). Per-row **Requeue** too.
- **Reprocess insights** (optional campaign, confirmed) → deletes insight rows + re-queues as `transcribed`.
- **Export CSV**.

## 5. Transcription vocabulary suggestions (keyterm loop)
**Where:** Batch Dashboard → **Transcription Vocabulary Suggestions** (expand).
**Test:** Window dropdown (30 / 90 / 180 / 365 / **730 = 2yr**) → **Analyse transcripts** → ranked table of frequently-shaky terms (calls / occurrences / min & avg confidence). "What's this?" explainer present.

## 6. Review: lowest-confidence transcripts
**Where:** Batch Dashboard → **Review: Lowest-Confidence Transcripts** (expand).
**Test:** **Load** → ranked worst-first table (confidence %, shaky-term count, campaign, date, snippet) → **click a row opens the drawer**. If empty, it explains *why* (Deepgram-only, needs re-transcription).

## 7. Transcription successes column
**Where:** Batch Dashboard → Insights usage & cost panel → **Transcription** table.
**Test:** columns now read **Attempts** + **Succeeded** ("N (X failed)" in red when they differ), so failed attempts don't look like paid transcriptions. Widen the date range if empty (it filters on interaction date).

## 8. CSV export
**Where:** (a) Survey Analytics → any drill modal header → **Export CSV**; (b) Batch → Failed Records tile → **Export CSV**. Opens cleanly in Excel (UTF-8/BOM).

## 9. Detail drawer — visual hierarchy
**What:** easier to scan busy drawers. **Test:** section headers now have a coloured accent bar + underline (level-1); subsection headers have a nested left-tick; thicker band between sections. No data removed.

## 10. Drill-down evidence quotes
**Where:** Survey Analytics → drill a **transcript** tile (frustration theme, competitor reason, sentiment, etc.).
**Test:** each drill row shows the quote that **matches that tile** (italic), not the same generic purchase_reason on every row. Also included in the drill CSV.

## 11. Trend sparklines — Survey
**Where:** Survey Analytics → overview strip.
**Test:** two mini trend charts — **Defection rate** and **Chinese-OEM defection rate** — with latest value + up/down arrow.

## 12. Trend sparklines — Campaign Insights
**Where:** Campaign Insights → **Negative View Rate** and **Opportunity Rate** cards.
**Test:** each card shows a monthly sparkline (hover → "X% → Y% over N months"). Honours all filters. Negative-view needs the Parity campaign selected.

## 13. Deep-linkable views
**What:** active tab + Survey filters live in the URL.
**Test:** on Survey Analytics, set filters + Load → the URL gains `?tab=survey&campaign=...&from=...`. Copy the URL, open in a new tab → same view restores.

## 14. Semantic search over transcripts  (NEW capability)
**Where:** **Find record** (top bar) → toggle **Meaning**.
**Prereq:** embeddings must exist → Batch Dashboard → **Semantic Search — Embed Transcripts** → "Embed next N" (repeat until remaining = 0).
**Test:**
- Type a phrase, e.g. *"customer mentioned moving abroad"* → ranked results with **% match** + snippet; click → drawer.
- **Filters** (Meaning mode): campaign dropdown, All/Call/Chat, from/to dates → scope the search.
- Finds meaning, not exact words (e.g. "relocating overseas" matches "moving abroad").

## 15. Better transcription error messages
**What:** Node's bare "fetch failed" now records the real cause (DNS/TCP/TLS/timeout) with the host — visible in Failed Records `lastError`.

## 16. Vulnerable Customers (Consumer Duty)  (NEW)
**What:** a rollup of the QA **Q13 vulnerability** signal — where a vulnerable customer was identified, and whether they were **handled appropriately**.
**Where:** **Operations (QC)** dashboard → new **Vulnerable Customers (Consumer Duty)** tile (below Objection Handling / Sales Opportunity).
**Prereq:** only appears for interactions that have **QA scores** (QC-scored calls); honours all Operations filters (campaign / agent / date / make / model / outcomes).
**Test:**
- Three counts: **Identified vulnerable**, **Handled ✓** (green), **NOT handled ✗** (red), out of the QA-scored total in range.
- **Review not-handled (N)** → lists those interactions (the compliance priority — vulnerable but not handled well), each with the Q13 **rationale**; click a row → opens the drawer.
- **View handled (N)** → the handled ones.
- Empty state explains it when no vulnerable customers were identified.
- Note: Q13 semantics — `no` = vulnerable **and not** handled (the risk), `yes` = vulnerable **and** handled, missing/n-a = no vulnerability present.

---

## Notes / known follow-ups
- Semantic search scores the most recent ~3,000 embedded transcripts per query (perf guard).
- Trend sparklines/embeddings/confidence all depend on data existing — empty until section 0 is done + a batch run.
- Roadmap still open: golden-set harness, alerting/auto-ingest, PII redaction / Consumer-Duty rollup, Operations trend charts, agent trajectory.
- 12 commits are **local/unpushed** — push when you're happy.
