<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { ApiPath } from "@/enums/api";
import InteractionDetailDrawer from "./InteractionDetailDrawer.vue";
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

// Batch
const batchLimit = ref(25);
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
    board.value = (await axios.get(ApiPath.CsatBoard)).data;
  } catch {
    board.value = null;
  }
}

async function loadList() {
  const params: Record<string, string> = {};
  if (fStatus.value) params.status = fStatus.value;
  if (fDecision.value) params.decision = fDecision.value;
  if (fCampaign.value) params.campaign = fCampaign.value;
  rows.value = (await axios.get(ApiPath.CsatList, { params })).data ?? [];
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

async function runBatch() {
  running.value = true;
  runMsg.value = "";
  try {
    const res = await axios.post(ApiPath.CsatRunBatch, { limit: batchLimit.value });
    const d = res.data;
    runMsg.value = `Processed ${d.processed}: ${d.assessed} assessed, ${d.awaiting_transcript} awaiting transcript, ${d.errored} errored.`;
    await loadAll();
  } catch (e: any) {
    runMsg.value = e?.response?.data?.message || e?.message || "Batch failed";
  } finally {
    running.value = false;
  }
}

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

    <!-- Metric tiles -->
    <div v-if="board" class="stats" style="margin-bottom: 14px; padding-right: 8px">
      <div class="stat stat--analytics"><div class="stat-label">Total CSATs</div><div class="stat-value">{{ board.total }}</div></div>
      <div class="stat stat--success"><div class="stat-label">Assessed</div><div class="stat-value">{{ board.assessed }}</div></div>
      <div class="stat stat--warning"><div class="stat-label">Pending</div><div class="stat-value">{{ board.pending }}</div></div>
      <div class="stat" :class="board.unmatched > 0 ? 'stat--warning' : 'stat--neutral'"><div class="stat-label">Unmatched</div><div class="stat-value">{{ board.unmatched }}</div></div>
      <div class="stat stat--neutral"><div class="stat-label" title="Scores of 4-5 are not assessed">Excluded (4-5)</div><div class="stat-value">{{ board.excluded ?? 0 }}</div></div>
      <div class="stat" :class="board.errors > 0 ? 'stat--risk' : 'stat--neutral'"><div class="stat-label">Errors</div><div class="stat-value">{{ board.errors }}</div></div>
    </div>

    <!-- Decision outcomes with monthly trend -->
    <div v-if="board" class="stats" style="margin-bottom: 14px; padding-right: 8px">
      <div class="stat stat--success">
        <div class="stat-label">Contest</div>
        <div class="stat-value">{{ contestCount }}</div>
        <div v-if="contestPoints.length > 1" style="margin: 10px 0 2px"><Sparkline :points="contestPoints" color="#059669" :width="150" :height="30" /></div>
        <div v-if="contestPoints.length > 1" class="muted" style="font-size: 11px">monthly trend</div>
      </div>
      <div class="stat stat--risk">
        <div class="stat-label">Do Not Contest</div>
        <div class="stat-value">{{ doNotContestCount }}</div>
        <div v-if="doNotContestPoints.length > 1" style="margin: 10px 0 2px"><Sparkline :points="doNotContestPoints" color="#dc2626" :width="150" :height="30" /></div>
        <div v-if="doNotContestPoints.length > 1" class="muted" style="font-size: 11px">monthly trend</div>
      </div>
    </div>

    <!-- Controls -->
    <div class="controls">
      <div class="control-group">
        <label>Run assessment on next</label>
        <input v-model.number="batchLimit" type="number" min="1" max="500" class="num-input" />
        <button class="btn btn--primary btn--sm" :disabled="running" @click="runBatch">
          {{ running ? "Assessing…" : "Assess pending" }}
        </button>
      </div>
      <button class="btn btn--sm" :disabled="rematching" @click="rematch">
        {{ rematching ? "Rematching…" : "Rematch unmatched" }}
      </button>
      <span v-if="runMsg" class="run-msg">{{ runMsg }}</span>
    </div>

    <!-- By campaign -->
    <div v-if="board?.byCampaign?.length" class="tile">
      <div class="tile-title">By Campaign</div>
      <table class="tbl">
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
          <option value="excluded">Excluded (4-5)</option>
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
    </div>

    <!-- List -->
    <div class="tile">
      <div class="tile-title">CSAT Records <span class="chip chip--secondary" style="font-size: 10px">{{ rows.length }}</span></div>
      <div class="tbl-scroll">
      <table class="tbl">
        <thead>
          <tr>
            <th></th><th>Interaction</th><th>Agent</th><th>Campaign</th><th>Score</th>
            <th>Status</th><th>Decision</th><th>Conf.</th><th>Date</th><th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="r in rows" :key="r.id">
            <tr class="row" :class="{ 'row--open': expandedId === r.id }" @click="toggleRow(r.id)">
              <td class="expander">{{ expandedId === r.id ? "▾" : "▸" }}</td>
              <td>{{ r.interactionId || r.interactionTpsId }}</td>
              <td>{{ r.agent || "—" }}</td>
              <td>{{ r.campaign || "—" }}</td>
              <td>{{ r.score ?? "—" }}<span v-if="r.scoreMax">/{{ r.scoreMax }}</span></td>
              <td><span :class="statusChip(r.status)" style="font-size: 10px">{{ r.status }}</span></td>
              <td><span :class="decisionChip(r.decision)" style="font-size: 10px">{{ decisionLabel(r.decision) }}</span></td>
              <td>{{ fmtPct(r.confidence) }}</td>
              <td class="muted">{{ fmtDate(r.interactionDateTime || r.createdAt) }}</td>
              <td @click.stop>
                <button v-if="r.status === 'pending' || r.status === 'awaiting_transcript' || r.status === 'error'" class="btn btn--sm" @click="assessRow(r.id)">Assess</button>
                <button v-else-if="r.status === 'assessed'" class="btn btn--sm" @click="requeueRow(r.id)">Re-assess</button>
              </td>
            </tr>
            <tr v-if="expandedId === r.id" class="detail-row">
              <td colspan="10">
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
                      <button v-if="detail.recordingId" class="btn btn--sm" @click="drawerRecordingId = detail.recordingId">Open interaction</button>
                      <button v-if="detail.recordingId" class="btn btn--sm" @click.stop="toggleTranscript">{{ transcriptOpen ? "Hide transcript/comments" : "View transcript/comments" }}</button>
                    </div>
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
                    <pre v-else class="csat-transcript-text">{{ transcriptText }}</pre>

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
          <tr v-if="!rows.length"><td colspan="10" class="muted" style="text-align: center; padding: 20px">No CSAT records for these filters.</td></tr>
        </tbody>
      </table>
      </div>
    </div>

    <InteractionDetailDrawer v-if="drawerRecordingId" :recording-id="drawerRecordingId" @close="drawerRecordingId = null" />

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
.run-msg { font-size: 12px; color: var(--muted); }

.tile { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; margin-bottom: 16px; }
.tile-title { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 10px; }

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

/* Side-by-side: assessment on the left half, transcript on the right half */
.csat-detail--split { display: flex; gap: 16px; align-items: flex-start; }
.csat-detail--split .csat-assessment { flex: 1 1 50%; min-width: 0; }
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
