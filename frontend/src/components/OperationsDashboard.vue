<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { ApiPath } from "@/enums/api";

// ── Filters ──────────────────────────────────────────────────────────────────
const campaignOptions = ref<string[]>([]);
const agentOptions = ref<string[]>([]);

function isoStartOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}
function isoEndOfDayExclusive(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 1);
  return x.toISOString();
}

const now = new Date();
const from = ref(isoStartOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)));
const to = ref(isoEndOfDayExclusive(now));

const fromDateStr = computed({
  get: () => from.value.slice(0, 10),
  set: (v: string) => { from.value = isoStartOfDay(new Date(v + "T12:00:00")); },
});
const toDateStr = computed({
  get: () => {
    const d = new Date(to.value);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  },
  set: (v: string) => { to.value = isoEndOfDayExclusive(new Date(v + "T12:00:00")); },
});

type InteractionFilter = "all" | "calls" | "chats";
const interactionFilter = ref<InteractionFilter>("calls");
const campaign = ref("");
const agent = ref("");

const sharedParams = computed(() => ({
  from: from.value,
  to: to.value,
  filterKey: interactionFilter.value,
  ...(campaign.value && { campaign: campaign.value }),
  ...(agent.value && { agent: agent.value }),
}));

// ── Data state ───────────────────────────────────────────────────────────────
const loading = ref(false);
const error = ref("");

const opsData = ref<any>(null);
const dimData = ref<any>(null);

// Drill-down state
const expandedBucket = ref<string | null>(null);
const bucketInteractions = ref<any[]>([]);
const loadingBucket = ref(false);

const expandedNeed = ref<string | null>(null);
const needInteractions = ref<any[]>([]);
const loadingNeed = ref(false);

// Detail drawer
const detailId = ref<string | null>(null);
const detailData = ref<any>(null);
const loadingDetail = ref(false);

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtScore(v: number | null | undefined) {
  if (typeof v !== "number" || v === null) return "n/a";
  return v.toFixed(1);
}

function scoreChip(v: number | null) {
  if (typeof v !== "number") return "chip chip--secondary";
  if (v >= 9) return "chip chip--success";
  if (v >= 7) return "chip chip--info";
  if (v >= 5) return "chip chip--warning";
  return "chip chip--danger";
}

function scoreColor(v: number | null) {
  if (typeof v !== "number") return "#ccc";
  return `hsl(${Math.round(v * 12)}, 65%, 42%)`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "n/a";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const isChat = computed(() => detailData.value?.interaction?.interactionType === "chat");

interface ChatMessage {
  id: number;
  source: string;
  sender: string;
  timestamp: string;
  content: string;
}

const chatMessages = computed<ChatMessage[]>(() => {
  if (!isChat.value || !detailData.value?.transcript?.text) return [];
  try {
    const parsed = JSON.parse(detailData.value.transcript.text);
    if (!Array.isArray(parsed)) return [];
    return [...parsed].sort(
      (a: ChatMessage, b: ChatMessage) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  } catch {
    return [];
  }
});

function bucketLabel(b: string) {
  const labels: Record<string, string> = {
    below_5: "Below 5",
    "5_to_7": "5 to 7",
    "7_to_9": "7 to 9",
    "9_plus": "9+",
  };
  return labels[b] || b;
}

function bucketChipClass(b: string) {
  if (b === "below_5") return "chip chip--danger";
  if (b === "5_to_7") return "chip chip--warning";
  if (b === "7_to_9") return "chip chip--info";
  return "chip chip--success";
}

const callDimensions = [
  "intro", "data_protection", "campaign_focus", "disclaimer", "gdpr",
  "correct_outcome", "tone_pace", "delivery", "questioning", "rapport",
  "objection_handling", "active_listening", "product_knowledge",
];

const chatDimensions = [
  "response_time", "accept_time", "questioning", "product_process",
  "engagement", "tone", "paraphrase_close", "language_accuracy",
  "contact_details", "correct_outcome",
];

const dimensions = computed(() => {
  if (!dimData.value) return [];
  const overall = dimData.value.overall ?? {};
  const ag = dimData.value.agent;

  let allowedKeys: string[];
  if (interactionFilter.value === "calls") {
    allowedKeys = callDimensions;
  } else if (interactionFilter.value === "chats") {
    allowedKeys = chatDimensions;
  } else {
    // "all" — show union of both, deduplicated, in a sensible order
    allowedKeys = [...callDimensions, ...chatDimensions.filter((k) => !callDimensions.includes(k))];
  }

  return allowedKeys
    .filter((k) => {
      // Only show dimensions that have data (non-null in overall or agent)
      const ov = typeof overall[k] === "number" ? overall[k] : null;
      const av = ag && typeof ag[k] === "number" ? ag[k] : null;
      return ov !== null || av !== null;
    })
    .map((k) => ({
      key: k,
      label: k.replace(/_/g, " "),
      overall: typeof overall[k] === "number" ? overall[k] : null,
      agent: ag && typeof ag[k] === "number" ? ag[k] : null,
    }));
});

const overallScore = computed(() => dimData.value?.overall?.overall_score ?? null);
const agentScore = computed(() => dimData.value?.agent?.overall_score ?? null);
const overallCount = computed(() => dimData.value?.overall?.count ?? 0);
const agentCount = computed(() => dimData.value?.agent?.count ?? 0);
const agentsInData = computed(() => dimData.value?.agents_in_data ?? []);

function selectAgent(agentName: string) {
  agent.value = agentName;
  loadAll();
}

function clearAgent() {
  agent.value = "";
  loadAll();
}

// ── API calls ────────────────────────────────────────────────────────────────
async function loadFilterOptions() {
  try {
    const res = await axios.get(ApiPath.InsightsSummaryFilters);
    campaignOptions.value = res.data.campaigns ?? [];
    agentOptions.value = res.data.agents ?? [];
  } catch { /* non-critical */ }
}

async function loadAll() {
  loading.value = true;
  error.value = "";
  expandedBucket.value = null;
  expandedNeed.value = null;
  detailId.value = null;

  try {
    const [opsRes, dimRes] = await Promise.all([
      axios.get(ApiPath.InsightsSummaryOperations, { params: sharedParams.value }),
      axios.get(ApiPath.OpsDimensions, { params: sharedParams.value }),
    ]);
    opsData.value = opsRes.data;
    dimData.value = dimRes.data;
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load";
  } finally {
    loading.value = false;
  }
}

async function toggleBucket(bucket: string) {
  if (expandedBucket.value === bucket) {
    expandedBucket.value = null;
    return;
  }
  expandedBucket.value = bucket;
  loadingBucket.value = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByBucket, {
      params: { ...sharedParams.value, bucket, limit: 50 },
    });
    bucketInteractions.value = res.data;
  } catch { bucketInteractions.value = []; }
  finally { loadingBucket.value = false; }
}

async function toggleNeed(need: string) {
  if (expandedNeed.value === need) {
    expandedNeed.value = null;
    return;
  }
  expandedNeed.value = need;
  loadingNeed.value = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByCoachingNeed, {
      params: { ...sharedParams.value, need, limit: 50 },
    });
    needInteractions.value = res.data;
  } catch { needInteractions.value = []; }
  finally { loadingNeed.value = false; }
}

async function openDetail(recordingId: string) {
  detailId.value = recordingId;
  detailData.value = null;
  loadingDetail.value = true;
  try {
    const res = await axios.get(`${ApiPath.OpsInteractionDetail}/${recordingId}`);
    detailData.value = res.data;
  } catch { detailData.value = null; }
  finally { loadingDetail.value = false; }
}

function closeDetail() {
  detailId.value = null;
  detailData.value = null;
}

onMounted(async () => {
  await loadFilterOptions();
  await loadAll();
});
</script>

<template>
  <div class="ops-root">
    <!-- Hero -->
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <h1 class="hero-title">Operations Dashboard</h1>
          <div class="hero-subtitle">Agent performance, score distribution, coaching needs and drill-down.</div>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="tile tile--accent">
      <div class="tile-head">
        <div class="tile-icon">&#9881;</div>
        <div class="tile-text">
          <div class="tile-title">Filters</div>
          <div class="tile-desc">Select date range, channel and optionally filter by campaign or agent</div>
        </div>
      </div>
      <div class="tile-body">
        <div class="filter-row">
          <div class="filter-group">
            <label class="label">From</label>
            <input type="date" v-model="fromDateStr" class="input input--date" />
          </div>
          <div class="filter-group">
            <label class="label">To</label>
            <input type="date" v-model="toDateStr" class="input input--date" />
          </div>
          <div class="filter-group">
            <label class="label">Channel</label>
            <select v-model="interactionFilter" class="select select--sm">
              <option value="calls">Calls only</option>
              <option value="chats">Chats only</option>
              <option value="all">All</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="label">Campaign</label>
            <select v-model="campaign" class="select select--sm">
              <option value="">All</option>
              <option v-for="c in campaignOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="label">Agent</label>
            <select v-model="agent" class="select select--sm">
              <option value="">All</option>
              <option v-for="a in agentOptions" :key="a" :value="a">{{ a }}</option>
            </select>
          </div>
          <button class="btn btn--primary" style="margin-top: 18px" :disabled="loading" @click="loadAll">
            {{ loading ? "Loading..." : "Load" }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-tile" style="margin-top: 10px">
      <div class="error-title">Error</div>
      <div class="error-text">{{ error }}</div>
    </div>

    <template v-if="opsData && dimData">
      <!-- Score overview strip -->
      <div class="stats-strip">
        <div class="stat">
          <div class="stat-label">Interactions</div>
          <div class="stat-value">{{ overallCount }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Overall Avg Score</div>
          <div class="stat-value" :class="scoreChip(overallScore)">{{ fmtScore(overallScore) }}</div>
        </div>
        <template v-if="agent && agentScore !== null">
          <div class="stat">
            <div class="stat-label">{{ agent }} Avg Score</div>
            <div class="stat-value" :class="scoreChip(agentScore)">{{ fmtScore(agentScore) }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">{{ agent }} Count</div>
            <div class="stat-value">{{ agentCount }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Delta</div>
            <div class="stat-value" :class="agentScore >= overallScore ? 'chip chip--success' : 'chip chip--danger'">
              {{ agentScore >= overallScore ? '+' : '' }}{{ fmtScore(agentScore - overallScore) }}
            </div>
          </div>
        </template>
        <template v-else-if="!agent">
          <div class="stat">
            <div class="stat-label">Min</div>
            <div class="stat-value">{{ fmtScore(opsData.score_stats.min_score) }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Max</div>
            <div class="stat-value">{{ fmtScore(opsData.score_stats.max_score) }}</div>
          </div>
        </template>
      </div>

      <!-- Agents in dataset -->
      <div v-if="agentsInData.length && !agent" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128101;</div>
          <div class="tile-text">
            <div class="tile-title">Agents in Dataset</div>
            <div class="tile-desc">Click an agent to compare their scores against the overall average</div>
          </div>
        </div>
        <div class="tile-body">
          <div class="agents-grid">
            <div
              v-for="a in agentsInData"
              :key="a.agent"
              class="agent-card"
              @click="selectAgent(a.agent)"
            >
              <div class="agent-card-name">{{ a.agent }}</div>
              <div class="agent-card-stats">
                <span :class="scoreChip(a.avg_score)" style="font-size: 11px">{{ fmtScore(a.avg_score) }}</span>
                <span class="agent-card-count">{{ a.count }} interactions</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Agent comparison banner -->
      <div v-if="agent" class="agent-banner" style="margin-top: 14px">
        <div class="agent-banner-text">
          Comparing <strong>{{ agent }}</strong> ({{ agentCount }} interactions) against overall average ({{ overallCount }} interactions)
        </div>
        <button class="btn btn--sm" @click="clearAgent">Clear agent filter</button>
      </div>

      <!-- Dimension Averages -->
      <div class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128202;</div>
          <div class="tile-text">
            <div class="tile-title">Dimension Averages</div>
            <div class="tile-desc">
              {{ agent ? `Comparing ${agent} against overall average` : "Overall dimension scores across all agents" }}
            </div>
          </div>
        </div>
        <div class="tile-body">
          <!-- Legend at the top when comparing -->
          <div v-if="agent" class="dim-legend" style="margin-bottom: 14px">
            <span class="dim-legend-item"><span class="dim-swatch dim-swatch--overall" /> Overall average</span>
            <span class="dim-legend-item"><span class="dim-swatch dim-swatch--agent" /> {{ agent }}</span>
          </div>

          <div v-for="d in dimensions" :key="d.key" class="dim-row">
            <div class="dim-label">{{ d.label }}</div>
            <div class="dim-bars">
              <!-- Overall bar (always shown, blue-grey when comparing) -->
              <div class="dim-bar-track">
                <div
                  class="dim-bar"
                  :style="{
                    width: d.overall !== null ? (d.overall / 10 * 100) + '%' : '0%',
                    background: agent ? 'var(--overall-bar, #94a3b8)' : scoreColor(d.overall),
                  }"
                />
              </div>
              <!-- Agent bar (distinct colour) -->
              <div v-if="agent && d.agent !== null" class="dim-bar-track dim-bar-track--agent">
                <div
                  class="dim-bar"
                  :style="{ width: (d.agent / 10 * 100) + '%', background: 'var(--agent-bar, #6366f1)' }"
                />
              </div>
            </div>
            <div class="dim-scores">
              <span class="dim-chip dim-chip--overall" style="font-size: 11px; min-width: 36px; text-align: center">{{ fmtScore(d.overall) }}</span>
              <template v-if="agent && d.agent !== null">
                <span class="dim-chip dim-chip--agent" style="font-size: 11px; min-width: 36px; text-align: center">{{ fmtScore(d.agent) }}</span>
                <span
                  class="dim-delta"
                  :class="d.agent >= d.overall ? 'dim-delta--positive' : 'dim-delta--negative'"
                >
                  {{ d.agent >= d.overall ? "+" : "" }}{{ fmtScore(d.agent - d.overall) }}
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top: 14px">
        <!-- Score Distribution -->
        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#128200;</div>
            <div class="tile-text">
              <div class="tile-title">Score Distribution</div>
              <div class="tile-desc">Click a bucket to see individual interactions</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!opsData.score_distribution.length">No data.</div>
            <div
              v-for="b in opsData.score_distribution"
              :key="b.bucket"
            >
              <div class="metric-row metric-row--clickable" @click="toggleBucket(b.bucket)">
                <div class="metric-left">
                  <span :class="bucketChipClass(b.bucket)">{{ bucketLabel(b.bucket) }}</span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ b.count }}</span>
                  <span class="expand-icon">{{ expandedBucket === b.bucket ? '&#9650;' : '&#9660;' }}</span>
                </div>
              </div>

              <!-- Expanded interaction list -->
              <div v-if="expandedBucket === b.bucket" class="drill-panel">
                <div v-if="loadingBucket" class="hint">Loading interactions...</div>
                <div v-else-if="!bucketInteractions.length" class="hint">No interactions found.</div>
                <div
                  v-else
                  v-for="ix in bucketInteractions"
                  :key="ix.recordingId"
                  class="drill-row"
                  @click="openDetail(ix.recordingId)"
                >
                  <div class="drill-row-top">
                    <span :class="scoreChip(ix.overall_score)" style="font-size: 11px">{{ fmtScore(ix.overall_score) }}</span>
                    <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                    <span v-if="ix.campaign_detected" class="chip chip--secondary" style="font-size: 11px">{{ ix.campaign_detected }}</span>
                    <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span>
                  </div>
                  <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Coaching Needs -->
        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#127891;</div>
            <div class="tile-text">
              <div class="tile-title">Top Coaching Needs</div>
              <div class="tile-desc">Click a need to see affected interactions</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!opsData.top_coaching_needs.length">No data.</div>
            <div
              v-for="n in opsData.top_coaching_needs"
              :key="n.need"
            >
              <div class="metric-row metric-row--clickable" @click="toggleNeed(n.need)">
                <div class="metric-left">
                  <div class="metric-title" style="font-size: 13px">{{ n.need }}</div>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ n.count }}</span>
                  <span class="expand-icon">{{ expandedNeed === n.need ? '&#9650;' : '&#9660;' }}</span>
                </div>
              </div>

              <!-- Expanded interaction list -->
              <div v-if="expandedNeed === n.need" class="drill-panel">
                <div v-if="loadingNeed" class="hint">Loading interactions...</div>
                <div v-else-if="!needInteractions.length" class="hint">No interactions found.</div>
                <div
                  v-else
                  v-for="ix in needInteractions"
                  :key="ix.recordingId"
                  class="drill-row"
                  @click="openDetail(ix.recordingId)"
                >
                  <div class="drill-row-top">
                    <span :class="scoreChip(ix.overall_score)" style="font-size: 11px">{{ fmtScore(ix.overall_score) }}</span>
                    <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                    <span v-if="ix.campaign_detected" class="chip chip--secondary" style="font-size: 11px">{{ ix.campaign_detected }}</span>
                    <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span>
                  </div>
                  <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Lowest scored (quick view) -->
      <div
        v-if="opsData.lowest_scored.length"
        class="tile"
        style="margin-top: 14px"
      >
        <div class="tile-head">
          <div class="tile-icon">&#9888;</div>
          <div class="tile-text">
            <div class="tile-title">Lowest Scored — Coaching Focus</div>
            <div class="tile-desc">Click to view full interaction detail</div>
          </div>
        </div>
        <div class="tile-body">
          <div
            v-for="x in opsData.lowest_scored"
            :key="x.recordingId"
            class="drill-row"
            @click="openDetail(x.recordingId)"
          >
            <div class="drill-row-top">
              <span :class="scoreChip(x.overall_score)" style="font-size: 11px">{{ fmtScore(x.overall_score) }}</span>
              <span class="chip chip--secondary" style="font-size: 11px">{{ x.campaign_detected || "unknown" }}</span>
              <span class="mono" style="font-size: 11px; opacity: 0.6">{{ String(x.recordingId).slice(0, 8) }}</span>
            </div>
            <div class="drill-row-summary">{{ x.summary_short || "(no summary)" }}</div>
            <div
              v-if="x.coaching_json?.needs_improvement?.length"
              class="muted"
              style="margin-top: 3px; font-size: 12px"
            >
              Needs: {{ x.coaching_json.needs_improvement.slice(0, 3).join("; ") }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Detail drawer -->
    <Teleport to="body">
      <div v-if="detailId" class="drawer-backdrop" @click="closeDetail" />
      <Transition name="drawer">
        <div v-if="detailId" class="drawer">
          <div class="drawer-header">
            <div class="drawer-title">Interaction Detail</div>
            <button class="drawer-close" @click="closeDetail">&times;</button>
          </div>
          <div class="drawer-body">
            <div v-if="loadingDetail" class="hint" style="padding: 24px">Loading detail...</div>
            <div v-else-if="!detailData" class="hint" style="padding: 24px">Could not load detail.</div>
            <template v-else>
              <div class="drawer-columns">
                <!-- LEFT COLUMN: metadata, scores, dimensions -->
                <div class="drawer-col drawer-col--left">
                  <!-- Metadata -->
                  <div class="drawer-section">
                    <div class="drawer-section-title">Metadata</div>
                    <div class="drawer-meta-grid">
                      <div><span class="drawer-label">Agent</span><span>{{ detailData.interaction.agent || "n/a" }}</span></div>
                      <div><span class="drawer-label">Campaign</span><span>{{ detailData.interaction.campaign || "n/a" }}</span></div>
                      <div><span class="drawer-label">Type</span><span>{{ detailData.interaction.interactionType || "n/a" }}</span></div>
                      <div><span class="drawer-label">Date</span><span>{{ fmtDate(detailData.interaction.interactionDateTime) }}</span></div>
                      <div><span class="drawer-label">Status</span><span class="chip chip--secondary">{{ detailData.interaction.status }}</span></div>
                      <div v-if="detailData.interaction.interactionId"><span class="drawer-label">Interaction ID</span><span class="mono" style="font-size: 12px">{{ detailData.interaction.interactionId }}</span></div>
                    </div>
                    <div v-if="detailData.interaction.recordingUrl && !isChat" class="audio-player">
                      <div class="drawer-label" style="margin-bottom: 6px">Recording</div>
                      <audio controls preload="none" :src="detailData.interaction.recordingUrl" class="audio-el">
                        Your browser does not support audio playback.
                      </audio>
                    </div>
                  </div>

                  <!-- Scores -->
                  <div v-if="detailData.insight" class="drawer-section">
                    <div class="drawer-section-title">Scores</div>
                    <div class="stats-strip" style="margin-bottom: 10px">
                      <div class="stat">
                        <div class="stat-label">Overall</div>
                        <div class="stat-value" :class="scoreChip(detailData.insight.overall_score)">{{ fmtScore(detailData.insight.overall_score) }}</div>
                      </div>
                      <div class="stat">
                        <div class="stat-label">Sentiment</div>
                        <div class="stat-value">{{ fmtScore(detailData.insight.sentiment_overall) }}</div>
                      </div>
                      <div class="stat">
                        <div class="stat-label">Disposition</div>
                        <div class="stat-value chip chip--secondary" style="font-size: 12px">{{ detailData.insight.contact_disposition || "n/a" }}</div>
                      </div>
                    </div>

                    <!-- Dimension scores -->
                    <div v-if="detailData.insight.operations_scores" style="margin-top: 8px">
                      <div
                        v-for="(dim, key) in detailData.insight.operations_scores"
                        :key="key"
                        class="dim-row"
                        style="margin-bottom: 6px"
                      >
                        <div class="dim-label" style="min-width: 130px">{{ String(key).replace(/_/g, ' ') }}</div>
                        <div class="dim-bars" style="flex: 1">
                          <div class="dim-bar-track">
                            <div class="dim-bar" :style="{ width: (dim?.score ?? 0) / 10 * 100 + '%', background: scoreColor(dim?.score ?? null) }" />
                          </div>
                        </div>
                        <span :class="scoreChip(dim?.score ?? null)" style="font-size: 11px; min-width: 36px; text-align: center">{{ fmtScore(dim?.score ?? null) }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- RIGHT COLUMN: summary, coaching, objections, actions, risks, transcript -->
                <div class="drawer-col drawer-col--right">
                  <!-- Summary -->
                  <div v-if="detailData.insight" class="drawer-section">
                    <div class="drawer-section-title">Summary</div>
                    <p style="margin: 0 0 8px; font-weight: 600">{{ detailData.insight.summary_short }}</p>
                    <p v-if="detailData.insight.summary_detailed" style="margin: 0; line-height: 1.6; color: var(--ink)">{{ detailData.insight.summary_detailed }}</p>
                  </div>

                  <!-- Coaching -->
                  <div v-if="detailData.insight?.coaching" class="drawer-section">
                    <div class="drawer-section-title">Coaching</div>
                    <div v-if="detailData.insight.coaching.did_well?.length" style="margin-bottom: 8px">
                      <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--success, #22c55e); margin-bottom: 4px">Did Well</div>
                      <ul class="drawer-list">
                        <li v-for="(item, i) in detailData.insight.coaching.did_well" :key="i">{{ item }}</li>
                      </ul>
                    </div>
                    <div v-if="detailData.insight.coaching.needs_improvement?.length">
                      <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--danger, #ef4444); margin-bottom: 4px">Needs Improvement</div>
                      <ul class="drawer-list">
                        <li v-for="(item, i) in detailData.insight.coaching.needs_improvement" :key="i">{{ item }}</li>
                      </ul>
                    </div>
                  </div>

                  <!-- Objections -->
                  <div v-if="detailData.insight?.objections?.length" class="drawer-section">
                    <div class="drawer-section-title">Objections</div>
                    <ul class="drawer-list">
                      <li v-for="(obj, i) in detailData.insight.objections" :key="i">{{ obj }}</li>
                    </ul>
                  </div>

                  <!-- Action Items -->
                  <div v-if="detailData.insight?.action_items?.length" class="drawer-section">
                    <div class="drawer-section-title">Action Items</div>
                    <ul class="drawer-list">
                      <li v-for="(item, i) in detailData.insight.action_items" :key="i">
                        <template v-if="typeof item === 'string'">{{ item }}</template>
                        <template v-else>{{ item.description || item.action || JSON.stringify(item) }}</template>
                      </li>
                    </ul>
                  </div>

                  <!-- Risk Flags -->
                  <div v-if="detailData.insight?.risk_flags?.length" class="drawer-section">
                    <div class="drawer-section-title">Risk Flags</div>
                    <ul class="drawer-list">
                      <li v-for="(flag, i) in detailData.insight.risk_flags" :key="i">
                        <template v-if="typeof flag === 'string'">{{ flag }}</template>
                        <template v-else>
                          <span v-if="flag.risk_level" :class="flag.risk_level === 'high' ? 'chip chip--danger' : flag.risk_level === 'medium' ? 'chip chip--warning' : 'chip chip--success'" style="font-size: 11px; margin-right: 6px">{{ flag.risk_level }}</span>
                          {{ flag.description || flag.flag || JSON.stringify(flag) }}
                        </template>
                      </li>
                    </ul>
                  </div>

                  <!-- Transcript / Chat -->
                  <div v-if="detailData.transcript" class="drawer-section">
                    <div class="drawer-section-title">{{ isChat ? 'Chat Conversation' : 'Transcript' }}</div>

                    <!-- Chat bubble view -->
                    <div v-if="isChat && chatMessages.length" class="chat-thread">
                      <div
                        v-for="msg in chatMessages"
                        :key="msg.id"
                        class="chat-msg"
                        :class="msg.source === 'Agent' ? 'chat-msg--agent' : 'chat-msg--customer'"
                      >
                        <div class="chat-bubble" :class="msg.source === 'Agent' ? 'chat-bubble--agent' : 'chat-bubble--customer'">
                          <div class="chat-sender">{{ msg.sender }}</div>
                          <div class="chat-content">{{ msg.content }}</div>
                          <div class="chat-time">{{ fmtTime(msg.timestamp) }}</div>
                        </div>
                      </div>
                    </div>

                    <!-- Fallback: raw transcript (calls, or chat parse failed) -->
                    <pre v-else class="drawer-transcript">{{ detailData.transcript.text }}</pre>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.ops-root {
  position: relative;
  --overall-bar: #94a3b8;
  --agent-bar: #6366f1;
}

/* ── Agents grid ───────────────────────────────────────────────────────────── */
.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.agent-card {
  padding: 10px 14px;
  border-radius: var(--radius-md, 6px);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s;
  background: var(--surface);
}

.agent-card:hover {
  border-color: var(--agent-bar);
  background: color-mix(in srgb, var(--agent-bar) 6%, var(--surface));
  box-shadow: 0 0 0 1px var(--agent-bar);
}

.agent-card-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 4px;
}

.agent-card-stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-card-count {
  font-size: 11px;
  color: var(--muted);
}

/* ── Agent comparison banner ───────────────────────────────────────────────── */
.agent-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--agent-bar) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--agent-bar) 30%, transparent);
}

.agent-banner-text {
  font-size: 13px;
  color: var(--ink);
}

.btn--sm {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: var(--radius-md, 6px);
  background: var(--surface);
  border: 1px solid var(--border);
  cursor: pointer;
  color: var(--ink);
  transition: background 0.15s;
}

.btn--sm:hover {
  background: var(--surface-soft, #f0f0f0);
}

/* ── Stats strip ───────────────────────────────────────────────────────────── */
.stats-strip {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

/* ── Dimension rows ────────────────────────────────────────────────────────── */
.dim-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.dim-label {
  font-size: 12px;
  min-width: 140px;
  text-transform: capitalize;
  color: var(--ink);
}

.dim-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.dim-bar-track {
  background: var(--surface-2, #e0e0e0);
  border-radius: 3px;
  height: 7px;
  overflow: hidden;
}

.dim-bar-track--agent {
  height: 7px;
}

.dim-bar {
  height: 100%;
  transition: width 0.4s ease;
  border-radius: 3px;
}

.dim-scores {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 120px;
  justify-content: flex-end;
}

.dim-delta {
  font-size: 11px;
  font-weight: 700;
  min-width: 40px;
  text-align: right;
}

.dim-delta--positive {
  color: var(--success, #22c55e);
}

.dim-delta--negative {
  color: var(--danger, #ef4444);
}

/* Colour-coded score chips for overall vs agent */
.dim-chip {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 700;
}

.dim-chip--overall {
  background: color-mix(in srgb, var(--overall-bar) 20%, transparent);
  color: #475569;
  border: 1px solid var(--overall-bar);
}

.dim-chip--agent {
  background: color-mix(in srgb, var(--agent-bar) 15%, transparent);
  color: var(--agent-bar);
  border: 1px solid color-mix(in srgb, var(--agent-bar) 50%, transparent);
}

.dim-legend {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--muted);
}

.dim-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dim-swatch {
  display: inline-block;
  width: 12px;
  height: 7px;
  border-radius: 2px;
}

.dim-swatch--overall {
  background: var(--overall-bar, #94a3b8);
}

.dim-swatch--agent {
  background: var(--agent-bar, #6366f1);
}

/* ── Clickable metric rows ─────────────────────────────────────────────────── */
.metric-row--clickable {
  cursor: pointer;
  border-radius: var(--radius-md, 6px);
  padding: 4px 6px;
  margin: -4px -6px;
  transition: background 0.15s;
}

.metric-row--clickable:hover {
  background: var(--surface-soft, rgba(0, 0, 0, 0.03));
}

.expand-icon {
  font-size: 10px;
  color: var(--muted);
  margin-left: 8px;
}

/* ── Drill-down panel ──────────────────────────────────────────────────────── */
.drill-panel {
  padding: 8px 0 8px 12px;
  border-left: 3px solid var(--brand, #6366f1);
  margin: 4px 0 8px 8px;
}

.drill-row {
  padding: 8px 10px;
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
  transition: background 0.15s;
}

.drill-row:hover {
  background: var(--surface-soft, rgba(0, 0, 0, 0.03));
}

.drill-row-top {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.drill-row-summary {
  font-size: 13px;
  color: var(--ink);
  margin-top: 3px;
  line-height: 1.4;
}

/* ── Drawer ────────────────────────────────────────────────────────────────── */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 999;
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  width: min(960px, 92vw);
  height: 100vh;
  background: var(--surface, #fff);
  border-left: 1px solid var(--border);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.drawer-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--ink);
}

.drawer-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--muted);
  padding: 0 4px;
  line-height: 1;
}

.drawer-close:hover {
  color: var(--ink);
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.drawer-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: 100%;
}

.drawer-col {
  overflow-y: auto;
  min-height: 0;
}

.drawer-col--left {
  border-right: 1px solid var(--border);
}

/* On narrow screens, stack vertically */
@media (max-width: 700px) {
  .drawer-columns {
    grid-template-columns: 1fr;
  }
  .drawer-col--left {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
}

.drawer-section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.drawer-section-title {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--brand, #6366f1);
  margin-bottom: 10px;
}

.drawer-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.drawer-meta-grid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.drawer-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.audio-player {
  margin-top: 12px;
}

.audio-el {
  width: 100%;
  height: 36px;
  border-radius: var(--radius-md, 6px);
}

.drawer-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink);
}

/* ── Chat bubbles ──────────────────────────────────────────────────────────── */
.chat-thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 500px;
  overflow-y: auto;
  padding: 8px 4px;
}

.chat-msg {
  display: flex;
}

.chat-msg--agent {
  justify-content: flex-start;
}

.chat-msg--customer {
  justify-content: flex-end;
}

.chat-bubble {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-bubble--agent {
  background: var(--surface-soft, #f1f5f9);
  color: var(--ink);
  border-bottom-left-radius: 4px;
}

.chat-bubble--customer {
  background: var(--brand, #6366f1);
  color: #fff;
  border-bottom-right-radius: 4px;
}

.chat-sender {
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 2px;
  opacity: 0.7;
}

.chat-content {
  margin-bottom: 4px;
}

.chat-time {
  font-size: 10px;
  opacity: 0.5;
  text-align: right;
}

.drawer-transcript {
  margin: 0;
  font-size: 12px;
  font-family: ui-monospace, "Courier New", monospace;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
  background: var(--surface-soft, #f8f8f8);
  padding: 12px;
  border-radius: var(--radius-md, 6px);
  line-height: 1.6;
}

/* ── Drawer transition ─────────────────────────────────────────────────────── */
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.25s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
}
</style>
