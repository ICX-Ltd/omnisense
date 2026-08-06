<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ApiPath } from "@/enums/api";
import InteractionDetailDrawer from "./InteractionDetailDrawer.vue";
import ChatTranscript from "./ChatTranscript.vue";
import Sparkline from "./Sparkline.vue";
import { getInteractionDetail } from "@/services/interaction-search.service";
import { useAuth } from "@/composables/useAuth";

const { user } = useAuth();

const loading = ref(false);
const error = ref("");
const board = ref<any>(null);
const rows = ref<any[]>([]);

// Filters
const fStatus = ref("");
const fDecision = ref("");
const fCampaign = ref("");
const fRaised = ref("");
const fClientOutcome = ref("");
// Supervisor verdict — 'disagree' surfaces every override, whichever way the
// model called it.
const fReviewAction = ref("");

// ── Find by ID (client-side) ─────────────────────────────────────────────────
// Reviewers get handed an id from all sorts of places — the CSAT record's own
// GUID, the TPS survey id, the interaction reference or the recording id — so
// this matches a substring against any of them, over the rows already loaded.
const fId = ref("");

const ID_FIELDS = ["id", "interactionId", "interactionTpsId", "recordingId"] as const;

const visibleRows = computed(() => {
  const q = fId.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r: any) =>
    ID_FIELDS.some((f) => String(r[f] ?? "").toLowerCase().includes(q)),
  );
});

// ── Date range ───────────────────────────────────────────────────────────────
// Reviewing CSATs is a weekly job, so the whole page (tiles included) is scoped
// to a range. Defaults to the last 7 days — "All time" is one click away.
const fFrom = ref("");
const fTo = ref("");

function isoDay(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function shiftDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}
// Monday-start week containing `base`.
function startOfWeek(base: Date) {
  const d = new Date(base);
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  return shiftDays(d, -dow);
}

type RangePreset = "last7" | "last30" | "thisWeek" | "lastWeek" | "thisMonth" | "all";
const activePreset = ref<RangePreset | "custom">("last7");

function applyPreset(p: RangePreset) {
  activePreset.value = p;
  const today = new Date();
  switch (p) {
    case "last7":
      fFrom.value = isoDay(shiftDays(today, -6));
      fTo.value = isoDay(today);
      break;
    case "last30":
      fFrom.value = isoDay(shiftDays(today, -29));
      fTo.value = isoDay(today);
      break;
    case "thisWeek":
      fFrom.value = isoDay(startOfWeek(today));
      fTo.value = isoDay(today);
      break;
    case "lastWeek": {
      const lastMon = shiftDays(startOfWeek(today), -7);
      fFrom.value = isoDay(lastMon);
      fTo.value = isoDay(shiftDays(lastMon, 6));
      break;
    }
    case "thisMonth":
      fFrom.value = isoDay(new Date(today.getFullYear(), today.getMonth(), 1));
      fTo.value = isoDay(today);
      break;
    case "all":
      fFrom.value = "";
      fTo.value = "";
      break;
  }
  loadAll();
}

// Typing in the date inputs directly drops the preset highlight.
function onDateEdited() {
  activePreset.value = "custom";
  loadAll();
}

// Shared by board + list so the tiles and the table always agree.
function rangeParams(): Record<string, string> {
  const p: Record<string, string> = {};
  if (fFrom.value) p.from = fFrom.value;
  if (fTo.value) p.to = fTo.value;
  return p;
}

const rangeLabel = computed(() => {
  if (!fFrom.value && !fTo.value) return "all time";
  if (fFrom.value && fTo.value) return `${fFrom.value} → ${fTo.value}`;
  return fFrom.value ? `from ${fFrom.value}` : `up to ${fTo.value}`;
});

// Batch
const batchLimit = ref(25);

// ─── By Campaign collapse ───────────────────────────────────────────────────
// Collapsed by default so the records grid — the actual work — is near the top.
const CAMPAIGNS_KEY = "aii_csat_campaigns_open";
const campaignsOpen = ref(localStorage.getItem(CAMPAIGNS_KEY) === "1");
function toggleCampaigns() {
  campaignsOpen.value = !campaignsOpen.value;
  localStorage.setItem(CAMPAIGNS_KEY, campaignsOpen.value ? "1" : "0");
}

// ─── list size / focus ──────────────────────────────────────────────────────
// 200 is not always enough after a bulk import, and once a supervisor has
// actioned a record it is just noise in the queue.
const listLimit = ref(200);
const undecidedOnly = ref(false);

// ─── background assessment ──────────────────────────────────────────────────
// The synchronous endpoint is bounded by the proxy timeout (~25 records), which
// is unworkable for the hundreds a bulk import produces. This kicks off a
// background job and polls it, so a whole range can be assessed in one go.
const assessJobId = ref<string | null>(null);
const assessProgress = ref(0);
const assessTotal = ref(0);
const assessErrors = ref(0);
let assessPoll: ReturnType<typeof setInterval> | null = null;
const running = ref(false);
const runMsg = ref("");
const rematching = ref(false);

// Expanded row detail (full assessment)
const expandedId = ref<string | null>(null);
const detail = ref<any>(null);
const loadingDetail = ref(false);

// Interaction transcript drawer
const drawerRecordingId = ref<string | null>(null);

// Side-by-side transcript for the expanded CSAT record
const transcriptOpen = ref(false);
const transcriptText = ref("");
const transcriptLoading = ref(false);
const transcriptError = ref("");
// Drives which structured view ChatTranscript offers: chat bubbles vs diarized
// call turns. Captured from the interaction, not guessed from the text.
const transcriptIsChat = ref(false);

async function toggleTranscript() {
  if (transcriptOpen.value) {
    transcriptOpen.value = false;
    return;
  }
  const rid = detail.value?.recordingId;
  if (!rid) return;
  transcriptOpen.value = true;
  if (transcriptText.value) return; // already loaded for this record
  transcriptLoading.value = true;
  transcriptError.value = "";
  try {
    const d = await getInteractionDetail(rid);
    transcriptText.value = d?.transcript?.text || "";
    transcriptIsChat.value = d?.interaction?.interactionType === "chat";
    if (!transcriptText.value) transcriptError.value = "No transcript available for this interaction.";
  } catch {
    transcriptError.value = "Could not load transcript.";
  } finally {
    transcriptLoading.value = false;
  }
}

// ── Reviewer comments ────────────────────────────────────────────────────────
const comments = ref<Array<{ user: string | null; comment: string; at: string }>>([]);
const commentModalOpen = ref(false);
const commentDraft = ref("");
const commentSaving = ref(false);
const commentError = ref("");

function openCommentModal() {
  commentDraft.value = "";
  commentError.value = "";
  commentModalOpen.value = true;
}
function closeCommentModal() {
  commentModalOpen.value = false;
}

async function saveComment() {
  const text = commentDraft.value.trim();
  if (!text || !expandedId.value) return;
  commentSaving.value = true;
  commentError.value = "";
  try {
    const author = user.value?.name || user.value?.email || "";
    const res = await axios.post(`${ApiPath.CsatItem}/${expandedId.value}/comment`, {
      comment: text,
      user: author,
    });
    comments.value = res.data?.comments ?? comments.value;
    commentModalOpen.value = false;
  } catch (e: any) {
    commentError.value = e?.response?.data?.message || e?.message || "Could not save comment";
  } finally {
    commentSaving.value = false;
  }
}

const campaigns = computed<string[]>(() =>
  (board.value?.byCampaign ?? []).map((c: any) => c.campaign).filter((c: string) => c && c !== "unknown"),
);

async function loadBoard() {
  try {
    board.value = (await axios.get(ApiPath.CsatBoard, { params: rangeParams() })).data;
  } catch {
    board.value = null;
  }
}

async function loadList() {
  const params: Record<string, string> = { ...rangeParams() };
  params.limit = String(listLimit.value);
  if (undecidedOnly.value) params.undecidedOnly = "true";
  if (fReviewAction.value) params.reviewAction = fReviewAction.value;
  if (fStatus.value) params.status = fStatus.value;
  if (fDecision.value) params.decision = fDecision.value;
  if (fCampaign.value) params.campaign = fCampaign.value;
  if (fRaised.value) params.raised = fRaised.value;
  if (fClientOutcome.value) params.clientOutcome = fClientOutcome.value;
  rows.value = (await axios.get(ApiPath.CsatList, { params })).data ?? [];
  // Drop selections for rows that fell out of the new result set.
  const visible = new Set(rows.value.map((r: any) => r.id));
  selected.value = new Set([...selected.value].filter((id) => visible.has(id)));
}

async function loadAll() {
  loading.value = true;
  error.value = "";
  try {
    await Promise.all([loadBoard(), loadList()]);
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load CSAT data";
  } finally {
    loading.value = false;
  }
}

/**
 * Starts a BACKGROUND assessment run and polls it.
 *
 * The old synchronous endpoint held the HTTP request open for the whole run, so
 * it was capped by the proxy timeout at roughly 25 records — meaning ~17 manual
 * rounds for the 400 a bulk import produces. This returns immediately and
 * reports progress instead, and is scoped to the page's date range so an
 * assessor can work through one slice at a time.
 */
async function runBatch() {
  running.value = true;
  runMsg.value = "";
  try {
    const res = await axios.post(ApiPath.CsatRunBatchAsync, {
      limit: batchLimit.value,
      ...rangeParams(),
    });
    assessJobId.value = res.data?.jobId ?? null;
    assessTotal.value = res.data?.total ?? 0;
    assessProgress.value = 0;
    assessErrors.value = 0;
    if (!assessTotal.value) {
      runMsg.value = "Nothing to assess in this date range.";
      running.value = false;
      return;
    }
    runMsg.value = `Assessing ${assessTotal.value} record(s) in the background…`;
    startAssessPolling();
  } catch (e: any) {
    runMsg.value = e?.response?.data?.message || e?.message || "Batch failed";
    running.value = false;
  }
}

function startAssessPolling() {
  if (assessPoll) clearInterval(assessPoll);
  assessPoll = setInterval(async () => {
    if (!assessJobId.value) return;
    try {
      const { data: job } = await axios.get(
        `${ApiPath.Recordings}/jobs/${assessJobId.value}`,
      );
      assessProgress.value = job.progress ?? 0;
      assessTotal.value = job.total ?? assessTotal.value;
      assessErrors.value = job.errorCount ?? 0;
      if (job.status !== "running") {
        stopAssessPolling();
        runMsg.value =
          `Assessed ${assessProgress.value} of ${assessTotal.value}` +
          (assessErrors.value ? ` — ${assessErrors.value} errored.` : ".");
        await loadAll();
      }
    } catch {
      // Job row gone or unreachable — stop rather than poll forever.
      stopAssessPolling();
      runMsg.value = "Lost track of the assessment job; refresh to see results.";
      await loadAll();
    }
  }, 3000);
}

function stopAssessPolling() {
  if (assessPoll) clearInterval(assessPoll);
  assessPoll = null;
  assessJobId.value = null;
  running.value = false;
}

onUnmounted(stopAssessPolling);

async function rematch() {
  rematching.value = true;
  try {
    const res = await axios.post(ApiPath.CsatRematch, {});
    runMsg.value = `Rematched ${res.data?.rematched ?? 0} previously-unmatched record(s).`;
    await loadAll();
  } catch (e: any) {
    runMsg.value = e?.response?.data?.message || e?.message || "Rematch failed";
  } finally {
    rematching.value = false;
  }
}

function resetTranscript() {
  transcriptOpen.value = false;
  transcriptText.value = "";
  transcriptError.value = "";
  transcriptIsChat.value = false;
  comments.value = [];
  commentModalOpen.value = false;
}

async function toggleRow(id: string) {
  if (expandedId.value === id) {
    expandedId.value = null;
    detail.value = null;
    resetTranscript();
    return;
  }
  expandedId.value = id;
  detail.value = null;
  resetTranscript();
  loadingDetail.value = true;
  try {
    detail.value = (await axios.get(`${ApiPath.CsatItem}/${id}`)).data;
    comments.value = detail.value?.comments ?? [];
  } catch {
    detail.value = null;
  } finally {
    loadingDetail.value = false;
  }
}

async function requeueRow(id: string) {
  try {
    await axios.post(`${ApiPath.CsatItem}/${id}/requeue`, {});
    await loadAll();
  } catch { /* ignore */ }
}

async function assessRow(id: string) {
  try {
    await axios.post(`${ApiPath.CsatItem}/${id}/assess`, {});
    await loadAll();
    if (expandedId.value === id) {
      detail.value = (await axios.get(`${ApiPath.CsatItem}/${id}`)).data;
    }
  } catch { /* ignore */ }
}

function decisionChip(d: string | null) {
  if (d === "contest") return "chip chip--success";
  if (d === "do_not_contest") return "chip chip--danger";
  if (d === "unclear") return "chip chip--warning";
  return "chip chip--secondary";
}
function decisionLabel(d: string | null) {
  if (d === "contest") return "Contest";
  if (d === "do_not_contest") return "Do Not Contest";
  if (d === "unclear") return "Unclear";
  return "—";
}
function statusChip(s: string) {
  if (s === "assessed") return "chip chip--success";
  if (s === "error") return "chip chip--danger";
  if (s === "unmatched") return "chip chip--warning";
  if (s === "assessing") return "chip chip--info";
  return "chip chip--secondary";
}
function fmtDate(v: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : d.toLocaleString();
}
function fmtPct(v: number | null | undefined) {
  return typeof v === "number" ? `${Math.round(v * 100)}%` : "—";
}
// Older/looser assessments sometimes return a bare rule number instead of a name.
function ruleLabel(ru: unknown) {
  const s = String(ru).trim().replace(/_/g, " ");
  return /^\d+$/.test(s) ? `Rule ${s}` : s;
}

// Every id the row carries — the grid only has room for one, but a reviewer
// searching by CSAT/recording id needs to see which id actually matched.
function idTooltip(r: any) {
  return [
    `CSAT id: ${r.id ?? "—"}`,
    `TPS survey id: ${r.interactionTpsId ?? "—"}`,
    `Interaction ref: ${r.interactionId ?? "—"}`,
    `Recording id: ${r.recordingId ?? "—"}`,
  ].join("\n");
}

function prettySource(s: string) {
  return String(s).replace(/_/g, " ");
}

const FACTOR_LABELS: Record<string, string> = {
  meaningful_assistance: "Meaningful assistance",
  customer_handling: "Customer handling",
  missed_opportunity: "Missed opportunity",
  premature_signposting: "Premature signposting",
  sales_or_enquiry_progressed: "Enquiry progressed",
  delay_within_agent_control: "Delay in agent's control",
  closure_appropriate: "Closure appropriate",
  customer_abusive: "Customer abusive",
};
function factorLabel(k: string) {
  return FACTOR_LABELS[k] || String(k).replace(/_/g, " ");
}
function factorValueText(v: unknown) {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v == null || v === "") return "—";
  const s = String(v);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
// Tone from the agent's perspective: "good" = supports Contest (agent did well),
// "bad" = supports Do Not Contest (agent at fault), "neutral" = n/a or unknown.
function factorTone(k: string, v: unknown): "good" | "bad" | "neutral" {
  const s = String(v).toLowerCase();
  switch (k) {
    case "meaningful_assistance":
    case "sales_or_enquiry_progressed":
      return s === "yes" ? "good" : s === "no" ? "bad" : "neutral";
    case "customer_handling":
      return s === "good" ? "good" : s === "poor" ? "bad" : "neutral";
    case "missed_opportunity":
    case "premature_signposting":
    case "delay_within_agent_control":
      return s === "true" ? "bad" : s === "false" ? "good" : "neutral";
    case "closure_appropriate":
      return s === "true" ? "good" : s === "false" ? "bad" : "neutral";
    case "customer_abusive":
      return s === "true" ? "good" : "neutral"; // abuse favours contesting
    default:
      return "neutral";
  }
}

const contestCount = computed(
  () => (board.value?.decisions ?? []).find((d: any) => d.decision === "contest")?.count ?? 0,
);
const doNotContestCount = computed(
  () => (board.value?.decisions ?? []).find((d: any) => d.decision === "do_not_contest")?.count ?? 0,
);
const contestPoints = computed<number[]>(
  () => (board.value?.decisionTrend ?? []).map((t: any) => Number(t.contest) || 0),
);
const doNotContestPoints = computed<number[]>(
  () => (board.value?.decisionTrend ?? []).map((t: any) => Number(t.do_not_contest) || 0),
);

// Supervisor review outcomes. "Raise with client" (accept a contest OR disagree
// with a do-not-contest) is the key exported metric.
const raiseWithClientCount = computed(() => board.value?.reviews?.raiseWithClient ?? 0);
const doNotRaiseCount = computed(() => board.value?.reviews?.doNotRaise ?? 0);
const raiseWithClientPoints = computed<number[]>(
  () => (board.value?.reviewTrend ?? []).map((t: any) => Number(t.raiseWithClient) || 0),
);
const doNotRaisePoints = computed<number[]>(
  () => (board.value?.reviewTrend ?? []).map((t: any) => Number(t.doNotRaise) || 0),
);

// Raise pipeline: reviewed as raiseable → actually sent → client answered.
const notRaisedCount = computed(() => board.value?.reviews?.notRaised ?? 0);
const raisedCount = computed(() => board.value?.reviews?.raised ?? 0);
const awaitingClientCount = computed(() => board.value?.reviews?.awaitingClient ?? 0);
const clientAcceptedCount = computed(() => board.value?.reviews?.clientAccepted ?? 0);
const clientRejectedCount = computed(() => board.value?.reviews?.clientRejected ?? 0);

function clientOutcomeLabel(o: string | null) {
  if (o === "accepted") return "Accepted";
  if (o === "rejected") return "Rejected";
  return "—";
}
// Accepted = the contest stood, the CSAT is no longer a fail (good for us).
function clientOutcomeChip(o: string | null) {
  if (o === "accepted") return "chip chip--success";
  if (o === "rejected") return "chip chip--danger";
  return "chip chip--secondary";
}

// ── Supervisor review action (on the expanded record) ────────────────────────
const reviewSaving = ref(false);
async function setReview(action: "accept" | "disagree" | "clear") {
  if (!expandedId.value) return;
  reviewSaving.value = true;
  try {
    const author = user.value?.name || user.value?.email || "";
    const res = await axios.post(`${ApiPath.CsatItem}/${expandedId.value}/review`, { action, user: author });
    // The endpoint returns the authoritative values (nulls when cleared).
    if (detail.value && res.data) {
      detail.value.reviewAction = res.data.reviewAction ?? null;
      detail.value.reviewOutcome = res.data.reviewOutcome ?? null;
      detail.value.reviewedBy = res.data.reviewedBy ?? null;
      detail.value.reviewedAt = res.data.reviewedAt ?? null;
    }
    await Promise.all([loadBoard(), loadList()]);
  } catch {
    /* ignore */
  } finally {
    reviewSaving.value = false;
  }
}

// ── Row selection + bulk raise / client response ─────────────────────────────
// The weekly loop is: export the raiseable records → mark them sent → later the
// client answers on a batch of them, so both actions work on a multi-select.
const selected = ref<Set<string>>(new Set());
const bulkSaving = ref(false);
const bulkMsg = ref("");

function toggleSelect(id: string) {
  const next = new Set(selected.value);
  next.has(id) ? next.delete(id) : next.add(id);
  selected.value = next;
}
// Select-all works on what's on screen, so it respects the ID filter and leaves
// any selection made outside the current filter alone.
const allSelected = computed(
  () =>
    visibleRows.value.length > 0 &&
    visibleRows.value.every((r: any) => selected.value.has(r.id)),
);
function toggleSelectAll() {
  const next = new Set(selected.value);
  const wasAll = allSelected.value;
  for (const r of visibleRows.value) {
    wasAll ? next.delete(r.id) : next.add(r.id);
  }
  selected.value = next;
}
const selectedIds = computed(() => [...selected.value]);

function authorName() {
  return user.value?.name || user.value?.email || "";
}

async function markRaised(ids: string[], raised: boolean) {
  if (!ids.length) return;
  bulkSaving.value = true;
  bulkMsg.value = "";
  try {
    await axios.post(ApiPath.CsatRaise, { ids, raised, user: authorName() });
    bulkMsg.value = raised
      ? `Marked ${ids.length} record${ids.length === 1 ? "" : "s"} as sent to client.`
      : `Cleared the sent-to-client mark on ${ids.length} record${ids.length === 1 ? "" : "s"}.`;
    selected.value = new Set();
    await refreshAfterMutation();
  } catch (e: any) {
    bulkMsg.value = e?.response?.data?.message || e?.message || "Could not update records";
  } finally {
    bulkSaving.value = false;
  }
}

// Client response modal — outcome + mandatory explanation, over N records.
const clientModalOpen = ref(false);
const clientModalOutcome = ref<"accepted" | "rejected">("accepted");
const clientModalIds = ref<string[]>([]);
const clientModalComment = ref("");
const clientModalSaving = ref(false);
const clientModalError = ref("");

function openClientModal(outcome: "accepted" | "rejected", ids: string[]) {
  if (!ids.length) return;
  clientModalOutcome.value = outcome;
  clientModalIds.value = ids;
  clientModalComment.value = "";
  clientModalError.value = "";
  clientModalOpen.value = true;
}

async function saveClientResponse() {
  const comment = clientModalComment.value.trim();
  if (!comment) {
    clientModalError.value = "Add a comment explaining the client's decision.";
    return;
  }
  clientModalSaving.value = true;
  clientModalError.value = "";
  try {
    await axios.post(ApiPath.CsatClientResponse, {
      ids: clientModalIds.value,
      outcome: clientModalOutcome.value,
      comment,
      user: authorName(),
    });
    const n = clientModalIds.value.length;
    bulkMsg.value = `Client ${clientModalOutcome.value} on ${n} record${n === 1 ? "" : "s"}.`;
    clientModalOpen.value = false;
    selected.value = new Set();
    await refreshAfterMutation();
  } catch (e: any) {
    clientModalError.value =
      e?.response?.data?.message || e?.message || "Could not save the client response";
  } finally {
    clientModalSaving.value = false;
  }
}

async function clearClientResponse(ids: string[]) {
  if (!ids.length) return;
  bulkSaving.value = true;
  try {
    await axios.post(ApiPath.CsatClientResponse, {
      ids,
      outcome: "clear",
      user: authorName(),
    });
    bulkMsg.value = `Cleared the client response on ${ids.length} record${ids.length === 1 ? "" : "s"}.`;
    selected.value = new Set();
    await refreshAfterMutation();
  } catch (e: any) {
    bulkMsg.value = e?.response?.data?.message || e?.message || "Could not clear";
  } finally {
    bulkSaving.value = false;
  }
}

// Reload the tiles + table, and the open record's detail if one is expanded.
async function refreshAfterMutation() {
  await Promise.all([loadBoard(), loadList()]);
  if (expandedId.value) {
    try {
      detail.value = (await axios.get(`${ApiPath.CsatItem}/${expandedId.value}`)).data;
    } catch { /* ignore */ }
  }
}

// ── KPI drill-down modal (record list + CSV export) ──────────────────────────
const kpiModalOpen = ref(false);
const kpiModalTitle = ref("");
const kpiModalRows = ref<any[]>([]);
const kpiModalLoading = ref(false);

// When true, exporting the "Raise with client" list also stamps every record in
// it as sent — the normal weekly flow. Off for the other tiles (nothing is being
// passed to the client), and the per-record toggle stays available regardless.
const kpiMarkRaised = ref(true);
const kpiIsRaiseList = ref(false);
const kpiExporting = ref(false);
const kpiExportMsg = ref("");

async function openKpiModal(filter: Record<string, string>, title: string) {
  kpiModalOpen.value = true;
  kpiModalTitle.value = title;
  kpiModalRows.value = [];
  kpiModalLoading.value = true;
  kpiIsRaiseList.value = filter.reviewOutcome === "raise_with_client";
  kpiMarkRaised.value = kpiIsRaiseList.value;
  kpiExportMsg.value = "";
  try {
    // Drill-downs respect the page's date range too.
    kpiModalRows.value =
      (await axios.get(ApiPath.CsatList, {
        params: { ...rangeParams(), ...filter, limit: 1000 },
      })).data ?? [];
  } catch {
    kpiModalRows.value = [];
  } finally {
    kpiModalLoading.value = false;
  }
}

/**
 * Flattens every reviewer comment on a record into ONE cell, so a record stays a
 * single CSV row rather than fanning out into one row per comment.
 *
 * Newlines are replaced rather than quoted: Excel handles quoted newlines, but
 * they make the file miserable to read, filter and paste elsewhere.
 */
function flattenComments(row: any): string {
  let list: any[] = [];
  try {
    const parsed = row?.reviewerCommentsJson
      ? JSON.parse(row.reviewerCommentsJson)
      : [];
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    /* malformed json — fall through to the CSAT verbatim below */
  }
  const parts = list.map((c) => {
    const who = c?.user || "reviewer";
    const when = c?.at ? new Date(c.at).toLocaleString() : "";
    const text = String(c?.comment ?? "").replace(/\s*[\r\n]+\s*/g, " ");
    return `[${who}${when ? " " + when : ""}] ${text}`;
  });
  return parts.join(" | ");
}

function downloadCsv(rows: any[], filename: string) {
  const cols = [
    "interactionId", "interactionTpsId", "agent", "campaign", "score", "scoreMax",
    "status", "decision", "confidence", "reviewAction", "reviewOutcome", "reviewedBy",
    "reviewedAt", "raisedAt", "raisedBy", "clientOutcome", "clientRespondedAt",
    "clientResponseBy", "clientResponseComment", "interactionDateTime",
    // The customer's own verbatim from the survey, plus every reviewer comment
    // collapsed into a single cell.
    "csatComment", "reviewerComments",
  ];
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const value = (r: any, c: string) => {
    if (c === "reviewerComments") return flattenComments(r);
    // `comment` is the customer's survey verbatim; name it clearly in the export
    // so it is not confused with a reviewer's note.
    if (c === "csatComment") return String(r.comment ?? "").replace(/\s*[\r\n]+\s*/g, " ");
    return r[c];
  };
  const csv = [
    cols.join(","),
    ...rows.map((r: any) => cols.map((c) => esc(value(r, c))).join(",")),
  ].join("\n");
  // BOM so Excel reads UTF-8 correctly (£ signs, accented names).
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Exports exactly what the grid is currently showing, filters and all. */
function exportVisibleCsv() {
  if (!visibleRows.value.length) return;
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(visibleRows.value, `csat-records-${stamp}.csv`);
}

async function exportKpiCsv() {
  const exportRows = kpiModalRows.value;
  if (!exportRows.length) return;

  kpiExporting.value = true;
  kpiExportMsg.value = "";
  try {
    downloadCsv(
      exportRows,
      `csat-${kpiModalTitle.value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`,
    );

    // The file has left the building — stamp the records as sent if asked.
    if (kpiIsRaiseList.value && kpiMarkRaised.value) {
      const ids = exportRows.map((r: any) => r.id);
      await axios.post(ApiPath.CsatRaise, { ids, raised: true, user: authorName() });
      kpiExportMsg.value = `Exported and marked ${ids.length} record${ids.length === 1 ? "" : "s"} as sent to client.`;
      await refreshAfterMutation();
      // Reflect the new raisedAt in the open modal without a re-fetch.
      const stamp = new Date().toISOString();
      kpiModalRows.value = kpiModalRows.value.map((r: any) => ({
        ...r,
        raisedAt: r.raisedAt ?? stamp,
        raisedBy: r.raisedBy ?? authorName(),
      }));
    } else {
      kpiExportMsg.value = `Exported ${exportRows.length} record${exportRows.length === 1 ? "" : "s"}.`;
    }
  } catch (e: any) {
    kpiExportMsg.value =
      e?.response?.data?.message || e?.message || "Exported, but could not mark as sent";
  } finally {
    kpiExporting.value = false;
  }
}

onMounted(loadAll);
</script>

<template>
  <div class="page">
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <h1 class="hero-title">CSAT Assessment</h1>
          <div class="hero-subtitle">
            Reviews CSAT survey scores against the campaign contest framework — separate from the
            standard transcribe/insights pipeline. Only scores of 3 or less (out of 5) are assessed;
            4-5 are excluded. Assesses whether the final agent fairly earned each score.
          </div>
        </div>
        <button class="btn btn--ghost" :disabled="loading" @click="loadAll">Refresh</button>
      </div>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Date range — scopes the tiles, the table and the drill-down exports.
         Reviewing CSATs is a weekly task, so this defaults to the last 7 days. -->
    <div class="range-bar">
      <div class="range-presets">
        <button
          v-for="p in ([
            { k: 'thisWeek', label: 'This week' },
            { k: 'lastWeek', label: 'Last week' },
            { k: 'last7', label: 'Last 7 days' },
            { k: 'last30', label: 'Last 30 days' },
            { k: 'thisMonth', label: 'This month' },
            { k: 'all', label: 'All time' },
          ] as const)"
          :key="p.k"
          type="button"
          class="range-btn"
          :class="{ 'range-btn--active': activePreset === p.k }"
          :disabled="loading"
          @click="applyPreset(p.k)"
        >{{ p.label }}</button>
      </div>
      <div class="range-dates">
        <label class="range-label">From</label>
        <input v-model="fFrom" type="date" class="date-input" :disabled="loading" @change="onDateEdited" />
        <label class="range-label">To</label>
        <input v-model="fTo" type="date" class="date-input" :disabled="loading" @change="onDateEdited" />
        <span class="muted" style="font-size: 11px">showing {{ rangeLabel }}</span>
      </div>
    </div>

    <!-- Volume + exceptions. The three exception counts share one tile — each
         half/third is its own clickable drill-down, and the outer cells paint the
         tile's edge stripe in their own tone. -->
    <div v-if="board" class="kpi-row">
      <div class="split-stat">
        <button
          type="button"
          class="split-cell split-cell--info"
          title="Every CSAT in this date range. Click to list & export."
          @click="openKpiModal({}, 'All CSATs')"
        >
          <div class="stat-label">Total CSATs</div>
          <div class="stat-value">{{ board.total }}</div>
        </button>
        <button
          type="button"
          class="split-cell split-cell--warn"
          title="Queued, awaiting transcript or mid-assessment. Click to list & export."
          @click="openKpiModal({ status: 'pending_any' }, 'Pending')"
        >
          <div class="stat-label">Pending</div>
          <div class="stat-value">{{ board.pending }}</div>
        </button>
        <button
          type="button"
          class="split-cell split-cell--good"
          title="Assessment complete. Click to list & export."
          @click="openKpiModal({ status: 'assessed' }, 'Assessed')"
        >
          <div class="stat-label">Assessed</div>
          <div class="stat-value">{{ board.assessed }}</div>
        </button>
      </div>
      <div class="split-stat">
        <button
          type="button"
          class="split-cell split-cell--warn"
          title="No matching interaction yet. Click to list & export."
          @click="openKpiModal({ status: 'unmatched' }, 'Unmatched')"
        >
          <div class="stat-label">Unmatched</div>
          <div class="stat-value">{{ board.unmatched }}</div>
        </button>
        <button
          type="button"
          class="split-cell split-cell--neutral"
          title="Scores of 4-5 and bot-handled conversations are not assessed. Click to list & export."
          @click="openKpiModal({ status: 'excluded' }, 'Excluded (4-5 / Bot)')"
        >
          <div class="stat-label">Excluded (4-5 / Bot)</div>
          <div class="stat-value">{{ board.excluded ?? 0 }}</div>
        </button>
        <button
          type="button"
          class="split-cell split-cell--bad"
          title="Assessment failed. Click to list & export."
          @click="openKpiModal({ status: 'error' }, 'Errors')"
        >
          <div class="stat-label">Errors</div>
          <div class="stat-value">{{ board.errors }}</div>
        </button>
      </div>
    </div>

    <!-- AI decision and the supervisor's review of it — each an opposing pair in
         one tile: green edge on the left value, red on the right. Every value is
         its own drill-down. -->
    <div v-if="board" class="kpi-row">
      <div class="split-stat split-stat--titled">
        <div class="split-head">AI Assessment</div>
        <div class="split-row">
        <button
          type="button"
          class="split-cell split-cell--good"
          title="AI says contest this CSAT. Click to list & export."
          @click="openKpiModal({ decision: 'contest' }, 'Contest')"
        >
          <div class="stat-label">Contest</div>
          <div class="stat-value">{{ contestCount }}</div>
          <div v-if="contestPoints.length > 1" class="split-spark"><Sparkline :points="contestPoints" color="#059669" :width="120" :height="26" /></div>
          <div v-if="contestPoints.length > 1" class="split-note">monthly trend</div>
        </button>
        <button
          type="button"
          class="split-cell split-cell--bad"
          title="AI says the score stands. Click to list & export."
          @click="openKpiModal({ decision: 'do_not_contest' }, 'Do Not Contest')"
        >
          <div class="stat-label">Do Not Contest</div>
          <div class="stat-value">{{ doNotContestCount }}</div>
          <div v-if="doNotContestPoints.length > 1" class="split-spark"><Sparkline :points="doNotContestPoints" color="#dc2626" :width="120" :height="26" /></div>
          <div v-if="doNotContestPoints.length > 1" class="split-note">monthly trend</div>
        </button>
        </div>
      </div>
      <div class="split-stat split-stat--titled">
        <div class="split-head">Internal Assessment</div>
        <div class="split-row">
        <button
          type="button"
          class="split-cell split-cell--good"
          title="Supervisor accepted a contest, or disagreed with a do-not-contest. Click to list & export."
          @click="openKpiModal({ reviewOutcome: 'raise_with_client' }, 'Raise with client')"
        >
          <div class="stat-label">Raise with client</div>
          <div class="stat-value">{{ raiseWithClientCount }}</div>
          <div v-if="raiseWithClientPoints.length > 1" class="split-spark"><Sparkline :points="raiseWithClientPoints" color="#059669" :width="120" :height="26" /></div>
          <div v-if="raiseWithClientPoints.length > 1" class="split-note">monthly trend</div>
        </button>
        <button
          type="button"
          class="split-cell split-cell--bad"
          title="Supervisor sided with the score standing. Click to list & export."
          @click="openKpiModal({ reviewOutcome: 'do_not_raise' }, 'Do not raise')"
        >
          <div class="stat-label">Do not raise</div>
          <div class="stat-value">{{ doNotRaiseCount }}</div>
          <div v-if="doNotRaisePoints.length > 1" class="split-spark"><Sparkline :points="doNotRaisePoints" color="#dc2626" :width="120" :height="26" /></div>
          <div v-if="doNotRaisePoints.length > 1" class="split-note">monthly trend</div>
        </button>
        </div>
      </div>
    </div>

    <!-- Raise pipeline: what still has to go to the client vs what has gone, then
         what the client came back with. Same paired-tile pattern. -->
    <div v-if="board" class="kpi-row">
      <div class="split-stat split-stat--titled">
        <div class="split-head">Client Requests</div>
        <div class="split-row">
        <button
          type="button"
          class="split-cell split-cell--warn"
          title="Reviewed as raise-with-client but not yet sent. Click to list & export."
          @click="openKpiModal({ reviewOutcome: 'raise_with_client', raised: 'no' }, 'To send to client')"
        >
          <div class="stat-label">To send to client</div>
          <div class="stat-value">{{ notRaisedCount }}</div>
        </button>
        <button
          type="button"
          class="split-cell split-cell--info"
          title="Marked as sent to the client. Click to list & export."
          @click="openKpiModal({ raised: 'yes' }, 'Sent to client')"
        >
          <div class="stat-label">Sent to client</div>
          <div class="stat-value">{{ raisedCount }}</div>
        </button>
        </div>
      </div>
      <div class="split-stat split-stat--titled">
        <div class="split-head">Client Decision</div>
        <div class="split-row">
        <button
          type="button"
          class="split-cell split-cell--good"
          title="Client accepted the contest — no longer counted as a fail. Click to list & export."
          @click="openKpiModal({ clientOutcome: 'accepted' }, 'Client accepted')"
        >
          <div class="stat-label">Client accepted</div>
          <div class="stat-value">{{ clientAcceptedCount }}</div>
        </button>
        <button
          type="button"
          class="split-cell split-cell--neutral"
          title="Sent, but the client has not come back yet. Click to list & export."
          @click="openKpiModal({ clientOutcome: 'awaiting' }, 'Awaiting client response')"
        >
          <div class="stat-label">Awaiting client</div>
          <div class="stat-value">{{ awaitingClientCount }}</div>
        </button>
        <button
          type="button"
          class="split-cell split-cell--bad"
          title="Client rejected the contest — it stands as a fail. Click to list & export."
          @click="openKpiModal({ clientOutcome: 'rejected' }, 'Client rejected')"
        >
          <div class="stat-label">Client rejected</div>
          <div class="stat-value">{{ clientRejectedCount }}</div>
        </button>
        </div>
      </div>
    </div>

    <!-- Controls -->
    <div class="controls">
      <div class="control-group">
        <label>Run assessment on next</label>
        <input v-model.number="batchLimit" type="number" min="1" max="2000" class="num-input" />
        <button class="btn btn--primary btn--sm" :disabled="running" @click="runBatch">
          {{ running ? "Assessing…" : "Assess pending" }}
        </button>
        <span class="hint">runs in the background, within the date range above</span>
      </div>
      <button class="btn btn--sm" :disabled="rematching" @click="rematch">
        {{ rematching ? "Rematching…" : "Rematch unmatched" }}
      </button>
      <span v-if="runMsg" class="run-msg">{{ runMsg }}</span>

      <!-- Live progress. The run continues server-side even if this page is
           closed, so this is a view of the job rather than the work itself. -->
      <div v-if="running && assessTotal" class="assess-progress">
        <div class="assess-bar">
          <div
            class="assess-bar-fill"
            :style="{ width: Math.round((assessProgress / assessTotal) * 100) + '%' }"
          />
        </div>
        <span class="hint">
          {{ assessProgress }} / {{ assessTotal }}
          <template v-if="assessErrors"> · {{ assessErrors }} errored</template>
        </span>
      </div>
    </div>

    <!-- By campaign — collapsed by default. It sits between the tiles and the
         records grid, so leaving it open pushes an assessor's actual work below
         the fold on every page load. Preference is remembered. -->
    <div v-if="board?.byCampaign?.length" class="tile">
      <button type="button" class="collapse-head" @click="toggleCampaigns">
        <span class="collapse-caret" :class="{ 'collapse-caret--open': campaignsOpen }">▸</span>
        <span class="tile-title" style="margin: 0">By Campaign</span>
        <span class="hint">{{ board.byCampaign.length }} campaigns</span>
      </button>
      <table v-if="campaignsOpen" class="tbl">
        <thead><tr><th>Campaign</th><th>Total</th><th>Assessed</th><th>Contest</th><th>Do Not Contest</th><th>Contest rate</th></tr></thead>
        <tbody>
          <tr v-for="c in board.byCampaign" :key="c.campaign">
            <td>{{ c.campaign }}</td>
            <td>{{ c.total }}</td>
            <td>{{ c.assessed }}</td>
            <td class="good">{{ c.contest }}</td>
            <td class="bad">{{ c.do_not_contest }}</td>
            <td>{{ c.assessed ? Math.round((c.contest / c.assessed) * 100) + "%" : "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Filters -->
    <div class="controls">
      <div class="control-group">
        <label>Status</label>
        <select v-model="fStatus" class="sel" @change="loadList">
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="awaiting_transcript">Awaiting transcript</option>
          <option value="assessed">Assessed</option>
          <option value="error">Error</option>
          <option value="unmatched">Unmatched</option>
          <option value="excluded">Excluded (4-5 / Bot)</option>
        </select>
      </div>
      <div class="control-group">
        <label>Decision</label>
        <select v-model="fDecision" class="sel" @change="loadList">
          <option value="">All</option>
          <option value="contest">Contest</option>
          <option value="do_not_contest">Do Not Contest</option>
          <option value="unclear">Unclear</option>
        </select>
      </div>
      <div class="control-group">
        <label>Campaign</label>
        <select v-model="fCampaign" class="sel" @change="loadList">
          <option value="">All</option>
          <option v-for="c in campaigns" :key="c" :value="c">{{ c }}</option>
        </select>
      </div>
      <div class="control-group">
        <label>Sent to client</label>
        <select v-model="fRaised" class="sel" @change="loadList">
          <option value="">All</option>
          <option value="yes">Sent</option>
          <option value="no">Not sent</option>
        </select>
      </div>
      <div class="control-group">
        <label>Client response</label>
        <select v-model="fClientOutcome" class="sel" @change="loadList">
          <option value="">All</option>
          <option value="awaiting">Awaiting response</option>
          <option value="accepted">Accepted (not a fail)</option>
          <option value="rejected">Rejected (still a fail)</option>
        </select>
      </div>
      <!-- Outstanding work only. After a bulk import the list is mostly records
           already actioned, which buries the ones still needing a decision. -->
      <div class="control-group">
        <label>Show</label>
        <select v-model="undecidedOnly" class="sel" @change="loadList">
          <option :value="false">All records</option>
          <option :value="true">Needs a decision</option>
        </select>
      </div>
      <div class="control-group">
        <label>Supervisor</label>
        <select v-model="fReviewAction" class="sel" @change="loadList">
          <option value="">Any</option>
          <option value="disagree">Disagreed with the model</option>
          <option value="accept">Accepted the model</option>
        </select>
      </div>
      <div class="control-group">
        <label>Max rows</label>
        <select v-model.number="listLimit" class="sel" @change="loadList">
          <option :value="200">200</option>
          <option :value="500">500</option>
          <option :value="1000">1000</option>
          <option :value="2000">2000</option>
        </select>
      </div>
      <!-- Filters the loaded rows only — no re-fetch. Matches any id on the
           record (CSAT id, TPS survey id, interaction ref, recording id). -->
      <div class="control-group">
        <label>Find by ID</label>
        <input
          v-model="fId"
          type="search"
          class="txt-input"
          placeholder="CSAT / TPS / interaction / recording id"
          title="Partial match against the CSAT record id, TPS survey id, interaction reference or recording id"
        />
        <button v-if="fId" class="btn btn--ghost btn--sm" @click="fId = ''">Clear</button>
        <span v-if="fId" class="run-msg">{{ visibleRows.length }} of {{ rows.length }}</span>
      </div>
    </div>

    <!-- Bulk actions on the checked rows. Marking sent and recording the client's
         answer are both batch jobs in practice, hence the multi-select. -->
    <div v-if="selected.size" class="bulk-bar">
      <div class="bulk-count">{{ selected.size }} selected</div>
      <button class="btn btn--sm" :disabled="bulkSaving" @click="markRaised(selectedIds, true)">
        Mark as sent to client
      </button>
      <button class="btn btn--sm" :disabled="bulkSaving" @click="markRaised(selectedIds, false)">
        Un-mark as sent
      </button>
      <span class="bulk-sep" />
      <button class="btn btn--sm btn--good" :disabled="bulkSaving" @click="openClientModal('accepted', selectedIds)">
        Client accepted
      </button>
      <button class="btn btn--sm btn--bad" :disabled="bulkSaving" @click="openClientModal('rejected', selectedIds)">
        Client rejected
      </button>
      <button class="btn btn--ghost btn--sm" :disabled="bulkSaving" @click="clearClientResponse(selectedIds)">
        Clear response
      </button>
      <button class="btn btn--ghost btn--sm" @click="selected = new Set()">Clear selection</button>
    </div>
    <div v-if="bulkMsg" class="run-msg" style="margin-bottom: 12px">{{ bulkMsg }}</div>

    <!-- List -->
    <div class="tile">
      <div class="tile-title records-head">
        <span>
          CSAT Records
          <span class="chip chip--secondary" style="font-size: 10px">{{ visibleRows.length }}</span>
          <span v-if="fId" class="muted" style="font-weight: 400; font-size: 11px">
            filtered by id “{{ fId }}” · {{ rows.length }} loaded
          </span>
        </span>
        <button
          class="btn btn--ghost btn--sm"
          :disabled="!visibleRows.length"
          title="Export the records currently shown, including every reviewer comment in one column"
          @click="exportVisibleCsv"
        >
          Export {{ visibleRows.length }} to CSV
        </button>
      </div>
      <div class="tbl-scroll">
      <table class="tbl">
        <thead>
          <tr>
            <th class="sel-cell">
              <input
                type="checkbox"
                :checked="allSelected"
                :disabled="!visibleRows.length"
                title="Select all rows in this list"
                @change="toggleSelectAll"
              />
            </th>
            <th></th><th>Interaction</th><th>Agent</th><th>Campaign</th><th>Score</th>
            <th>Status</th><th>Decision</th>
            <th title="Marked only where the supervisor overruled the model">Disagreed</th>
            <th>Raise with client</th><th>Sent</th>
            <th>Client</th><th>Conf.</th><th>Date</th><th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="r in visibleRows" :key="r.id">
            <tr class="row" :class="{ 'row--open': expandedId === r.id }" @click="toggleRow(r.id)">
              <td class="sel-cell" @click.stop>
                <input
                  type="checkbox"
                  :checked="selected.has(r.id)"
                  @change="toggleSelect(r.id)"
                />
              </td>
              <td class="expander">{{ expandedId === r.id ? "▾" : "▸" }}</td>
              <td :title="idTooltip(r)">{{ r.interactionId || r.interactionTpsId }}</td>
              <td>{{ r.agent || "—" }}</td>
              <td>{{ r.campaign || "—" }}</td>
              <td>{{ r.score ?? "—" }}<span v-if="r.scoreMax">/{{ r.scoreMax }}</span></td>
              <td><span :class="statusChip(r.status)" style="font-size: 10px">{{ r.status }}</span></td>
              <td><span :class="decisionChip(r.decision)" style="font-size: 10px">{{ decisionLabel(r.decision) }}</span></td>
              <!-- Marked ONLY on disagreement. A chip on every row would be
                   noise; the whole point is that an override stands out. -->
              <td class="disagree-cell">
                <span
                  v-if="r.reviewAction === 'disagree'"
                  class="disagree-flag"
                  :title="
                    'Supervisor disagreed with the model' +
                    (r.reviewedBy ? ' — ' + r.reviewedBy : '')
                  "
                >⚠ Disagreed</span>
              </td>
              <td>
                <span
                  v-if="r.reviewOutcome === 'raise_with_client'"
                  class="chip chip--warning"
                  style="font-size: 10px"
                  title="Supervisor: raise with client"
                >Yes</span>
                <span
                  v-else-if="r.reviewOutcome === 'do_not_raise'"
                  class="chip chip--secondary"
                  style="font-size: 10px"
                  title="Supervisor: do not raise"
                >No</span>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <span
                  v-if="r.raisedAt"
                  class="chip chip--info"
                  style="font-size: 10px"
                  :title="'Sent to client ' + fmtDate(r.raisedAt) + (r.raisedBy ? ' by ' + r.raisedBy : '')"
                >Sent</span>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <span
                  v-if="r.clientOutcome"
                  :class="clientOutcomeChip(r.clientOutcome)"
                  style="font-size: 10px"
                  :title="r.clientResponseComment || ''"
                >{{ clientOutcomeLabel(r.clientOutcome) }}</span>
                <span v-else-if="r.raisedAt" class="muted" title="Sent, awaiting the client's answer">awaiting</span>
                <span v-else class="muted">—</span>
              </td>
              <td>{{ fmtPct(r.confidence) }}</td>
              <td class="muted">{{ fmtDate(r.interactionDateTime || r.createdAt) }}</td>
              <td @click.stop>
                <button v-if="r.status === 'pending' || r.status === 'awaiting_transcript' || r.status === 'error'" class="btn btn--sm" @click="assessRow(r.id)">Assess</button>
              </td>
            </tr>
            <tr v-if="expandedId === r.id" class="detail-row">
              <td colspan="15">
                <div v-if="loadingDetail" class="muted">Loading…</div>
                <div v-else-if="detail" class="csat-detail" :class="{ 'csat-detail--split': transcriptOpen }">
                  <div class="csat-assessment">
                  <!-- Verdict banner -->
                  <div class="verdict" :class="'verdict--' + (detail.decision || 'unknown')">
                    <div class="verdict-main">
                      <div class="verdict-label">{{ decisionLabel(detail.decision) }}</div>
                      <div v-if="detail.confidence != null" class="verdict-conf">
                        <div class="conf-bar"><div class="conf-fill" :style="{ width: fmtPct(detail.confidence) }" /></div>
                        <span>{{ fmtPct(detail.confidence) }} confidence</span>
                      </div>
                    </div>
                    <div class="verdict-badges">
                      <span v-if="detail.dissatisfaction_source" class="vbadge vbadge--neutral">source: {{ prettySource(detail.dissatisfaction_source) }}</span>
                      <span v-if="detail.parsed?.knowledge_verified === true" class="vbadge vbadge--good">knowledge verified</span>
                      <span v-else-if="detail.parsed?.knowledge_verified === false" class="vbadge vbadge--bad">knowledge incorrect</span>
                      <span v-if="detail.agent_materially_contributed === true" class="vbadge vbadge--bad">agent contributed</span>
                      <span v-else-if="detail.agent_materially_contributed === false" class="vbadge vbadge--good">agent not at fault</span>
                    </div>
                  </div>

                  <!-- Supervisor action toolbar — kept separate from the banner's
                       info chips so buttons and chips don't merge together. -->
                  <div class="csat-actions">
                    <button v-if="detail.recordingId" class="btn btn--sm" @click="drawerRecordingId = detail.recordingId">Open interaction</button>
                    <button v-if="detail.recordingId && !transcriptOpen" class="btn btn--sm" @click.stop="toggleTranscript">View transcript/comments</button>
                    <button v-if="detail.status === 'assessed'" class="btn btn--sm" @click.stop="requeueRow(r.id)">Re-assess</button>
                  </div>

                  <!-- THE DECISION. This is the point of the page, so it gets its
                       own full-width bar rather than sitting among the secondary
                       actions above. flex-basis:100% keeps it on its own row and
                       identically placed whether or not the transcript pane has
                       turned this container into a two-column split. -->
                  <div
                    v-if="detail.status === 'assessed'"
                    class="csat-decision-bar"
                    :class="{ 'csat-decision-bar--done': !!detail.reviewAction }"
                  >
                    <div class="csat-decision-ask">
                      <template v-if="detail.reviewAction === 'accept'">
                        You <strong>accepted</strong> the recommendation.
                      </template>
                      <template v-else-if="detail.reviewAction === 'disagree'">
                        You <strong>disagreed</strong> with the recommendation.
                      </template>
                      <template v-else>
                        Do you agree with
                        <strong>{{ detail.decision === "contest" ? "Contest" : detail.decision === "do_not_contest" ? "Do Not Contest" : "this assessment" }}</strong>?
                      </template>
                      <span
                        v-if="detail.reviewOutcome"
                        class="chip"
                        :class="detail.reviewOutcome === 'raise_with_client' ? 'chip--warning' : 'chip--secondary'"
                        :title="detail.reviewedBy ? 'by ' + detail.reviewedBy : ''"
                      >{{ detail.reviewOutcome === "raise_with_client" ? "Raise with client" : "Do not raise" }}<template v-if="detail.reviewedBy"> · {{ detail.reviewedBy }}</template></span>
                    </div>
                    <div class="csat-decision-actions" role="group" aria-label="Supervisor review">
                      <button
                        type="button"
                        class="csat-decision-btn csat-decision-btn--accept"
                        :class="{ 'csat-decision-btn--active': detail.reviewAction === 'accept' }"
                        :disabled="reviewSaving"
                        :title="detail.reviewAction === 'accept' ? 'Click to clear' : 'Accept the AI recommendation'"
                        @click.stop="setReview(detail.reviewAction === 'accept' ? 'clear' : 'accept')"
                      >{{ detail.reviewAction === "accept" ? "✓ Accepted" : "Accept recommendation" }}</button>
                      <button
                        type="button"
                        class="csat-decision-btn csat-decision-btn--disagree"
                        :class="{ 'csat-decision-btn--active': detail.reviewAction === 'disagree' }"
                        :disabled="reviewSaving"
                        :title="detail.reviewAction === 'disagree' ? 'Click to clear' : 'Disagree with the AI recommendation'"
                        @click.stop="setReview(detail.reviewAction === 'disagree' ? 'clear' : 'disagree')"
                      >{{ detail.reviewAction === "disagree" ? "✓ Disagreed" : "Disagree" }}</button>
                    </div>
                  </div>

                  <!-- Raise + client response for this one record. Same actions as
                       the bulk bar, for when you're working a single case. -->
                  <div v-if="detail.reviewOutcome === 'raise_with_client'" class="csat-actions">
                    <button
                      class="btn btn--sm"
                      :disabled="bulkSaving"
                      @click.stop="markRaised([r.id], !detail.raisedAt)"
                    >{{ detail.raisedAt ? "Un-mark as sent" : "Mark as sent to client" }}</button>
                    <span
                      v-if="detail.raisedAt"
                      class="chip chip--info"
                      style="font-size: 10px"
                      :title="detail.raisedBy ? 'by ' + detail.raisedBy : ''"
                    >Sent {{ fmtDate(detail.raisedAt) }}<template v-if="detail.raisedBy"> · {{ detail.raisedBy }}</template></span>
                    <span class="csat-actions-sep" />
                    <button class="btn btn--sm btn--good" :disabled="bulkSaving" @click.stop="openClientModal('accepted', [r.id])">Client accepted</button>
                    <button class="btn btn--sm btn--bad" :disabled="bulkSaving" @click.stop="openClientModal('rejected', [r.id])">Client rejected</button>
                    <button v-if="detail.clientOutcome" class="btn btn--ghost btn--sm" :disabled="bulkSaving" @click.stop="clearClientResponse([r.id])">Clear response</button>
                  </div>

                  <!-- The client's verdict and their stated reasoning. -->
                  <div v-if="detail.clientOutcome" class="client-verdict" :class="'client-verdict--' + detail.clientOutcome">
                    <div class="client-verdict-head">
                      <span :class="clientOutcomeChip(detail.clientOutcome)" style="font-size: 10px">
                        Client {{ clientOutcomeLabel(detail.clientOutcome).toLowerCase() }}
                      </span>
                      <span class="muted" style="font-size: 11px">
                        {{ fmtDate(detail.clientRespondedAt) }}<template v-if="detail.clientResponseBy"> · recorded by {{ detail.clientResponseBy }}</template>
                      </span>
                    </div>
                    <div class="csat-block-title" style="margin: 8px 0 4px">
                      {{ detail.clientOutcome === "accepted" ? "No longer counted as a fail — client's reasoning" : "Stands as a fail — client's reasoning" }}
                    </div>
                    <div class="client-verdict-text">{{ detail.clientResponseComment || "—" }}</div>
                  </div>

                  <p v-if="detail.parsed?.headline" class="csat-headline">{{ detail.parsed.headline }}</p>
                  <p v-if="detail.rationale" class="csat-rationale">{{ detail.rationale }}</p>

                  <!-- Factor grid (colour = agent's favour: green supports contest, red supports do-not) -->
                  <div v-if="detail.parsed?.factors" class="factor-grid">
                    <div v-for="(v, k) in detail.parsed.factors" :key="k" class="factor-cell" :class="'factor-cell--' + factorTone(String(k), v)">
                      <div class="factor-label">{{ factorLabel(String(k)) }}</div>
                      <div class="factor-value">{{ factorValueText(v) }}</div>
                    </div>
                  </div>

                  <div v-if="detail.parsed?.rules_triggered?.length" class="csat-block">
                    <div class="csat-block-title">Rules applied</div>
                    <div class="chip-row">
                      <span v-for="(ru, i) in detail.parsed.rules_triggered" :key="i" class="chip chip--info" style="font-size: 10px">{{ ruleLabel(ru) }}</span>
                    </div>
                  </div>

                  <div v-if="detail.parsed?.evidence_quotes?.length" class="csat-block">
                    <div class="csat-block-title">Evidence from transcript</div>
                    <blockquote v-for="(q, i) in detail.parsed.evidence_quotes" :key="i" class="evidence">{{ q }}</blockquote>
                  </div>

                  <div v-if="detail.comment" class="csat-comment">
                    <span class="csat-comment-label">Customer said</span>
                    <span class="csat-comment-text">"{{ detail.comment }}"</span>
                    <span v-if="detail.score != null" class="csat-comment-score">{{ detail.score }}<span v-if="detail.scoreMax">/{{ detail.scoreMax }}</span></span>
                  </div>

                  <p v-if="detail.lastError" class="detail-error">{{ detail.lastError }}</p>
                  </div>

                  <!-- Side-by-side transcript for this record -->
                  <div v-if="transcriptOpen" class="csat-transcript-pane">
                    <div class="csat-transcript-head">
                      <div class="csat-block-title" style="margin: 0">Transcript</div>
                      <div class="csat-transcript-actions">
                        <button class="btn btn--sm" @click.stop="openCommentModal">Add comment</button>
                        <button class="btn btn--ghost btn--sm" @click.stop="transcriptOpen = false">Close transcript</button>
                      </div>
                    </div>
                    <div v-if="transcriptLoading" class="muted">Loading transcript…</div>
                    <div v-else-if="transcriptError" class="muted">{{ transcriptError }}</div>
                    <!-- Shared renderer, so a transcript looks the same here as in
                         the interaction drawer. Was a raw <pre>, which showed
                         imported chats as a wall of JSON. -->
                    <ChatTranscript
                      v-else
                      :text="transcriptText"
                      :is-chat="transcriptIsChat"
                    />

                    <!-- Reviewer comments saved on this record -->
                    <div v-if="comments.length" class="csat-comments">
                      <div class="csat-block-title">Reviewer comments</div>
                      <div v-for="(c, i) in comments" :key="i" class="csat-comment-item">
                        <div class="csat-comment-meta"><strong>{{ c.user || "reviewer" }}</strong> · {{ fmtDate(c.at) }}</div>
                        <div class="csat-comment-body">{{ c.comment }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div v-else class="muted">No detail.</div>
              </td>
            </tr>
          </template>
          <tr v-if="!visibleRows.length">
            <td colspan="15" class="muted" style="text-align: center; padding: 20px">
              <template v-if="fId && rows.length">
                No loaded record matches “{{ fId }}”. The search covers the {{ rows.length }} row{{ rows.length === 1 ? "" : "s" }}
                in the current date range and filters — try “All time” or clearing the filters above.
              </template>
              <template v-else>No CSAT records for these filters.</template>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>

    <InteractionDetailDrawer v-if="drawerRecordingId" :recording-id="drawerRecordingId" @close="drawerRecordingId = null" />

    <!-- KPI drill-down: records behind a decision/review tile, with CSV export -->
    <Teleport to="body">
      <div v-if="kpiModalOpen" class="csat-modal-backdrop" @click="kpiModalOpen = false" />
      <div v-if="kpiModalOpen" class="csat-modal csat-modal--wide">
        <div class="csat-modal-head">
          <div class="csat-modal-title">{{ kpiModalTitle }} · {{ kpiModalRows.length }} record{{ kpiModalRows.length === 1 ? "" : "s" }}</div>
          <div style="display: flex; gap: 8px; align-items: center">
            <label v-if="kpiIsRaiseList" class="mark-opt" title="Stamps every record in this export as sent to the client">
              <input v-model="kpiMarkRaised" type="checkbox" />
              Mark as sent to client
            </label>
            <button class="btn btn--sm" :disabled="!kpiModalRows.length || kpiExporting" @click="exportKpiCsv">
              {{ kpiExporting ? "Exporting…" : "Export CSV" }}
            </button>
            <button class="drawer-close-x" @click="kpiModalOpen = false">&times;</button>
          </div>
        </div>
        <div class="csat-modal-body" style="max-height: 62vh; overflow: auto">
          <div v-if="kpiExportMsg" class="run-msg" style="margin-bottom: 8px">{{ kpiExportMsg }}</div>
          <div v-if="kpiModalLoading" class="muted">Loading…</div>
          <div v-else-if="!kpiModalRows.length" class="muted">No records.</div>
          <table v-else class="tbl">
            <thead>
              <tr><th>Interaction</th><th>Agent</th><th>Campaign</th><th>Score</th><th>Decision</th><th>Raise with client</th><th>Sent</th><th>Client</th><th>Date</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in kpiModalRows" :key="r.id">
                <td>{{ r.interactionId || r.interactionTpsId }}</td>
                <td>{{ r.agent || "—" }}</td>
                <td>{{ r.campaign || "—" }}</td>
                <td>{{ r.score ?? "—" }}<span v-if="r.scoreMax">/{{ r.scoreMax }}</span></td>
                <td><span :class="decisionChip(r.decision)" style="font-size: 10px">{{ decisionLabel(r.decision) }}</span></td>
                <td>
                  <span v-if="r.reviewOutcome === 'raise_with_client'" class="chip chip--warning" style="font-size: 10px">Yes</span>
                  <span v-else-if="r.reviewOutcome === 'do_not_raise'" class="chip chip--secondary" style="font-size: 10px">No</span>
                  <span v-else class="muted">—</span>
                </td>
                <td>
                  <span v-if="r.raisedAt" class="chip chip--info" style="font-size: 10px" :title="fmtDate(r.raisedAt)">Sent</span>
                  <span v-else class="muted">—</span>
                </td>
                <td>
                  <span v-if="r.clientOutcome" :class="clientOutcomeChip(r.clientOutcome)" style="font-size: 10px" :title="r.clientResponseComment || ''">{{ clientOutcomeLabel(r.clientOutcome) }}</span>
                  <span v-else-if="r.raisedAt" class="muted">awaiting</span>
                  <span v-else class="muted">—</span>
                </td>
                <td class="muted">{{ fmtDate(r.interactionDateTime || r.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </Teleport>

    <!-- Client response modal — outcome is already chosen; the comment explains
         the client's reasoning and is required. -->
    <Teleport to="body">
      <div v-if="clientModalOpen" class="csat-modal-backdrop" @click="clientModalOpen = false" />
      <div v-if="clientModalOpen" class="csat-modal">
        <div class="csat-modal-head">
          <div class="csat-modal-title">
            Client {{ clientModalOutcome === "accepted" ? "accepted" : "rejected" }} ·
            {{ clientModalIds.length }} record{{ clientModalIds.length === 1 ? "" : "s" }}
          </div>
          <button class="drawer-close-x" @click="clientModalOpen = false">&times;</button>
        </div>
        <div class="csat-modal-body">
          <div
            class="client-note"
            :class="clientModalOutcome === 'accepted' ? 'client-note--good' : 'client-note--bad'"
          >
            {{ clientModalOutcome === "accepted"
              ? "The client accepts the contest — these CSATs no longer stand as fails."
              : "The client rejects the contest — these CSATs stand as fails." }}
          </div>
          <textarea
            v-model="clientModalComment"
            class="csat-modal-text"
            rows="4"
            placeholder="Why did the client decide this? (required)"
          />
          <div v-if="clientModalError" class="detail-error">{{ clientModalError }}</div>
          <div class="hint" style="margin-top: 6px">
            Saved against
            {{ clientModalIds.length === 1 ? "this record" : "all " + clientModalIds.length + " records" }}
            with your name and the current date.
          </div>
        </div>
        <div class="csat-modal-foot">
          <button class="btn btn--ghost btn--sm" @click="clientModalOpen = false">Cancel</button>
          <button
            class="btn btn--primary btn--sm"
            :disabled="clientModalSaving || !clientModalComment.trim()"
            @click="saveClientResponse"
          >{{ clientModalSaving ? "Saving…" : "Save response" }}</button>
        </div>
      </div>
    </Teleport>

    <!-- Add-comment modal -->
    <Teleport to="body">
      <div v-if="commentModalOpen" class="csat-modal-backdrop" @click="closeCommentModal" />
      <div v-if="commentModalOpen" class="csat-modal">
        <div class="csat-modal-head">
          <div class="csat-modal-title">Add comment</div>
          <button class="drawer-close-x" @click="closeCommentModal">&times;</button>
        </div>
        <div class="csat-modal-body">
          <textarea
            v-model="commentDraft"
            class="csat-modal-text"
            rows="4"
            placeholder="Add a note on this CSAT record / transcript…"
            @keydown.enter.exact.prevent="saveComment"
          />
          <div v-if="commentError" class="detail-error">{{ commentError }}</div>
          <div class="hint" style="margin-top: 6px">
            Saved against this record with your name and the current date.
          </div>
        </div>
        <div class="csat-modal-foot">
          <button class="btn btn--ghost btn--sm" @click="closeCommentModal">Cancel</button>
          <button class="btn btn--primary btn--sm" :disabled="commentSaving || !commentDraft.trim()" @click="saveComment">
            {{ commentSaving ? "Saving…" : "Save comment" }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page { box-sizing: border-box; padding: 16px 20px; }
.hero { margin-bottom: 16px; }
.hero-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.hero-title { font-size: 22px; font-weight: 800; margin: 0; color: var(--ink); }
.hero-subtitle { font-size: 13px; color: var(--muted); margin-top: 4px; max-width: 720px; line-height: 1.5; }
.error-banner { background: color-mix(in srgb, #dc2626 12%, transparent); border: 1px solid color-mix(in srgb, #dc2626 40%, transparent); color: #b91c1c; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; }

.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; margin-bottom: 16px; }
.metric { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px 14px; }
.metric-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
.metric-value { font-size: 24px; font-weight: 800; color: var(--ink); margin-top: 2px; }
.metric--good .metric-value { color: #059669; }
.metric--bad .metric-value { color: #dc2626; }
.metric--warn .metric-value { color: #d97706; }

.controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
.control-group { display: flex; flex-direction: column; gap: 4px; }
.control-group label { font-size: 11px; color: var(--muted); font-weight: 600; }
.control-group > div, .control-group.row { display: flex; align-items: center; gap: 8px; }
.control-group { flex-direction: row; align-items: center; }
.num-input { width: 70px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.sel { padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); }
.txt-input { width: 260px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); font: inherit; font-size: 12px; }
.txt-input::placeholder { color: var(--muted); }
.run-msg { font-size: 12px; color: var(--muted); }

.tile { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; margin-bottom: 16px; }
.tile-title { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 10px; }

/* ── KPI rows ──────────────────────────────────────────────────────────────
   Plain .stat tiles keep the shared dashboard look; grouped counts go in a
   .split-stat, which is one card divided into clickable cells. Each cell owns
   its tone, and the OUTER cells paint the card's edge stripe — so an opposing
   pair reads as green on the left, red on the right, and a three-way group
   colours whichever ends it has. Cells are <button> so they're keyboard
   reachable, hence the font/colour resets. */
.kpi-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding-right: 8px;
}
.kpi-row > .stat { flex: 1 1 150px; }
.kpi-row > .split-stat { flex: 2 1 320px; }

.split-stat {
  display: flex;
  overflow: hidden;
  border-radius: 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 4px 14px -8px rgba(0, 0, 0, 0.25);
}
.split-cell {
  --cell-accent: #64748b;
  flex: 1 1 0;
  min-width: 0;
  padding: 16px 18px;
  background: color-mix(in srgb, var(--cell-accent) 5%, transparent);
  border: none;
  border-radius: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
/* Titled variant — a header band names the workflow stage, cells sit beneath it
   in their own row so first/last-child edge stripes still land on the ends. */
.split-stat--titled { flex-direction: column; }
.split-head {
  padding: 8px 14px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  background: color-mix(in srgb, var(--ink) 3%, transparent);
  border-bottom: 1px solid var(--border);
}
.split-row { display: flex; flex: 1 1 auto; min-width: 0; }

.split-cell + .split-cell { border-left: 1px solid var(--border); }
/* Edge stripe via inset shadow — a real border would fight the card's radius. */
.split-cell:first-child { box-shadow: inset 4px 0 0 0 var(--cell-accent); }
.split-cell:last-child { box-shadow: inset -4px 0 0 0 var(--cell-accent); }
.split-cell:hover { background: color-mix(in srgb, var(--cell-accent) 14%, transparent); }
.split-cell:focus-visible { outline: 2px solid var(--cell-accent); outline-offset: -3px; }

.split-cell--good { --cell-accent: #059669; }
.split-cell--bad { --cell-accent: #dc2626; }
.split-cell--warn { --cell-accent: #d97706; }
.split-cell--info { --cell-accent: #2b6cb0; }
.split-cell--neutral { --cell-accent: #64748b; }

.split-spark { margin: 10px 0 2px; }
.split-note { font-size: 11px; color: var(--muted); }

/* Date range bar */
.range-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap; margin-bottom: 14px;
  padding: 10px 12px; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.range-presets { display: flex; gap: 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; flex-wrap: wrap; }
.range-btn {
  background: transparent; border: none; padding: 5px 11px;
  font-size: 12px; font-weight: 600; color: var(--muted); cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.range-btn:not(:last-child) { border-right: 1px solid var(--border); }
.range-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--brand, #6366f1) 8%, transparent); }
.range-btn--active { background: var(--brand, #6366f1); color: #fff; }
.range-btn--active:hover:not(:disabled) { background: var(--brand, #6366f1); }
.range-btn:disabled { opacity: 0.6; cursor: default; }
.range-dates { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.range-label { font-size: 11px; color: var(--muted); font-weight: 600; }
.date-input {
  padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); color: var(--ink); font-size: 12px; font-family: inherit;
}

/* Bulk action bar (shown once rows are checked) */
.bulk-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-bottom: 12px; padding: 10px 12px; border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--brand, #6366f1) 7%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand, #6366f1) 25%, transparent);
}
.bulk-count { font-size: 12px; font-weight: 700; color: var(--ink); }
.bulk-sep { width: 1px; align-self: stretch; background: var(--border); margin: 0 2px; }
.btn--good { border-color: color-mix(in srgb, #059669 45%, transparent); color: #047857; }
.btn--good:hover:not(:disabled) { background: color-mix(in srgb, #059669 10%, transparent); }
.btn--bad { border-color: color-mix(in srgb, #dc2626 45%, transparent); color: #b91c1c; }
.btn--bad:hover:not(:disabled) { background: color-mix(in srgb, #dc2626 10%, transparent); }

/* Client verdict block in the expanded record */
.client-verdict {
  margin-bottom: 14px; padding: 10px 12px; border-radius: 8px;
  border: 1px solid var(--border); border-left-width: 4px;
}
.client-verdict--accepted { border-left-color: #059669; background: color-mix(in srgb, #059669 7%, transparent); }
.client-verdict--rejected { border-left-color: #dc2626; background: color-mix(in srgb, #dc2626 7%, transparent); }
.client-verdict-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.client-verdict-text { font-size: 12px; line-height: 1.55; color: var(--ink); white-space: pre-wrap; }

/* Client response modal banner */
.client-note {
  font-size: 12px; line-height: 1.5; padding: 9px 11px; border-radius: 8px;
  margin-bottom: 10px; border: 1px solid var(--border);
}
.client-note--good { color: #047857; background: color-mix(in srgb, #059669 10%, transparent); border-color: color-mix(in srgb, #059669 35%, transparent); }
.client-note--bad { color: #b91c1c; background: color-mix(in srgb, #dc2626 10%, transparent); border-color: color-mix(in srgb, #dc2626 35%, transparent); }

/* "Mark as sent" checkbox in the export header */
.mark-opt { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); cursor: pointer; white-space: nowrap; }

.sel-cell { width: 26px; }
.sel-cell input { cursor: pointer; }

.tbl-scroll { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; color: var(--muted); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border); font-size: 11px; }
.tbl td { padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--ink); }
.row { cursor: pointer; }
.row:hover { background: color-mix(in srgb, var(--brand, #6366f1) 6%, transparent); }
.row--open { background: color-mix(in srgb, var(--brand, #6366f1) 8%, transparent); }
.expander { color: var(--muted); width: 20px; }
.muted { color: var(--muted); }
.good { color: #059669; font-weight: 600; }
.bad { color: #dc2626; font-weight: 600; }

.detail-row td { background: color-mix(in srgb, var(--ink) 3%, transparent); padding: 0; }
.csat-detail { padding: 14px 16px; }

/* Supervisor action toolbar under the verdict banner (kept apart from the
   banner's info chips so buttons and chips don't visually merge). */
.csat-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
.csat-actions-sep { flex: 1 1 auto; }

/* Deselectable segmented toggle for the supervisor review (accept / disagree).
   Clicking the active option again clears it. */
.csat-toggle {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.csat-toggle-btn {
  background: transparent;
  border: none;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.csat-toggle-btn:not(:last-child) { border-right: 1px solid var(--border); }
.csat-toggle-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--brand, #6366f1) 8%, transparent); }
.csat-toggle-btn--active { background: var(--brand, #6366f1); color: #fff; }
.csat-toggle-btn--active:hover:not(:disabled) { background: var(--brand, #6366f1); }
.csat-toggle-btn:disabled { opacity: 0.6; cursor: default; }

/* Side-by-side: assessment on the left half, transcript on the right half */
.csat-detail--split { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.csat-detail--split .csat-assessment { flex: 1 1 50%; min-width: 0; }

/* ── records header with export ───────────────────────────────────────────── */
.records-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}

/* ── disagreement marker ──────────────────────────────────────────────────────
   Shown only where a supervisor overruled the model, so it reads as an exception
   rather than yet another status chip on every row. */
.disagree-cell { white-space: nowrap; }
.disagree-flag {
  display: inline-block;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 999px;
  color: #fff;
  background: var(--danger, #e11d48);
}

/* ── collapsible section header ───────────────────────────────────────────── */
.collapse-head {
  display: flex; align-items: center; gap: 8px;
  width: 100%; background: none; border: none; padding: 0 0 6px;
  cursor: pointer; text-align: left; color: inherit;
}
.collapse-caret { font-size: 11px; color: var(--muted); transition: transform 0.15s; }
.collapse-caret--open { transform: rotate(90deg); }

/* ── background assessment progress ───────────────────────────────────────── */
.assess-progress { display: flex; align-items: center; gap: 10px; flex: 1 1 100%; margin-top: 6px; }
.assess-bar {
  flex: 1; height: 8px; max-width: 320px;
  background: var(--surface-soft, #eef2f7); border-radius: 999px; overflow: hidden;
}
.assess-bar-fill { height: 100%; background: var(--brand, #2b6cb0); transition: width 0.3s; }

/* ── the decision bar ─────────────────────────────────────────────────────────
   Deliberately the loudest thing in the expanded record: getting a decision is
   the entire purpose of this page. flex-basis:100% forces it onto its own full
   row even when the transcript pane makes the parent a two-column flex layout,
   so it never moves or narrows depending on whether the transcript is open. */
.csat-decision-bar {
  flex: 1 1 100%;
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; flex-wrap: wrap;
  margin: 12px 0 4px; padding: 12px 16px;
  border: 2px solid var(--brand, #2b6cb0);
  border-radius: var(--radius-lg, 10px);
  background: rgba(43, 108, 176, 0.06);
}
/* Decided: step the emphasis down so attention moves to the next record. */
.csat-decision-bar--done {
  border-color: var(--border);
  background: var(--surface-soft, #f8fafc);
}
.csat-decision-ask { font-size: 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.csat-decision-actions { display: flex; gap: 10px; }
.csat-decision-btn {
  padding: 10px 20px; font-size: 14px; font-weight: 700;
  border-radius: var(--radius-lg, 8px); border: 2px solid var(--border);
  background: #fff; color: var(--ink); cursor: pointer; transition: all 0.12s;
}
.csat-decision-btn:hover:not(:disabled) { transform: translateY(-1px); }
.csat-decision-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.csat-decision-btn--accept:hover:not(:disabled) { border-color: var(--success, #059669); }
.csat-decision-btn--disagree:hover:not(:disabled) { border-color: var(--danger, #e11d48); }
.csat-decision-btn--accept.csat-decision-btn--active {
  background: var(--success, #059669); border-color: var(--success, #059669); color: #fff;
}
.csat-decision-btn--disagree.csat-decision-btn--active {
  background: var(--danger, #e11d48); border-color: var(--danger, #e11d48); color: #fff;
}
.csat-transcript-pane {
  flex: 1 1 50%;
  min-width: 0;
  border-left: 1px solid var(--border);
  padding-left: 16px;
}
.csat-transcript-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.csat-transcript-actions { display: flex; gap: 6px; flex-shrink: 0; }
.csat-transcript-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink);
  max-height: 60vh;
  overflow-y: auto;
  background: var(--surface-soft, #f8fafc);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}

/* Reviewer comments list */
.csat-comments { margin-top: 14px; }
.csat-comment-item {
  padding: 8px 10px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--brand, #6366f1) 5%, transparent);
  border: 1px solid color-mix(in srgb, var(--brand, #6366f1) 15%, transparent);
}
.csat-comment-meta { font-size: 11px; color: var(--muted); margin-bottom: 3px; }
.csat-comment-body { font-size: 13px; color: var(--ink); line-height: 1.45; white-space: pre-wrap; }

/* Add-comment modal */
.csat-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 1100;
}
.csat-modal {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(480px, 92vw);
  background: var(--surface, #fff);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.25);
  z-index: 1101;
  display: flex;
  flex-direction: column;
}
.csat-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.csat-modal--wide { width: min(860px, 94vw); }
.csat-modal-title { font-size: 14px; font-weight: 800; color: var(--ink); }
.drawer-close-x {
  background: none;
  border: none;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  color: var(--muted);
}
.csat-modal-body { padding: 16px 18px; }
.csat-modal-text {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--ink);
  background: var(--surface, #fff);
}
.csat-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
}

/* Verdict banner */
.verdict {
  display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  padding: 12px 16px; border-radius: 10px; border: 1px solid var(--border);
  border-left-width: 5px; margin-bottom: 12px;
}
.verdict--contest { border-left-color: #059669; background: color-mix(in srgb, #059669 8%, transparent); }
.verdict--do_not_contest { border-left-color: #dc2626; background: color-mix(in srgb, #dc2626 8%, transparent); }
.verdict--unclear { border-left-color: #d97706; background: color-mix(in srgb, #d97706 8%, transparent); }
.verdict--unknown { border-left-color: var(--border); }
.verdict-main { display: flex; align-items: center; gap: 16px; }
.verdict-label { font-size: 18px; font-weight: 800; color: var(--ink); }
.verdict--contest .verdict-label { color: #059669; }
.verdict--do_not_contest .verdict-label { color: #dc2626; }
.verdict--unclear .verdict-label { color: #b45309; }
.verdict-conf { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); }
.conf-bar { width: 80px; height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--ink) 12%, transparent); overflow: hidden; }
.conf-fill { height: 100%; background: var(--brand, #6366f1); border-radius: 3px; }
.verdict-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.vbadge {
  font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 999px; white-space: nowrap;
  text-transform: uppercase; letter-spacing: 0.03em;
}
.vbadge--good { color: #047857; background: color-mix(in srgb, #059669 16%, transparent); }
.vbadge--bad { color: #b91c1c; background: color-mix(in srgb, #dc2626 16%, transparent); }
.vbadge--neutral { color: var(--muted); background: color-mix(in srgb, var(--ink) 8%, transparent); }

.csat-headline { font-weight: 700; font-size: 13px; color: var(--ink); margin: 0 0 6px; }
.csat-rationale {
  font-size: 12px; line-height: 1.6; color: var(--ink); margin: 0 0 14px;
  padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
}

/* Factor grid */
.factor-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px; margin-bottom: 14px;
}
.factor-cell {
  padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 3px;
}
.factor-cell--good { border-color: color-mix(in srgb, #059669 45%, transparent); background: color-mix(in srgb, #059669 7%, transparent); }
.factor-cell--bad { border-color: color-mix(in srgb, #dc2626 45%, transparent); background: color-mix(in srgb, #dc2626 7%, transparent); }
.factor-cell--neutral { background: color-mix(in srgb, var(--ink) 3%, transparent); }
.factor-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--muted); }
.factor-value { font-size: 13px; font-weight: 700; color: var(--ink); }
.factor-cell--good .factor-value { color: #047857; }
.factor-cell--bad .factor-value { color: #b91c1c; }

.csat-block { margin-bottom: 14px; }
.csat-block-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 6px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 5px; }
.evidence {
  margin: 0 0 6px; padding: 6px 12px; font-size: 12px; font-style: italic; color: var(--ink);
  border-left: 3px solid color-mix(in srgb, var(--brand, #6366f1) 50%, transparent);
  background: color-mix(in srgb, var(--brand, #6366f1) 5%, transparent); border-radius: 0 6px 6px 0; line-height: 1.5;
}
.csat-comment {
  display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
  padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, #d97706 8%, transparent);
  border: 1px solid color-mix(in srgb, #d97706 30%, transparent);
}
.csat-comment-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #b45309; font-weight: 700; }
.csat-comment-text { font-size: 12px; color: var(--ink); font-style: italic; flex: 1; }
.csat-comment-score { font-size: 13px; font-weight: 800; color: #b45309; }
.detail-error { font-size: 11px; color: #dc2626; margin-top: 6px; }
</style>
