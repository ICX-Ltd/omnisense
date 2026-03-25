<template>
  <div>
    <div>
      <!-- Hero -->
      <div class="hero">
        <div class="hero-row">
          <div class="hero-left">
            <div class="hero-kicker">Calls, Transcripts and Insights</div>
            <h1 class="hero-title">Data Queue</h1>
            <div class="hero-subtitle">
              Add call recording URLs to the queue. Select a record, transcribe
              (audio fetched by URL), then generate insights.
            </div>
          </div>
          <div class="hero-right">
            <span class="chip chip--primary">Queue</span>
          </div>
        </div>
      </div>

      <!-- Add URL tile -->
      <div class="grid">
        <div class="tile tile--accent" @click="() => {}">
          <div class="tile-head">
            <div class="tile-icon">＋</div>
            <div class="tile-text">
              <div class="tile-title">Add Recording</div>
              <div class="tile-desc">Paste a downloadable URL</div>
            </div>
            <div class="spacer"></div>
            <div class="muted">Tip: use a direct URL to audio (WAV/MP3/M4A).</div>
            <input v-model="newUrl" class="input" placeholder="https://.../recording.wav" />
            <select v-model="newProvider" class="select">
              <option :value="TranscriptionProvider.Deepgram">deepgram</option>
              <option :value="TranscriptionProvider.OpenAI">openai</option>
            </select>
            <button class="btn btn--primary" :disabled="!newUrl.trim() || creating" @click="createRecording">
              {{ creating ? "Adding..." : "Add URL" }}
            </button>
          </div>
        </div>
      </div>

      <!-- Split: list + details -->
      <div class="split">
        <!-- List panel -->
        <div class="panel panel--scroll">
          <div class="row-top" style="margin-bottom: 10px; align-items: center">
            <div class="tile-title">{{ listTitle }}</div>
            <div class="spacer"></div>
            <span class="chip chip--secondary">
              Showing: <strong style="margin-left: 6px">{{ filteredRecordings.length }} / {{ recordings.length }}</strong>
            </span>
          </div>

          <!-- Filter row 1: search / type / status / campaign -->
          <div class="actions-row" style="margin-bottom: 8px; flex-wrap: wrap; gap: 6px">
            <input
              v-model="searchText"
              class="input"
              style="flex: 1 1 160px"
              placeholder="Search id, url, provider, status…"
            />

            <select v-model="filterType" class="select" style="flex: 0 0 auto">
              <option value="">All types</option>
              <option value="call">Call</option>
              <option value="chat">Chat</option>
            </select>

            <select v-model="status" class="select" style="flex: 0 0 auto">
              <option value="">All statuses</option>
              <option value="incomplete">incomplete</option>
              <option value="pending_transcription">pending_transcription</option>
              <option value="transcribing">transcribing</option>
              <option value="transcribed">transcribed</option>
              <option value="insights_done">insights_done</option>
              <option value="error">error</option>
            </select>

            <input
              v-model="filterCampaign"
              class="input"
              style="flex: 0 0 120px"
              placeholder="Campaign…"
            />
          </div>

          <!-- Filter row 2: dates / limit / refresh -->
          <div class="actions-row" style="margin-bottom: 10px; flex-wrap: wrap; gap: 6px">
            <div style="display: flex; align-items: center; gap: 4px; flex: 0 0 auto">
              <label class="label" style="margin: 0">From</label>
              <input v-model="dateFrom" type="datetime-local" class="input" style="flex: 0 0 auto" />
            </div>

            <div style="display: flex; align-items: center; gap: 4px; flex: 0 0 auto">
              <label class="label" style="margin: 0">To</label>
              <input v-model="dateTo" type="datetime-local" class="input" style="flex: 0 0 auto" />
            </div>

            <button class="btn btn--ghost btn--sm" style="flex: 0 0 auto" @click="clearDates">Clear</button>

            <div class="spacer"></div>

            <select v-model="sortOrder" class="select" style="flex: 0 0 auto">
              <option value="DESC">Newest first</option>
              <option value="ASC">Oldest first</option>
            </select>

            <select v-model.number="resultLimit" class="select" style="flex: 0 0 auto">
              <option :value="50">50</option>
              <option :value="100">100</option>
              <option :value="250">250</option>
              <option :value="500">500</option>
              <option :value="1000">1000</option>
            </select>

            <button class="btn btn--ghost" :disabled="loading" @click="loadRecordings" style="flex: 0 0 auto">
              {{ loading ? "Refreshing..." : "Refresh" }}
            </button>
          </div>

          <div v-if="error" class="error-tile" style="margin-bottom: 10px">
            <div class="error-title">Error</div>
            <div class="error-text">{{ error }}</div>
          </div>

          <div
            v-for="r in filteredRecordings"
            :key="r.id"
            class="list-row"
            :class="{ 'list-row--selected': selected?.id === r.id }"
            @click="select(r)"
          >
            <div class="row-top">
              <span class="chip">{{ r.status }}</span>
              <span v-if="r.interactionType" class="chip chip--secondary">{{ r.interactionType }}</span>
              <span v-if="r.campaign" class="chip chip--primary">{{ r.campaign }}</span>
              <span class="mono" style="opacity: 0.6; margin-left: auto; font-size: 11px">{{ r.id.slice(0, 8) }}</span>
            </div>

            <div class="row-top chip-row" style="margin-top: 6px; justify-content: flex-start">
              <span class="chip chip--secondary">transcript: {{ r.provider || "unknown" }}</span>
              <span class="chip chip--primary" v-if="r.insightProviderUsed">insights: {{ r.insightProviderUsed }}</span>
              <span class="chip" v-else>insights: none</span>
              <span class="mono" style="opacity: 0.5; font-size: 11px; margin-left: auto">{{ fmtDate(r.createdAt) }}</span>
            </div>

            <div class="url-text">{{ r.recordingUrl }}</div>

            <div v-if="r.lastError" class="small-danger">
              Error: {{ r.lastError }}
            </div>
          </div>

          <div v-if="!recordings.length && !loading" class="hint">No records found.</div>
        </div>

        <!-- Details panel -->
        <div class="panel">
          <div v-if="selected">
            <div class="row-top" style="align-items: center; margin-bottom: 10px">
              <div>
                <div class="tile-title">Selected</div>
                <div class="hint" style="margin-top: 4px">{{ selected.id }}</div>
              </div>
              <div class="spacer"></div>
              <div class="chip-row">
                <span v-if="selected.interactionType" class="chip chip--secondary">{{ selected.interactionType }}</span>
                <span v-if="selected.campaign" class="chip chip--primary">{{ selected.campaign }}</span>
                <span class="chip chip--secondary">transcript: {{ selected.provider || "unknown" }}</span>
                <span class="chip chip--primary" v-if="selectedInsightMeta?.providerUsed">
                  insights: {{ selectedInsightMeta.providerUsed }}
                </span>
                <span class="chip" v-else>insights: pending</span>
                <span class="chip chip--secondary">{{ selected.status }}</span>
              </div>
            </div>

            <div class="kv">
              <span>URL</span>
              <span class="mono">{{ selected.recordingUrl }}</span>
            </div>

            <div class="kv">
              <span>Created</span>
              <span>{{ fmtDate(selected.createdAt) }}</span>
            </div>

            <div v-if="selectedInsightMeta?.model" class="kv">
              <span>Insight model</span>
              <span>{{ selectedInsightMeta.model }}</span>
            </div>

            <div class="actions-row" style="margin-top: 12px">
              <button class="btn btn--primary" :disabled="busy" @click="transcribeSelected">Transcribe</button>

              <button class="btn btn--secondary" :disabled="!canRunInsights" @click="insightsSelected">
                {{ selected?.status === "error" ? "Retry Insights" : "Generate Insights" }}
              </button>

              <button class="btn btn--ghost" :disabled="busy" @click="loadDetails(selected.id)">Reload details</button>

              <label class="label">Insights Provider</label>
              <select v-model="insightsProvider" class="select">
                <option :value="InsightsProvider.OpenAI">OpenAI</option>
                <option :value="InsightsProvider.Anthropic">Anthropic</option>
                <option :value="InsightsProvider.Grok">Grok</option>
                <option :value="InsightsProvider.Gemini">Gemini</option>
              </select>
            </div>

            <div v-if="busy" class="hint">Working…</div>

            <div v-if="transcriptText" class="subcard">
              <div class="tile-title" style="font-size: 14px">Transcript</div>
              <div class="prompt-box">
                <pre class="pre">{{ transcriptText }}</pre>
              </div>
            </div>

            <div v-if="insightsPretty" class="subcard">
              <div class="tile-title" style="font-size: 14px">Insights</div>
              <div class="prompt-box">
                <pre class="pre">{{ insightsPretty }}</pre>
              </div>
            </div>
          </div>

          <div v-else class="hint">Select a record on the left.</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { ApiPath, InsightsProvider, TranscriptionProvider } from "@/enums/api";
import { RecordingPath } from "@/enums/recording-paths";
import { toPrettyInsights } from "@/utils/insights-response";

type Recording = {
  id: string;
  provider: string;
  recordingUrl: string;
  status: string;
  interactionType: string | null;
  campaign: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  insightProviderUsed?: string | null;
};

type InsightMeta = {
  providerUsed?: string | null;
  model?: string | null;
};

function todayDateTimeLocal() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  // datetime-local format: YYYY-MM-DDTHH:mm
  return now.toISOString().slice(0, 16);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const newUrl = ref("");
const creating = ref(false);
const newProvider = ref<TranscriptionProvider>(TranscriptionProvider.Deepgram);

// Filters
const status = ref<string>("");
const filterType = ref<string>("");
const filterCampaign = ref<string>("");
const dateFrom = ref<string>(todayDateTimeLocal());
const dateTo = ref<string>("");
const sortOrder = ref<"DESC" | "ASC">("DESC");
const resultLimit = ref(250);
const searchText = ref("");

const recordings = ref<Recording[]>([]);
const selected = ref<Recording | null>(null);

const loading = ref(false);
const busy = ref(false);
const error = ref("");

const transcriptText = ref("");
const insightsPretty = ref("");
const selectedInsightMeta = ref<InsightMeta | null>(null);

const insightsProvider = ref<InsightsProvider>(InsightsProvider.OpenAI);

const listTitle = computed(() => {
  const parts: string[] = [];
  if (filterType.value) parts.push(filterType.value === "call" ? "Calls" : "Chats");
  else parts.push("All");
  if (filterCampaign.value) parts.push(filterCampaign.value);
  return parts.join(" · ");
});

const filteredRecordings = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  if (!q) return recordings.value;
  return recordings.value.filter((r) =>
    r.id.toLowerCase().includes(q) ||
    (r.recordingUrl ?? "").toLowerCase().includes(q) ||
    (r.provider ?? "").toLowerCase().includes(q) ||
    (r.insightProviderUsed ?? "").toLowerCase().includes(q) ||
    (r.status ?? "").toLowerCase().includes(q) ||
    (r.campaign ?? "").toLowerCase().includes(q) ||
    (r.lastError ?? "").toLowerCase().includes(q)
  );
});

const canRunInsights = computed(() => {
  if (!selected.value || busy.value) return false;
  if (selected.value.status === "transcribed" || selected.value.status === "insights_done") return true;
  if (selected.value.status === "error" && transcriptText.value.trim().length > 0) return true;
  return false;
});

function clearDates() {
  dateFrom.value = "";
  dateTo.value = "";
}

async function loadRecordings() {
  loading.value = true;
  error.value = "";

  try {
    const qs = new URLSearchParams();
    if (status.value) qs.set("status", status.value);
    if (filterType.value) qs.set("interactionType", filterType.value);
    if (filterCampaign.value) qs.set("campaign", filterCampaign.value);
    if (dateFrom.value) qs.set("dateFrom", dateFrom.value);
    if (dateTo.value) qs.set("dateTo", dateTo.value);
    qs.set("order", sortOrder.value);
    qs.set("limit", String(resultLimit.value));

    const res = await axios.get(`${ApiPath.Recordings}?${qs.toString()}`);
    const rows = Array.isArray(res.data) ? res.data : [];

    recordings.value = rows.map((r: any) => ({
      ...r,
      insightProviderUsed: r.insightProviderUsed ?? r.providerUsed ?? null,
    }));

    if (selected.value) {
      selected.value = recordings.value.find((r) => r.id === selected.value?.id) ?? null;
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load recordings";
  } finally {
    loading.value = false;
  }
}

async function select(r: Recording) {
  selected.value = r;
  await loadDetails(r.id);
}

async function createRecording() {
  creating.value = true;
  error.value = "";
  try {
    await axios.post(ApiPath.Recordings, {
      recordingUrl: newUrl.value.trim(),
      provider: newProvider.value,
    });
    newUrl.value = "";
    await loadRecordings();
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to create recording";
  } finally {
    creating.value = false;
  }
}

async function transcribeSelected() {
  if (!selected.value) return;
  busy.value = true;
  error.value = "";
  transcriptText.value = "";
  insightsPretty.value = "";
  selectedInsightMeta.value = null;
  try {
    const res = await axios.post(RecordingPath.transcribe(selected.value.id));
    transcriptText.value = res.data?.text ?? "";
    await loadRecordings();
    await loadDetails(selected.value.id);
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Transcription failed";
    await loadRecordings();
  } finally {
    busy.value = false;
  }
}

async function insightsSelected() {
  if (!selected.value) return;
  busy.value = true;
  error.value = "";
  insightsPretty.value = "";
  try {
    const res = await axios.post(RecordingPath.insights(selected.value.id), {
      provider: insightsProvider.value,
    });
    selectedInsightMeta.value = {
      providerUsed: res.data?.providerUsed ?? null,
      model: res.data?.model ?? null,
    };
    insightsPretty.value = toPrettyInsights(res.data);
    await loadRecordings();
    await loadDetails(selected.value.id);
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Insights failed";
    await loadRecordings();
  } finally {
    busy.value = false;
  }
}

async function loadDetails(recordingId: string) {
  transcriptText.value = "";
  insightsPretty.value = "";
  error.value = "";
  selectedInsightMeta.value = null;

  try {
    const t = await axios.get(RecordingPath.transcript(recordingId));
    transcriptText.value = t.data?.text ?? "";
  } catch {
    // not found yet
  }

  try {
    const i = await axios.get(RecordingPath.insight(recordingId));
    selectedInsightMeta.value = {
      providerUsed: i.data?.providerUsed ?? null,
      model: i.data?.model ?? null,
    };
    insightsPretty.value = toPrettyInsights(i.data);
    if (selected.value?.id === recordingId) {
      selected.value = { ...selected.value, insightProviderUsed: i.data?.providerUsed ?? null };
    }
    const idx = recordings.value.findIndex((r) => r.id === recordingId);
    if (idx >= 0) {
      recordings.value[idx] = { ...recordings.value[idx], insightProviderUsed: i.data?.providerUsed ?? null };
    }
  } catch {
    // not found yet
  }
}

onMounted(loadRecordings);
</script>
