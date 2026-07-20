<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { ApiPath, InsightsProvider } from "@/enums/api";
import { RecordingPath } from "@/enums/recording-paths";
import InsightsUsagePanel from "./InsightsUsagePanel.vue";

type SectionKey = "summary" | "actions" | "lastRun" | "history";
type BatchJobType = "transcribe" | "insights_calls" | "insights_chats";
type BatchJobStatus = "running" | "completed" | "failed";

interface JobError {
  id: string;
  error: string;
}

interface LiveJob {
  id: string;
  type: BatchJobType;
  status: BatchJobStatus;
  progress: number;
  total: number;
  errorCount: number;
  provider: string | null;
  startedAt: string;
  completedAt: string | null;
  errors: JobError[];
}

const JOBS_KEY = "aii_batch_jobs";

function loadStoredIds(): string[] {
  try { return JSON.parse(localStorage.getItem(JOBS_KEY) || "[]"); }
  catch { return []; }
}
function saveStoredIds(ids: string[]) {
  localStorage.setItem(JOBS_KEY, JSON.stringify(ids));
}
function addStoredId(id: string) {
  saveStoredIds([...new Set([...loadStoredIds(), id])]);
}
function removeStoredId(id: string) {
  saveStoredIds(loadStoredIds().filter((x) => x !== id));
}

const open = ref<Record<SectionKey, boolean>>({
  summary: true,
  actions: true,
  lastRun: false,
  history: false,
});

const toggle = (key: SectionKey) => { open.value[key] = !open.value[key]; };
const isOpen = (key: SectionKey) => open.value[key];

const limit = ref(10);
const insightsProvider = ref<InsightsProvider>(InsightsProvider.OpenAI);

// Optional per-run model override. "" = the provider's server-side default
// (fast/cheap tier). Suggestions are curated per provider; a higher-quality
// model materially improves extraction (quotes, frustrations, competitor recovery).
const insightsModel = ref<string>("");
const MODEL_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  [InsightsProvider.OpenAI]: [
    { value: "", label: "Default — gpt-4o-mini (fast)" },
    { value: "gpt-4o", label: "gpt-4o (higher quality)" },
  ],
  [InsightsProvider.Anthropic]: [
    { value: "", label: "Default — claude-haiku-4-5 (fast)" },
    { value: "claude-sonnet-5", label: "claude-sonnet-5 (higher quality)" },
    { value: "claude-opus-4-8", label: "claude-opus-4-8 (highest quality)" },
  ],
  [InsightsProvider.Grok]: [
    { value: "", label: "Default — grok-4-1-fast" },
  ],
  [InsightsProvider.Gemini]: [
    { value: "", label: "Default — gemini-1.5-flash (fast)" },
    { value: "gemini-1.5-pro", label: "gemini-1.5-pro (higher quality)" },
  ],
};
const modelOptions = computed(
  () => MODEL_OPTIONS[insightsProvider.value] ?? [{ value: "", label: "Default" }]
);
// Reset the model override when the provider changes so we never send one
// provider's model id to another.
watch(insightsProvider, () => {
  insightsModel.value = "";
});

const loadingSummary = ref(false);
const summary = ref<{
  totalRows: number;
  calls: { total: number; byStatus: Record<string, number> };
  chats: { total: number; byStatus: Record<string, number> };
} | null>(null);

const startingTranscribe = ref(false);
const startingInsights = ref(false);
const startingInsightsChats = ref(false);

const activeJobs = ref<LiveJob[]>([]);
let pollTimer: ReturnType<typeof setInterval> | null = null;

const hasRunningJob = (type: BatchJobType) =>
  activeJobs.value.some((j) => j.type === type && j.status === "running");

const transcribeDisabled = computed(
  () => startingTranscribe.value || hasRunningJob("transcribe")
);
const insightsDisabled = computed(
  () => startingInsights.value || hasRunningJob("insights_calls")
);
const insightsChatsDisabled = computed(
  () => startingInsightsChats.value || hasRunningJob("insights_chats")
);

const error = ref("");

const copyState = ref<"idle" | "copied" | "error">("idle");
const copyBtnLabel = computed(() => {
  if (copyState.value === "copied") return "Copied";
  if (copyState.value === "error") return "Copy failed";
  return "Copy result";
});

const lastJobResult = ref("");

async function copyResult() {
  copyState.value = "idle";
  try {
    const text = lastJobResult.value || "";
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      copyState.value = "copied";
      window.setTimeout(() => (copyState.value = "idle"), 1400);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    copyState.value = ok ? "copied" : "error";
    window.setTimeout(() => (copyState.value = "idle"), 1400);
  } catch {
    copyState.value = "error";
    window.setTimeout(() => (copyState.value = "idle"), 1400);
  }
}

async function loadSummary() {
  loadingSummary.value = true;
  error.value = "";
  try {
    const res = await axios.get(RecordingPath.summary);
    summary.value = res.data;
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load summary";
  } finally {
    loadingSummary.value = false;
  }
}

// ── Failed records (dead-letter) + reprocessing ─────────────────────────────
const failedRecords = ref<any[]>([]);
const loadingFailed = ref(false);
const requeuing = ref(false);
const reprocessing = ref(false);
const reprocessCampaign = ref("");
const maintMsg = ref("");

async function loadFailed() {
  loadingFailed.value = true;
  try {
    const res = await axios.get(RecordingPath.list, { params: { status: "error", limit: 100 } });
    failedRecords.value = res.data ?? [];
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load failed records";
  } finally {
    loadingFailed.value = false;
  }
}

async function requeueAllErrors() {
  requeuing.value = true;
  maintMsg.value = "";
  try {
    const res = await axios.post(RecordingPath.batchRequeueErrors);
    const d = res.data ?? {};
    maintMsg.value = `Requeued ${d.requeuedForTranscription ?? 0} for transcription, ${d.requeuedForInsights ?? 0} for insights. Run the batch buttons to process.`;
    await Promise.all([loadFailed(), loadSummary()]);
  } catch (e: any) {
    maintMsg.value = e?.response?.data?.message || e?.message || "Requeue failed";
  } finally {
    requeuing.value = false;
  }
}

async function requeueRecord(id: string) {
  maintMsg.value = "";
  try {
    await axios.post(RecordingPath.requeue(id));
    await Promise.all([loadFailed(), loadSummary()]);
  } catch (e: any) {
    maintMsg.value = e?.response?.data?.message || e?.message || "Requeue failed";
  }
}

async function reprocessInsights() {
  const camp = reprocessCampaign.value.trim();
  const scope = camp ? `campaign "${camp}"` : "ALL completed (insights_done) records";
  if (
    !window.confirm(
      `Reprocess insights for ${scope}?\n\nThis DELETES their existing insight rows and re-queues them as 'transcribed' for a fresh insights run. Survey campaigns then need the survey backfill re-run.`
    )
  )
    return;
  reprocessing.value = true;
  maintMsg.value = "";
  try {
    const res = await axios.post(RecordingPath.batchReprocessInsights, { campaign: camp || undefined });
    maintMsg.value = `${res.data?.reprocessed ?? 0} record(s) reset to 'transcribed' — run "Call insights" to reprocess.`;
    await loadSummary();
  } catch (e: any) {
    maintMsg.value = e?.response?.data?.message || e?.message || "Reprocess failed";
  } finally {
    reprocessing.value = false;
  }
}

async function pollJobs() {
  const ids = loadStoredIds();
  if (!ids.length) {
    activeJobs.value = [];
    return;
  }

  const results: LiveJob[] = [];
  for (const id of ids) {
    try {
      const res = await axios.get(RecordingPath.batchJob(id));
      results.push(res.data as LiveJob);
    } catch {
      removeStoredId(id);
    }
  }

  activeJobs.value = results;

  const justFinished = results.filter((j) => j.status !== "running");
  for (const j of justFinished) {
    removeStoredId(j.id);
    lastJobResult.value = JSON.stringify(
      {
        type: j.type,
        total: j.total,
        progress: j.progress,
        errorCount: j.errorCount,
        status: j.status,
        errors: j.errors ?? [],
      },
      null,
      2
    );
  }
  if (justFinished.length > 0) {
    await loadSummary();
    await loadHistory();
  }

  if (!loadStoredIds().length) {
    stopPolling();
  }
}

function startPolling() {
  if (pollTimer) return;
  void pollJobs();
  pollTimer = setInterval(pollJobs, 3000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function runBatchTranscribe() {
  startingTranscribe.value = true;
  error.value = "";
  try {
    const res = await axios.post(RecordingPath.batchTranscribe, null, {
      params: { limit: limit.value },
    });
    addStoredId(res.data.jobId);
    startPolling();
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Batch transcribe failed";
  } finally {
    startingTranscribe.value = false;
  }
}

async function runBatchInsights() {
  startingInsights.value = true;
  error.value = "";
  try {
    const res = await axios.post(
      RecordingPath.batchInsights,
      { provider: insightsProvider.value, model: insightsModel.value || undefined },
      { params: { limit: limit.value } }
    );
    addStoredId(res.data.jobId);
    startPolling();
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Batch insights failed";
  } finally {
    startingInsights.value = false;
  }
}

async function runBatchInsightsChats() {
  startingInsightsChats.value = true;
  error.value = "";
  try {
    const res = await axios.post(
      RecordingPath.batchInsightsChats,
      { provider: insightsProvider.value, model: insightsModel.value || undefined },
      { params: { limit: limit.value } }
    );
    addStoredId(res.data.jobId);
    startPolling();
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Batch chat insights failed";
  } finally {
    startingInsightsChats.value = false;
  }
}

// ── Chat response-time recompute ────────────────────────────────────────────
// Walks every chat in the supplied date range, parses its transcript and
// rewrites the chat_response_metrics_json + scalar columns. Computed in
// backend code — no LLM involvement.
const startingRecomputeRt = ref(false);
const recomputeRtFrom = ref(defaultFromIso());
const recomputeRtTo = ref(defaultToIso());
const recomputeRtResult = ref<{
  candidates: number;
  processed: number;
  skipped: number;
  errored: number;
  errors: Array<{ recordingId: string; message: string }>;
} | null>(null);

function defaultFromIso() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
function defaultToIso() {
  return new Date().toISOString().slice(0, 10);
}

async function runRecomputeChatResponseTime() {
  startingRecomputeRt.value = true;
  recomputeRtResult.value = null;
  error.value = "";
  try {
    // Backend honours from/to inclusive of the day boundaries.
    const params: Record<string, string> = {
      filterKey: "chats",
      from: recomputeRtFrom.value,
      // Make 'to' exclusive of the next day so the user-typed end-date is
      // included end-to-end.
      to: new Date(
        new Date(recomputeRtTo.value).getTime() + 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10),
    };
    const res = await axios.post(ApiPath.OpsRecomputeChatResponseTime, null, {
      params,
    });
    recomputeRtResult.value = res.data;
  } catch (e: any) {
    error.value =
      e?.response?.data?.message ||
      e?.message ||
      "Recompute chat response time failed";
  } finally {
    startingRecomputeRt.value = false;
  }
}

const totalRows = computed(() => summary.value?.totalRows ?? 0);
const callStatusEntries = computed(() =>
  Object.entries(summary.value?.calls?.byStatus ?? {})
);
const chatStatusEntries = computed(() =>
  Object.entries(summary.value?.chats?.byStatus ?? {})
);

function badgeClass(status: string) {
  if (status === "insights_done") return "chip chip--success";
  if (status === "transcribed") return "chip chip--info";
  if (status === "pending_transcription") return "chip chip--warning";
  if (status === "error") return "chip chip--danger";
  return "chip";
}

function jobTypeLabel(type: BatchJobType) {
  if (type === "transcribe") return "Transcribe";
  if (type === "insights_calls") return "Call Insights";
  return "Chat Insights";
}

function jobStatusClass(status: BatchJobStatus) {
  if (status === "completed") return "chip chip--success";
  if (status === "failed") return "chip chip--danger";
  return "chip chip--warning";
}

function progressPct(job: LiveJob) {
  if (!job.total) return 0;
  return Math.round((job.progress / job.total) * 100);
}

const jobHistory = ref<LiveJob[]>([]);
const loadingHistory = ref(false);

async function loadHistory() {
  loadingHistory.value = true;
  try {
    const res = await axios.get(RecordingPath.batchJobs);
    jobHistory.value = res.data;
  } catch {
    // silently ignore
  } finally {
    loadingHistory.value = false;
  }
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

onMounted(() => {
  loadSummary();
  loadHistory();
  loadFailed();
  if (loadStoredIds().length) startPolling();
});

onUnmounted(stopPolling);
</script>

<template>
  <div>
    <div>
      <!-- Hero -->
      <div class="hero">
        <div class="hero-row">
          <div class="hero-left">
            <h1 class="hero-title">Batch Dashboard</h1>
            <div class="hero-subtitle">Monitor queue status and run batch transcription and insights jobs.</div>
          </div>
          <div class="hero-right chip-row">
            <span class="chip chip--primary">Total: <strong style="margin-left:6px">{{ totalRows }}</strong></span>
            <span class="chip chip--secondary">Batch size: <strong style="margin-left:6px">{{ limit }}</strong></span>
          </div>
        </div>
      </div>

      <!-- Tiles -->
      <div class="grid">
        <!-- Insights usage & cost -->
        <InsightsUsagePanel />

        <!-- Summary tile -->
        <div class="tile tile--accent" @click="toggle('summary')">
          <div class="tile-head">
            <div class="tile-icon">Σ</div>
            <div class="tile-text">
              <div class="tile-title">Queue Summary</div>
              <div class="tile-desc">Counts by status</div>
            </div>
            <div class="spacer" />
            <span v-if="summary" class="chip chip--primary kpi-chip">{{ summary.totalRows }} total</span>
            <button
              v-if="isOpen('summary')"
              class="btn btn--ghost btn--sm"
              :disabled="loadingSummary"
              style="margin-right: 8px"
              @click.stop="loadSummary"
            >
              {{ loadingSummary ? "Refreshing..." : "Refresh" }}
            </button>
            <div class="chev" :class="{ open: isOpen('summary') }"></div>
          </div>

          <div v-show="isOpen('summary')" class="tile-body" @click.stop>
            <div v-if="summary">
              <!-- Calls row -->
              <div class="summary-row">
                <span class="summary-row-label">📞 Calls</span>
                <span class="chip chip--primary">{{ summary.calls.total }} total</span>
                <span
                  v-for="[st, count] in callStatusEntries"
                  :key="'call-' + st"
                  :class="badgeClass(st)"
                >
                  {{ st }}: {{ count }}
                </span>
                <span v-if="!callStatusEntries.length" class="hint">No calls.</span>
              </div>
              <!-- Chats row -->
              <div class="summary-row" style="margin-top: 10px">
                <span class="summary-row-label">💬 Chats</span>
                <span class="chip chip--secondary">{{ summary.chats.total }} total</span>
                <span
                  v-for="[st, count] in chatStatusEntries"
                  :key="'chat-' + st"
                  :class="badgeClass(st)"
                >
                  {{ st }}: {{ count }}
                </span>
                <span v-if="!chatStatusEntries.length" class="hint">No chats.</span>
              </div>
            </div>
            <div v-else class="hint">Load to see counts.</div>
          </div>
        </div>

        <!-- Actions tile -->
        <div class="tile tile--accent" @click="toggle('actions')">
          <div class="tile-head">
            <div class="tile-icon">⚡</div>
            <div class="tile-text">
              <div class="tile-title">Batch Actions</div>
              <div class="tile-desc">Run next N transcribe/insights</div>
            </div>
            <div class="spacer" />
            <div class="chev" :class="{ open: isOpen('actions') }"></div>
          </div>

          <div v-show="isOpen('actions')" class="tile-body" @click.stop>
            <div class="batch-grid">
              <label class="label">Batch size</label>
              <select v-model.number="limit" class="select">
                <option :value="10">10</option>
                <option :value="20">20</option>
                <option :value="30">30</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
                <option :value="500">500</option>
                <option :value="1000">1000</option>
              </select>
              <button class="btn btn--primary" :disabled="transcribeDisabled" @click="runBatchTranscribe">
                {{ startingTranscribe ? "Starting..." : hasRunningJob("transcribe") ? "Transcribing…" : `Transcribe next ${limit}` }}
              </button>
              <button class="btn btn--ghost btn--sm" :disabled="loadingSummary" @click.stop="loadSummary">
                {{ loadingSummary ? "Refreshing..." : "Refresh" }}
              </button>

              <label class="label">Insights Provider</label>
              <select v-model="insightsProvider" class="select">
                <option :value="InsightsProvider.OpenAI">OpenAI</option>
                <option :value="InsightsProvider.Anthropic">Anthropic</option>
                <option :value="InsightsProvider.Grok">Grok</option>
                <option :value="InsightsProvider.Gemini">Gemini</option>
              </select>

              <label class="label">Model</label>
              <select v-model="insightsModel" class="select">
                <option v-for="m in modelOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
              </select>
              <button class="btn btn--secondary" :disabled="insightsDisabled" @click="runBatchInsights">
                {{ startingInsights ? "Starting..." : hasRunningJob("insights_calls") ? "Generating…" : `Call insights next ${limit}` }}
              </button>
              <button class="btn btn--secondary" :disabled="insightsChatsDisabled" @click="runBatchInsightsChats">
                {{ startingInsightsChats ? "Starting..." : hasRunningJob("insights_chats") ? "Generating…" : `Chat insights next ${limit}` }}
              </button>
            </div>
          </div>
        </div>

        <!-- Chat response-time recompute tile -->
        <div class="tile tile--accent" @click="toggle('actions')">
          <div class="tile-head">
            <div class="tile-icon">⏱</div>
            <div class="tile-text">
              <div class="tile-title">Chat Response-Time Metrics</div>
              <div class="tile-desc">
                Recompute avg/longest/last/SLA-breach figures for every chat in
                a date range. Runs in code from the transcript — no LLM.
              </div>
            </div>
            <div class="spacer" />
          </div>

          <div class="tile-body" @click.stop>
            <div class="batch-grid" style="grid-template-columns: auto 1fr">
              <label class="label">From</label>
              <input v-model="recomputeRtFrom" type="date" class="select" />

              <label class="label">To</label>
              <input v-model="recomputeRtTo" type="date" class="select" />

              <div />
              <button
                class="btn btn--secondary"
                :disabled="startingRecomputeRt"
                @click="runRecomputeChatResponseTime"
              >
                {{ startingRecomputeRt ? "Recomputing…" : "Recompute chat response time" }}
              </button>
            </div>

            <div
              v-if="recomputeRtResult"
              style="margin-top: 12px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center"
            >
              <span class="chip chip--primary">{{ recomputeRtResult.candidates }} candidates</span>
              <span class="chip chip--success">{{ recomputeRtResult.processed }} processed</span>
              <span v-if="recomputeRtResult.skipped" class="chip chip--secondary">{{ recomputeRtResult.skipped }} skipped (no transcript)</span>
              <span v-if="recomputeRtResult.errored" class="chip chip--danger">{{ recomputeRtResult.errored }} errored</span>
            </div>

            <div
              v-if="recomputeRtResult?.errors?.length"
              style="margin-top: 10px; background: var(--surface-2, #f5f5f5); border-radius: 4px; padding: 8px 10px; max-height: 200px; overflow-y: auto"
            >
              <div
                v-for="e in recomputeRtResult.errors"
                :key="e.recordingId"
                style="font-size: 12px; margin-bottom: 4px"
              >
                <span class="mono" style="opacity: 0.7">{{ e.recordingId.slice(0, 8) }}…</span>
                <span style="color: var(--danger, #e55); margin-left: 8px">{{ e.message }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Failed records (dead-letter) + reprocessing -->
        <div class="tile tile--accent">
          <div class="tile-head">
            <div class="tile-icon">⚠</div>
            <div class="tile-text">
              <div class="tile-title">Failed Records &amp; Reprocessing</div>
              <div class="tile-desc">Records stuck in <code>error</code> with the real cause — requeue them, or reprocess insights after a prompt change.</div>
            </div>
            <div class="spacer" />
            <span class="chip" :class="failedRecords.length ? 'chip--danger' : 'chip--success'" style="margin-right: 8px">{{ failedRecords.length }} error{{ failedRecords.length === 1 ? '' : 's' }}</span>
            <button class="btn btn--ghost btn--sm" :disabled="loadingFailed" @click.stop="loadFailed">{{ loadingFailed ? "Refreshing…" : "Refresh" }}</button>
          </div>
          <div class="tile-body">
            <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 12px">
              <button class="btn btn--primary" :disabled="requeuing || !failedRecords.length" @click="requeueAllErrors">
                {{ requeuing ? "Requeuing…" : "Requeue all errors" }}
              </button>
              <span class="hint">Re-queues errored records: re-transcribe those with no transcript, re-run insights for the rest. Non-destructive.</span>
            </div>

            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px">
              <input v-model="reprocessCampaign" class="select" placeholder="campaign (optional)" style="max-width: 220px" />
              <button class="btn btn--secondary" :disabled="reprocessing" @click="reprocessInsights">
                {{ reprocessing ? "Reprocessing…" : "Reprocess insights" }}
              </button>
              <span class="hint">Deletes insight rows for completed records &amp; re-queues them as <code>transcribed</code>. Destructive — confirmed before running.</span>
            </div>

            <div v-if="maintMsg" class="chip chip--primary" style="margin-bottom: 10px">{{ maintMsg }}</div>

            <div v-if="failedRecords.length" style="max-height: 320px; overflow-y: auto; border: 1px solid var(--border); border-radius: 6px">
              <div v-for="r in failedRecords" :key="r.id" style="padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 12px">
                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
                  <span class="chip chip--secondary">{{ r.interactionType || 'call' }}</span>
                  <span v-if="r.campaign" class="chip">{{ r.campaign }}</span>
                  <span class="mono" style="opacity: 0.6">{{ (r.id || '').slice(0, 8) }}…</span>
                  <span class="muted" style="margin-left: auto">{{ fmtDate(r.interactionDateTime || r.createdAt) }}</span>
                  <button class="btn btn--ghost btn--sm" @click="requeueRecord(r.id)">Requeue</button>
                </div>
                <div v-if="r.lastError" style="color: var(--danger, #e55); margin-top: 4px; word-break: break-word">{{ r.lastError }}</div>
              </div>
            </div>
            <div v-else class="hint">No failed records. 🎉</div>
          </div>
        </div>

        <!-- Active jobs tile -->
        <div v-if="activeJobs.length" class="tile">
          <div class="tile-head">
            <div class="tile-icon">⏳</div>
            <div class="tile-text">
              <div class="tile-title">Active Jobs</div>
              <div class="tile-desc">Background processing — safe to navigate away</div>
            </div>
          </div>
          <div class="tile-body">
            <div
              v-for="job in activeJobs"
              :key="job.id"
              style="margin-bottom: 16px"
            >
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px">
                <span class="chip chip--primary">{{ jobTypeLabel(job.type) }}</span>
                <span :class="jobStatusClass(job.status)">{{ job.status }}</span>
                <span v-if="job.provider" class="chip">{{ job.provider }}</span>
                <span class="muted" style="margin-left: auto; font-size: 12px">
                  {{ job.progress }} / {{ job.total }}
                  <span v-if="job.errorCount" style="color: var(--danger, #e55)"> · {{ job.errorCount }} errors</span>
                </span>
              </div>
              <div style="background: var(--surface-2, #e0e0e0); border-radius: 4px; height: 8px; overflow: hidden">
                <div
                  :style="{ width: progressPct(job) + '%', height: '100%', background: job.status === 'failed' ? 'var(--danger, #e55)' : 'var(--accent, #4a90e2)', transition: 'width 0.4s' }"
                />
              </div>
              <div class="hint" style="margin-top: 4px; display: flex; gap: 16px">
                <span>{{ progressPct(job) }}% complete</span>
                <span>Started: {{ fmtDate(job.startedAt) }}</span>
                <span>Ended: {{ fmtDate(job.completedAt) }}</span>
              </div>

              <!-- Error detail list -->
              <div
                v-if="job.errors && job.errors.length"
                style="margin-top: 10px; background: var(--surface-2, #f5f5f5); border-radius: 4px; padding: 8px 10px; max-height: 200px; overflow-y: auto"
              >
                <div style="font-size: 12px; font-weight: 600; color: var(--danger, #e55); margin-bottom: 6px">
                  {{ job.errors.length }} error(s):
                </div>
                <div
                  v-for="e in job.errors"
                  :key="e.id"
                  style="font-size: 12px; margin-bottom: 6px; border-bottom: 1px solid var(--border, #ddd); padding-bottom: 4px"
                >
                  <span class="mono" style="opacity: 0.7">{{ e.id.slice(0, 8) }}…</span>
                  <span style="color: var(--danger, #e55); margin-left: 8px">{{ e.error }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Last run tile -->
        <div class="tile" @click="toggle('lastRun')">
          <div class="tile-head">
            <div class="tile-icon">⎘</div>
            <div class="tile-text">
              <div class="tile-title">Last Batch Result</div>
              <div class="tile-desc">Inspect the returned payload</div>
            </div>
            <div class="spacer" />
            <template v-if="!isOpen('lastRun')">
              <span v-if="!lastJobResult" class="chip chip--secondary kpi-chip">No batch run yet</span>
              <template v-else-if="lastJobResult">
                <span class="chip chip--success kpi-chip">{{ JSON.parse(lastJobResult).status }}</span>
                <span class="chip chip--secondary kpi-chip">{{ JSON.parse(lastJobResult).progress }}/{{ JSON.parse(lastJobResult).total }}</span>
              </template>
            </template>
            <div class="chev" :class="{ open: isOpen('lastRun') }"></div>
          </div>

          <div v-show="isOpen('lastRun')" class="tile-body" @click.stop>
            <div class="muted">
              Useful for debugging failures quickly (copy/paste into notes or
              tickets).
            </div>

            <div class="toolbar">
              <button
                class="btn btn--ghost btn--sm"
                :disabled="!lastJobResult"
                @click="copyResult"
              >
                {{ copyBtnLabel }}
              </button>
            </div>

            <div v-if="lastJobResult" class="prompt-box">
              <pre>{{ lastJobResult }}</pre>
            </div>
            <div v-else class="hint">No batch run yet.</div>
          </div>
        </div>

        <!-- Batch history tile -->
        <div class="tile" style="grid-column: 1 / -1" @click="toggle('history')">
          <div class="tile-head">
            <div class="tile-icon">🕓</div>
            <div class="tile-text">
              <div class="tile-title">Batch History</div>
              <div class="tile-desc">Last 20 jobs</div>
            </div>
            <div class="spacer" />
            <template v-if="!isOpen('history') && jobHistory.length">
              <span :class="jobStatusClass(jobHistory[0]!.status)" style="font-size:11px;padding:3px 8px">{{ jobHistory[0]!.status }}</span>
              <span class="chip chip--secondary kpi-chip">{{ jobTypeLabel(jobHistory[0]!.type) }}</span>
              <span class="chip chip--secondary kpi-chip">{{ fmtDate(jobHistory[0]!.completedAt ?? jobHistory[0]!.startedAt) }}</span>
            </template>
            <span v-else-if="!isOpen('history') && !jobHistory.length" class="chip chip--secondary kpi-chip">No history</span>
            <button
              v-if="isOpen('history')"
              class="btn btn--ghost btn--sm"
              :disabled="loadingHistory"
              style="margin-right: 8px"
              @click.stop="loadHistory"
            >
              {{ loadingHistory ? "Refreshing…" : "Refresh" }}
            </button>
            <div class="chev" :class="{ open: isOpen('history') }"></div>
          </div>

          <div v-show="isOpen('history')" class="tile-body" @click.stop>
            <div v-if="!jobHistory.length" class="hint">No jobs recorded yet.</div>
            <table v-else style="width: 100%; border-collapse: collapse; font-size: 13px">
              <thead>
                <tr style="text-align: left; border-bottom: 1px solid var(--border, #ddd)">
                  <th style="padding: 6px 10px">Type</th>
                  <th style="padding: 6px 10px">Status</th>
                  <th style="padding: 6px 10px">Provider</th>
                  <th style="padding: 6px 10px">Progress</th>
                  <th style="padding: 6px 10px">Errors</th>
                  <th style="padding: 6px 10px">Started</th>
                  <th style="padding: 6px 10px">Ended</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="job in jobHistory"
                  :key="job.id"
                  style="border-bottom: 1px solid var(--border, #eee)"
                >
                  <td style="padding: 6px 10px">
                    <span class="chip chip--primary">{{ jobTypeLabel(job.type) }}</span>
                  </td>
                  <td style="padding: 6px 10px">
                    <span :class="jobStatusClass(job.status)">{{ job.status }}</span>
                  </td>
                  <td style="padding: 6px 10px" class="mono">{{ job.provider ?? "—" }}</td>
                  <td style="padding: 6px 10px">{{ job.progress }} / {{ job.total }}</td>
                  <td style="padding: 6px 10px">
                    <span v-if="job.errorCount" style="color: var(--danger, #e55)">{{ job.errorCount }}</span>
                    <span v-else>0</span>
                  </td>
                  <td style="padding: 6px 10px" class="mono">{{ fmtDate(job.startedAt) }}</td>
                  <td style="padding: 6px 10px" class="mono">{{ fmtDate(job.completedAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Error (full width) -->
        <div v-if="error" class="error-tile">
          <div class="error-title">Error</div>
          <div class="error-text">{{ error }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.summary-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.summary-row-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted, #888);
  min-width: 56px;
}

.batch-grid {
  display: grid;
  grid-template-columns: max-content 160px auto auto;
  gap: 8px 10px;
  align-items: center;
}

.batch-grid .label {
  margin: 0;
  white-space: nowrap;
}

.batch-grid .select {
  width: 100%;
}
</style>
