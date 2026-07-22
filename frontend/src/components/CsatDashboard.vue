<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { ApiPath } from "@/enums/api";
import InteractionDetailDrawer from "./InteractionDetailDrawer.vue";

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

async function toggleRow(id: string) {
  if (expandedId.value === id) {
    expandedId.value = null;
    detail.value = null;
    return;
  }
  expandedId.value = id;
  detail.value = null;
  loadingDetail.value = true;
  try {
    detail.value = (await axios.get(`${ApiPath.CsatItem}/${id}`)).data;
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
  const s = String(ru).trim();
  return /^\d+$/.test(s) ? `Rule ${s}` : s;
}

const contestCount = computed(
  () => (board.value?.decisions ?? []).find((d: any) => d.decision === "contest")?.count ?? 0,
);
const doNotContestCount = computed(
  () => (board.value?.decisions ?? []).find((d: any) => d.decision === "do_not_contest")?.count ?? 0,
);

onMounted(loadAll);
</script>

<template>
  <div class="page">
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <h1 class="hero-title">CSAT Contest Assessment</h1>
          <div class="hero-subtitle">
            Reviews CSAT survey scores against the campaign contest framework — separate from the
            standard transcribe/insights pipeline. Assesses whether the final agent fairly earned each score.
          </div>
        </div>
        <button class="btn btn--ghost" :disabled="loading" @click="loadAll">Refresh</button>
      </div>
    </div>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Metric tiles -->
    <div v-if="board" class="metric-grid">
      <div class="metric"><div class="metric-label">Total CSATs</div><div class="metric-value">{{ board.total }}</div></div>
      <div class="metric"><div class="metric-label">Assessed</div><div class="metric-value">{{ board.assessed }}</div></div>
      <div class="metric"><div class="metric-label">Pending</div><div class="metric-value">{{ board.pending }}</div></div>
      <div class="metric metric--good"><div class="metric-label">Contest</div><div class="metric-value">{{ contestCount }}</div></div>
      <div class="metric metric--bad"><div class="metric-label">Do Not Contest</div><div class="metric-value">{{ doNotContestCount }}</div></div>
      <div class="metric" :class="{ 'metric--warn': board.unmatched > 0 }"><div class="metric-label">Unmatched</div><div class="metric-value">{{ board.unmatched }}</div></div>
      <div class="metric" :class="{ 'metric--bad': board.errors > 0 }"><div class="metric-label">Errors</div><div class="metric-value">{{ board.errors }}</div></div>
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
                <div v-else-if="detail" class="detail">
                  <div class="detail-head">
                    <span :class="decisionChip(detail.decision)">{{ decisionLabel(detail.decision) }}</span>
                    <span class="muted">confidence {{ fmtPct(detail.confidence) }}</span>
                    <span v-if="detail.dissatisfaction_source" class="chip chip--secondary" style="font-size: 10px">source: {{ detail.dissatisfaction_source }}</span>
                    <span v-if="detail.parsed?.knowledge_verified === true" class="chip chip--success" style="font-size: 10px">knowledge verified</span>
                    <span v-else-if="detail.parsed?.knowledge_verified === false" class="chip chip--danger" style="font-size: 10px">knowledge incorrect</span>
                    <span v-if="detail.agent_materially_contributed === true" class="chip chip--danger" style="font-size: 10px">agent contributed</span>
                    <span v-else-if="detail.agent_materially_contributed === false" class="chip chip--success" style="font-size: 10px">agent not at fault</span>
                    <span v-if="detail.recordingId" style="margin-left: auto">
                      <button class="btn btn--sm" @click="drawerRecordingId = detail.recordingId">Open interaction</button>
                    </span>
                  </div>
                  <p v-if="detail.parsed?.headline" class="detail-headline">{{ detail.parsed.headline }}</p>
                  <p v-if="detail.rationale" class="detail-rationale">{{ detail.rationale }}</p>
                  <div v-if="detail.parsed?.factors" class="detail-factors">
                    <span v-for="(v, k) in detail.parsed.factors" :key="k" class="factor">
                      <strong>{{ String(k).replace(/_/g, " ") }}:</strong> {{ v }}
                    </span>
                  </div>
                  <div v-if="detail.parsed?.rules_triggered?.length" class="detail-rules">
                    <span class="muted">Rules:</span>
                    <span v-for="(ru, i) in detail.parsed.rules_triggered" :key="i" class="chip chip--info" style="font-size: 10px">{{ ruleLabel(ru) }}</span>
                  </div>
                  <div v-if="detail.parsed?.evidence_quotes?.length" class="detail-quotes">
                    <div v-for="(q, i) in detail.parsed.evidence_quotes" :key="i" class="quote">"{{ q }}"</div>
                  </div>
                  <p v-if="detail.comment" class="detail-comment"><span class="muted">Customer comment:</span> {{ detail.comment }}</p>
                  <p v-if="detail.lastError" class="detail-error">{{ detail.lastError }}</p>
                </div>
                <div v-else class="muted">No detail.</div>
              </td>
            </tr>
          </template>
          <tr v-if="!rows.length"><td colspan="10" class="muted" style="text-align: center; padding: 20px">No CSAT records for these filters.</td></tr>
        </tbody>
      </table>
    </div>

    <InteractionDetailDrawer v-if="drawerRecordingId" :recording-id="drawerRecordingId" @close="drawerRecordingId = null" />
  </div>
</template>

<style scoped>
.page { padding: 16px 20px; }
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

.controls { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
.control-group { display: flex; flex-direction: column; gap: 4px; }
.control-group label { font-size: 11px; color: var(--muted); font-weight: 600; }
.control-group > div, .control-group.row { display: flex; align-items: center; gap: 8px; }
.control-group { flex-direction: row; align-items: center; }
.num-input { width: 70px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.sel { padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); color: var(--ink); }
.run-msg { font-size: 12px; color: var(--muted); }

.tile { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 14px 16px; margin-bottom: 16px; }
.tile-title { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 10px; }

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

.detail-row td { background: color-mix(in srgb, var(--ink) 3%, transparent); }
.detail { padding: 8px 4px; }
.detail-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.detail-headline { font-weight: 700; color: var(--ink); margin: 0 0 6px; }
.detail-rationale { font-size: 12px; line-height: 1.55; color: var(--ink); margin: 0 0 8px; }
.detail-factors { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; color: var(--muted); margin-bottom: 8px; }
.detail-factors strong { color: var(--ink); font-weight: 600; }
.detail-rules { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin-bottom: 8px; }
.detail-quotes { margin-bottom: 8px; }
.quote { font-size: 11px; font-style: italic; color: var(--muted); line-height: 1.5; }
.detail-comment { font-size: 12px; color: var(--ink); margin: 6px 0 0; }
.detail-error { font-size: 11px; color: #dc2626; margin-top: 6px; }
</style>
