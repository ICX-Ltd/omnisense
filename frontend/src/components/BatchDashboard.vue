<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { InsightsProvider } from "@/enums/api";
import { RecordingPath } from "@/enums/recording-paths";

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
  history: true,
});

const toggle = (key: SectionKey) => { open.value[key] = !open.value[key]; };
const isOpen = (key: SectionKey) => open.value[key];

const limit = ref(10);
const insightsProvider = ref<InsightsProvider>(InsightsProvider.OpenAI);

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
    open.value.lastRun = true;
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
      { provider: insightsProvider.value },
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
      { provider: insightsProvider.value },
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
            <div class="hero-kicker">Insights Processing</div>
            <h1 class="hero-title">Batch Dashboard</h1>
            <div class="hero-subtitle">
              Monitor queue status and run batch actions to transcribe and
              generate insights.
            </div>
          </div>

          <div class="hero-right">
            <span class="chip chip--primary">
              Total rows: <strong style="margin-left: 6px">{{ totalRows }}</strong>
            </span>
            <span class="chip chip--secondary">
              Batch: <strong style="margin-left: 6px">{{ limit }}</strong>
            </span>
          </div>
        </div>
      </div>

      <!-- Tiles -->
      <div class="grid">
        <!-- Summary tile -->
        <div class="tile" @click="toggle('summary')">
          <div class="tile-head">
            <div class="tile-icon">Σ</div>
            <div class="tile-text">
              <div class="tile-title">Queue Summary</div>
              <div class="tile-desc">Counts by status</div>
            </div>
            <div class="spacer" />
            <div class="chev" :class="{ open: isOpen('summary') }"></div>
          </div>

          <div v-show="isOpen('summary')" class="tile-body" @click.stop>
            <div class="muted">
              Shows current counts from
              <span class="mono">interactions.status</span>
            </div>

            <div class="toolbar">
              <button
                class="btn btn--ghost"
                :disabled="loadingSummary"
                @click="loadSummary"
              >
                {{ loadingSummary ? "Refreshing..." : "Refresh" }}
              </button>
            </div>

            <div v-if="summary">
              <div class="stats" style="margin-bottom: 12px">
                <div class="stat">
                  <div class="stat-label">Total rows</div>
                  <div class="stat-value">{{ summary.totalRows }}</div>
                </div>
                <div class="stat">
                  <div class="stat-label">Calls</div>
                  <div class="stat-value">{{ summary.calls.total }}</div>
                </div>
                <div class="stat">
                  <div class="stat-label">Chats</div>
                  <div class="stat-value">{{ summary.chats.total }}</div>
                </div>
              </div>

              <div class="tile-title" style="font-size: 13px; margin-bottom: 6px">Calls by status</div>
              <div class="stats" style="margin-bottom: 12px">
                <div
                  v-for="[status, count] in callStatusEntries"
                  :key="'call-' + status"
                  class="stat"
                >
                  <div class="stat-label">
                    <span :class="badgeClass(status)">{{ status }}</span>
                  </div>
                  <div class="stat-value">{{ count }}</div>
                </div>
                <div v-if="!callStatusEntries.length" class="hint">No calls.</div>
              </div>

              <div class="tile-title" style="font-size: 13px; margin-bottom: 6px">Chats by status</div>
              <div class="stats">
                <div
                  v-for="[status, count] in chatStatusEntries"
                  :key="'chat-' + status"
                  class="stat"
                >
                  <div class="stat-label">
                    <span :class="badgeClass(status)">{{ status }}</span>
                  </div>
                  <div class="stat-value">{{ count }}</div>
                </div>
                <div v-if="!chatStatusEntries.length" class="hint">No chats.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Actions tile -->
        <div class="tile tile-accent" @click="toggle('actions')">
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
            <div class="muted">
              Processes records sequentially (safe for prototype). Choose batch
              size and run.
            </div>

            <div class="actions-row">
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
            </div>

            <div class="actions-row">
              <label class="label">Insights Provider</label>
              <select v-model="insightsProvider" class="select">
                <option :value="InsightsProvider.OpenAI">OpenAI</option>
                <option :value="InsightsProvider.Anthropic">Anthropic</option>
                <option :value="InsightsProvider.Grok">Grok</option>
                <option :value="InsightsProvider.Gemini">Gemini</option>
              </select>
            </div>

            <div class="actions-row">
              <button
                class="btn btn--primary"
                :disabled="transcribeDisabled"
                @click="runBatchTranscribe"
              >
                {{ startingTranscribe ? "Starting..." : hasRunningJob("transcribe") ? "Transcribing…" : `Transcribe next ${limit}` }}
              </button>

              <button
                class="btn btn--secondary"
                :disabled="insightsDisabled"
                @click="runBatchInsights"
              >
                {{ startingInsights ? "Starting..." : hasRunningJob("insights_calls") ? "Generating…" : `Call insights next ${limit}` }}
              </button>

              <button
                class="btn btn--secondary"
                :disabled="insightsChatsDisabled"
                @click="runBatchInsightsChats"
              >
                {{ startingInsightsChats ? "Starting..." : hasRunningJob("insights_chats") ? "Generating…" : `Chat insights next ${limit}` }}
              </button>

              <button
                class="btn btn--ghost"
                @click="loadSummary"
              >
                Refresh summary
              </button>
            </div>
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
                :disabled="!lastRunPretty"
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
            <button
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
