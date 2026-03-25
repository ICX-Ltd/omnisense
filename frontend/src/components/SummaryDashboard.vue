<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { ApiPath, InsightsProvider } from "@/enums/api";
import { toPrettyInsights } from "@/utils/insights-response";

type SectionKey =
  | "range"
  | "metrics"
  | "operations"
  | "client_services"
  | "objections"
  | "compliance"
  | "narrative"
  | "history"
  | "raw";

const open = ref<Record<SectionKey, boolean>>({
  range: true,
  metrics: true,
  operations: false,
  client_services: false,
  objections: false,
  compliance: false,
  narrative: false,
  history: false,
  raw: false,
});

const toggle = (key: SectionKey) => {
  open.value[key] = !open.value[key];
};
const isOpen = (key: SectionKey) => open.value[key];

const loadingMetrics = ref(false);
const loadingOperations = ref(false);
const loadingClientServices = ref(false);
const loadingObjections = ref(false);
const loadingCompliance = ref(false);
const loadingNarrative = ref(false);
const error = ref("");

type InteractionFilter = "all" | "calls" | "chats";
type NarrativeType =
  | "generic"
  | "calls_operations"
  | "calls_client_services"
  | "chats_operations"
  | "chats_client_services";

const interactionFilter = ref<InteractionFilter>("calls");
const narrativeType = ref<NarrativeType>("generic");

const metrics = ref<any>(null);
const operationsData = ref<any>(null);
const clientServicesData = ref<any>(null);
const objectionsData = ref<any>(null);
const complianceData = ref<any>(null);
const narrativePretty = ref("");
const rawPretty = ref("");

const narrativeProvider = ref<InsightsProvider>(InsightsProvider.OpenAI);

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
const from = ref(
  isoStartOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000))
);
const to = ref(isoEndOfDayExclusive(now));

const totalCalls = computed(() => metrics.value?.totals?.total_calls ?? 0);
const avgSentiment = computed(
  () => metrics.value?.totals?.avg_sentiment ?? null
);

const byCampaign = computed(() => metrics.value?.by_campaign ?? []);
const byContact = computed(() => metrics.value?.by_contact ?? []);
const byConversationType = computed(
  () => metrics.value?.by_conversation_type ?? []
);
const byInterest = computed(() => metrics.value?.by_interest ?? []);
const leadGenerated = computed(() => metrics.value?.lead_generated ?? null);
const scores = computed(() => metrics.value?.scores ?? null);

const worstSentiment = computed(
  () => metrics.value?.examples?.worst_sentiment ?? []
);
const bestSentiment = computed(
  () => metrics.value?.examples?.best_sentiment ?? []
);
const dealerFollowups = computed(
  () => metrics.value?.examples?.dealer_followups ?? []
);

function badgeClass(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "insights_done") return "chip--success";
  if (s === "transcribed") return "chip--info";
  if (s === "pending_transcription") return "chip--warning";
  if (s === "error") return "chip--danger";
  if (s === "connected_correct_party") return "chip--success";
  if (s === "connected_wrong_party") return "chip--warning";
  if (s === "no_answer") return "chip--secondary";
  if (s === "voicemail") return "chip--info";
  if (s === "busy") return "chip--warning";
  if (s === "call_dropped") return "chip--warning";
  if (s === "invalid_number") return "chip--danger";
  if (s === "high") return "chip--success";
  if (s === "medium") return "chip--info";
  if (s === "low") return "chip--warning";
  return "chip--secondary";
}

function sentimentChip(v: number | null) {
  if (typeof v !== "number") return "chip";
  if (v <= -0.3) return "chip chip--danger";
  if (v >= 0.3) return "chip chip--success";
  return "chip chip--secondary";
}

function scoreChip(v: number | null) {
  if (typeof v !== "number") return "chip chip--secondary";
  if (v >= 9) return "chip chip--success";
  if (v >= 7) return "chip chip--info";
  if (v >= 5) return "chip chip--warning";
  return "chip chip--danger";
}

function fmtScore(v: number | null | undefined) {
  if (typeof v !== "number" || v === null) return "n/a";
  return v.toFixed(1);
}

const sharedParams = computed(() => ({
  from: from.value,
  to: to.value,
  filterKey: interactionFilter.value,
}));

async function loadMetrics() {
  loadingMetrics.value = true;
  error.value = "";
  narrativePretty.value = "";
  rawPretty.value = "";

  try {
    const res = await axios.get(ApiPath.InsightsSummary, {
      params: sharedParams.value,
    });
    metrics.value = res.data;
    rawPretty.value = JSON.stringify(res.data, null, 2);
    open.value.metrics = true;
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to load metrics";
  } finally {
    loadingMetrics.value = false;
  }
}

async function loadOperations() {
  loadingOperations.value = true;
  try {
    const res = await axios.get(ApiPath.InsightsSummaryOperations, {
      params: sharedParams.value,
    });
    operationsData.value = res.data;
    open.value.operations = true;
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to load operations";
  } finally {
    loadingOperations.value = false;
  }
}

async function loadClientServices() {
  loadingClientServices.value = true;
  try {
    const res = await axios.get(ApiPath.InsightsSummaryClientServices, {
      params: sharedParams.value,
    });
    clientServicesData.value = res.data;
    open.value.client_services = true;
  } catch (e: any) {
    error.value =
      e?.response?.data?.message ||
      e?.message ||
      "Failed to load client services";
  } finally {
    loadingClientServices.value = false;
  }
}

async function loadObjections() {
  loadingObjections.value = true;
  try {
    const res = await axios.get(ApiPath.InsightsSummaryObjections, {
      params: sharedParams.value,
    });
    objectionsData.value = res.data;
    open.value.objections = true;
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to load objections";
  } finally {
    loadingObjections.value = false;
  }
}

async function loadCompliance() {
  loadingCompliance.value = true;
  try {
    const res = await axios.get(ApiPath.InsightsSummaryCompliance, {
      params: sharedParams.value,
    });
    complianceData.value = res.data;
    open.value.compliance = true;
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to load compliance";
  } finally {
    loadingCompliance.value = false;
  }
}

const isLoadingAny = computed(
  () =>
    loadingMetrics.value ||
    loadingOperations.value ||
    loadingClientServices.value ||
    loadingObjections.value ||
    loadingCompliance.value
);

async function loadAll() {
  error.value = "";
  narrativePretty.value = "";
  rawPretty.value = "";
  await Promise.all([
    loadMetrics(),
    loadOperations(),
    loadClientServices(),
    loadObjections(),
    loadCompliance(),
  ]);
}

async function generateNarrative() {
  loadingNarrative.value = true;
  error.value = "";
  narrativePretty.value = "";

  try {
    const res = await axios.post(ApiPath.InsightsSummaryNarrative, null, {
      params: {
        from: from.value,
        to: to.value,
        filterKey: interactionFilter.value,
        provider: narrativeProvider.value,
        narrativeType: narrativeType.value,
      },
    });

    narrativePretty.value = toPrettyInsights(res.data?.narrative ?? res.data);

    if (res.data?.metrics) {
      metrics.value = res.data.metrics;
      rawPretty.value = JSON.stringify(res.data.metrics, null, 2);
    }

    open.value.narrative = true;
    await loadHistory();
    open.value.history = true;
  } catch (e: any) {
    error.value =
      e?.response?.data?.message ||
      e?.message ||
      "Failed to generate narrative";
  } finally {
    loadingNarrative.value = false;
  }
}

const historyLimit = ref(20);
const loadingHistory = ref(false);
const history = ref<Array<any>>([]);
const selectedHistoryId = ref<string | null>(null);

const selectedHistory = computed(() => {
  if (!selectedHistoryId.value) return null;
  return history.value.find((h) => h.id === selectedHistoryId.value) ?? null;
});

async function loadHistory() {
  loadingHistory.value = true;
  error.value = "";

  try {
    const res = await axios.get(ApiPath.InsightsSummaryNarratives, {
      params: {
        limit: historyLimit.value,
        filterKey: interactionFilter.value,
        provider: narrativeProvider.value,
        narrativeType: narrativeType.value,
      },
    });

    history.value = Array.isArray(res.data) ? res.data : [];

    if (!history.value.length) {
      selectedHistoryId.value = null;
      return;
    }

    const stillExists = history.value.some(
      (h) => h.id === selectedHistoryId.value
    );
    selectedHistoryId.value = stillExists
      ? selectedHistoryId.value
      : history.value[0].id;
  } catch (e: any) {
    error.value =
      e?.response?.data?.message ||
      e?.message ||
      "Failed to load narrative history";
  } finally {
    loadingHistory.value = false;
  }
}

onMounted(async () => {
  await loadAll();
  await loadHistory();
});
</script>

<template>
  <div>
    <!-- Hero -->
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <div class="hero-kicker">Reporting</div>
          <h1 class="hero-title">Summary Dashboard</h1>
          <div class="hero-subtitle">
            View metrics across operations, client services, objections and
            campaign compliance.
          </div>
        </div>

        <div class="hero-right chip-row">
          <span class="chip chip--secondary">{{ interactionFilter }}</span>
          <span class="chip chip--primary">
            Total: <strong style="margin-left: 6px">{{ totalCalls }}</strong>
          </span>
          <span class="chip" :class="sentimentChip(avgSentiment)">
            Avg sentiment:
            <strong style="margin-left: 6px">
              {{
                typeof avgSentiment === "number"
                  ? avgSentiment.toFixed(2)
                  : "n/a"
              }}
            </strong>
          </span>
        </div>
      </div>
    </div>

    <div class="grid">
      <!-- Range / Filters tile -->
      <div class="tile tile--accent" @click="toggle('range')">
        <div class="tile-head">
          <div class="tile-icon">🗓</div>
          <div class="tile-text">
            <div class="tile-title">Date Range &amp; Filters</div>
            <div class="tile-desc">Time window, interaction type, narrative options</div>
          </div>
          <div class="spacer" />
          <div class="chev" :class="{ open: isOpen('range') }"></div>
        </div>

        <div v-show="isOpen('range')" class="tile-body" @click.stop>
          <div class="muted">
            Uses <span class="mono">interactions.createdAt</span> between
            <span class="mono">from</span> (inclusive) and
            <span class="mono">to</span> (exclusive).
          </div>

          <div class="actions-row" style="margin-top: 10px; flex-wrap: wrap">
            <label class="label">From (ISO)</label>
            <input v-model="from" class="input" style="min-width: 340px" />

            <label class="label">To (ISO)</label>
            <input v-model="to" class="input" style="min-width: 340px" />

            <label class="label">Interaction Filter</label>
            <select v-model="interactionFilter" class="select">
              <option value="calls">Calls only</option>
              <option value="chats">Chats only</option>
              <option value="all">All interactions</option>
            </select>

            <label class="label">Narrative Provider</label>
            <select v-model="narrativeProvider" class="select">
              <option :value="InsightsProvider.OpenAI">OpenAI</option>
              <option :value="InsightsProvider.Anthropic">Anthropic</option>
              <option :value="InsightsProvider.Grok">Grok</option>
              <option :value="InsightsProvider.Gemini">Gemini</option>
            </select>

            <label class="label">Narrative Type</label>
            <select v-model="narrativeType" class="select">
              <option value="generic">Generic Overview</option>
              <option value="calls_operations">Calls — Operations</option>
              <option value="calls_client_services">Calls — Client Services</option>
              <option value="chats_operations">Chats — Operations</option>
              <option value="chats_client_services">Chats — Client Services</option>
            </select>

            <button
              class="btn btn--primary"
              :disabled="isLoadingAny"
              @click="loadAll"
            >
              {{ isLoadingAny ? "Loading..." : "Load All" }}
            </button>

            <button
              class="btn btn--secondary"
              :disabled="loadingNarrative || isLoadingAny || !metrics"
              @click="generateNarrative"
            >
              {{ loadingNarrative ? "Generating..." : "Generate Narrative" }}
            </button>
          </div>

          <div v-if="error" class="error-tile" style="margin-top: 10px">
            <div class="error-title">Error</div>
            <div class="error-text">{{ error }}</div>
          </div>
        </div>
      </div>

      <!-- Metrics tile -->
      <div class="tile" @click="toggle('metrics')">
        <div class="tile-head">
          <div class="tile-icon">Σ</div>
          <div class="tile-text">
            <div class="tile-title">Metrics Overview</div>
            <div class="tile-desc">Sentiment, campaigns, contact outcomes, interest</div>
          </div>
          <div class="spacer" />
          <div class="chev" :class="{ open: isOpen('metrics') }"></div>
        </div>

        <div v-show="isOpen('metrics')" class="tile-body" @click.stop>
          <div v-if="!metrics" class="hint">Load metrics to see results.</div>

          <div v-else class="stats">
            <div class="stat">
              <div class="stat-label">Total ({{ interactionFilter }})</div>
              <div class="stat-value">{{ totalCalls }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Avg sentiment</div>
              <div class="stat-value">
                {{
                  typeof avgSentiment === "number"
                    ? avgSentiment.toFixed(2)
                    : "n/a"
                }}
              </div>
            </div>
            <div class="stat" v-if="scores">
              <div class="stat-label">Avg quality score</div>
              <div class="stat-value">{{ fmtScore(scores.avg_score) }}</div>
            </div>
            <div class="stat" v-if="leadGenerated">
              <div class="stat-label">Dealer leads</div>
              <div class="stat-value">
                {{ leadGenerated.count_true }} / {{ leadGenerated.total }}
              </div>
            </div>
          </div>

          <div v-if="metrics" class="grid grid-2" style="margin-top: 12px">
            <!-- Campaign breakdown -->
            <div class="subcard">
              <div class="tile-title" style="font-size: 14px">By Campaign</div>
              <div class="hint" v-if="!byCampaign.length">No data.</div>
              <div
                v-for="r in byCampaign"
                :key="r.campaign_detected"
                class="metric-row"
              >
                <div class="metric-left">
                  <span class="chip chip--secondary">{{ r.campaign_detected }}</span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ r.count }}</span>
                </div>
              </div>
            </div>

            <!-- Contact outcomes -->
            <div class="subcard">
              <div class="tile-title" style="font-size: 14px">Contact Outcomes</div>
              <div class="hint" v-if="!byContact.length">No data.</div>
              <div
                v-for="r in byContact"
                :key="r.contact_disposition"
                class="metric-row"
              >
                <div class="metric-left">
                  <span class="chip" :class="badgeClass(r.contact_disposition)">
                    {{ r.contact_disposition }}
                  </span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ r.count }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="metrics" class="grid grid-2" style="margin-top: 12px">
            <!-- Conversation type -->
            <div class="subcard">
              <div class="tile-title" style="font-size: 14px">Conversation Type</div>
              <div class="hint" v-if="!byConversationType.length">No data.</div>
              <div
                v-for="r in byConversationType"
                :key="r.conversation_type"
                class="metric-row"
              >
                <div class="metric-left">
                  <span class="chip chip--secondary">{{ r.conversation_type }}</span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ r.count }}</span>
                </div>
              </div>
            </div>

            <!-- Interest -->
            <div class="subcard">
              <div class="tile-title" style="font-size: 14px">Customer Interest</div>
              <div class="hint" v-if="!byInterest.length">No data.</div>
              <div
                v-for="r in byInterest"
                :key="r.interest_level"
                class="metric-row"
              >
                <div class="metric-left">
                  <span class="chip" :class="badgeClass(r.interest_level)">
                    {{ r.interest_level }}
                  </span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ r.count }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Sentiment examples -->
          <div v-if="metrics" class="grid grid-2" style="margin-top: 12px">
            <div class="subcard">
              <div class="tile-title" style="font-size: 14px">Worst Sentiment</div>
              <div class="hint" v-if="!worstSentiment.length">No examples.</div>
              <div
                v-for="x in worstSentiment"
                :key="x.recordingId"
                class="list-row"
                style="margin-top: 8px"
              >
                <div class="row-top">
                  <span class="chip" :class="sentimentChip(x.sentiment_overall)">
                    {{ typeof x.sentiment_overall === "number" ? x.sentiment_overall.toFixed(2) : "n/a" }}
                  </span>
                  <span class="chip chip--secondary">{{ x.campaign_detected || "unknown campaign" }}</span>
                  <span class="mono" style="opacity: 0.75">{{ String(x.recordingId).slice(0, 8) }}</span>
                </div>
                <div class="url-text">{{ x.summary_short || "(no summary)" }}</div>
              </div>
            </div>

            <div class="subcard">
              <div class="tile-title" style="font-size: 14px">Best Sentiment</div>
              <div class="hint" v-if="!bestSentiment.length">No examples.</div>
              <div
                v-for="x in bestSentiment"
                :key="x.recordingId"
                class="list-row"
                style="margin-top: 8px"
              >
                <div class="row-top">
                  <span class="chip" :class="sentimentChip(x.sentiment_overall)">
                    {{ typeof x.sentiment_overall === "number" ? x.sentiment_overall.toFixed(2) : "n/a" }}
                  </span>
                  <span class="chip chip--secondary">{{ x.campaign_detected || "unknown campaign" }}</span>
                  <span class="mono" style="opacity: 0.75">{{ String(x.recordingId).slice(0, 8) }}</span>
                </div>
                <div class="url-text">{{ x.summary_short || "(no summary)" }}</div>
              </div>
            </div>
          </div>

          <!-- Dealer follow-ups -->
          <div v-if="metrics && dealerFollowups.length" class="subcard" style="margin-top: 12px">
            <div class="tile-title" style="font-size: 14px">Recent Dealer Follow-ups</div>
            <div
              v-for="x in dealerFollowups"
              :key="x.recordingId"
              class="list-row"
              style="margin-top: 8px"
            >
              <div class="row-top">
                <span class="chip chip--info">dealer</span>
                <span class="mono">{{ x.dealer_name || "unknown" }}</span>
                <span class="chip chip--secondary">{{ x.campaign_detected || "unknown" }}</span>
                <span class="mono" style="opacity: 0.75">{{ String(x.recordingId).slice(0, 8) }}</span>
              </div>
              <div class="url-text">{{ x.summary_short || "(no summary)" }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Operations tile -->
      <div class="tile" @click="toggle('operations')">
        <div class="tile-head">
          <div class="tile-icon">⚙</div>
          <div class="tile-text">
            <div class="tile-title">Operations</div>
            <div class="tile-desc">Quality scores, dimension averages, coaching themes</div>
          </div>
          <div class="spacer" />
          <span v-if="loadingOperations" class="chip chip--secondary" style="font-size: 12px">Loading...</span>
          <div class="chev" :class="{ open: isOpen('operations') }"></div>
        </div>

        <div v-show="isOpen('operations')" class="tile-body" @click.stop>
          <div v-if="!operationsData" class="hint">Click Load All to see results.</div>

          <div v-else>
            <!-- Score stats -->
            <div class="stats">
              <div class="stat">
                <div class="stat-label">Scored</div>
                <div class="stat-value">{{ operationsData.score_stats.scored_count }} / {{ operationsData.score_stats.total_count }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Avg score</div>
                <div class="stat-value" :class="scoreChip(operationsData.score_stats.avg_score)">
                  {{ fmtScore(operationsData.score_stats.avg_score) }}
                </div>
              </div>
              <div class="stat">
                <div class="stat-label">Min</div>
                <div class="stat-value">{{ fmtScore(operationsData.score_stats.min_score) }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Max</div>
                <div class="stat-value">{{ fmtScore(operationsData.score_stats.max_score) }}</div>
              </div>
            </div>

            <div class="grid grid-2" style="margin-top: 12px">
              <!-- Score distribution -->
              <div class="subcard">
                <div class="tile-title" style="font-size: 14px">Score Distribution</div>
                <div
                  v-for="b in operationsData.score_distribution"
                  :key="b.bucket"
                  class="metric-row"
                >
                  <div class="metric-left">
                    <span class="chip chip--secondary">{{ b.bucket }}</span>
                  </div>
                  <div class="metric-right">
                    <span class="count-pill">{{ b.count }}</span>
                  </div>
                </div>
                <div class="hint" v-if="!operationsData.score_distribution.length">No data.</div>
              </div>

              <!-- Top coaching needs -->
              <div class="subcard">
                <div class="tile-title" style="font-size: 14px">Top Coaching Needs</div>
                <div class="hint" v-if="!operationsData.top_coaching_needs.length">No data.</div>
                <div
                  v-for="n in operationsData.top_coaching_needs"
                  :key="n.need"
                  class="metric-row"
                >
                  <div class="metric-left">
                    <div class="metric-title" style="font-size: 13px">{{ n.need }}</div>
                  </div>
                  <div class="metric-right">
                    <span class="count-pill">{{ n.count }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Dimension averages -->
            <div class="subcard" style="margin-top: 12px">
              <div class="tile-title" style="font-size: 14px">Dimension Averages</div>
              <div style="margin-top: 10px">
                <div
                  v-for="(val, dim) in operationsData.dimension_averages"
                  :key="dim"
                  style="margin-bottom: 10px"
                >
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
                    <span style="font-size: 12px; min-width: 150px; text-transform: capitalize">
                      {{ String(dim).replace(/_/g, ' ') }}
                    </span>
                    <span
                      class="chip"
                      :class="scoreChip(typeof val === 'number' ? val : null)"
                      style="min-width: 40px; text-align: center; font-size: 12px"
                    >
                      {{ fmtScore(typeof val === 'number' ? val : null) }}
                    </span>
                  </div>
                  <div style="background: var(--surface-2, #e0e0e0); border-radius: 3px; height: 7px; overflow: hidden">
                    <div
                      :style="{
                        width: typeof val === 'number' ? (val / 10 * 100) + '%' : '0%',
                        height: '100%',
                        background: typeof val === 'number'
                          ? `hsl(${Math.round(val * 12)}, 65%, 42%)`
                          : '#ccc',
                        transition: 'width 0.4s ease',
                      }"
                    />
                  </div>
                </div>
              </div>
            </div>

            <!-- Lowest scored -->
            <div
              v-if="operationsData.lowest_scored.length"
              class="subcard"
              style="margin-top: 12px"
            >
              <div class="tile-title" style="font-size: 14px">Lowest Scored — Coaching Focus</div>
              <div
                v-for="x in operationsData.lowest_scored"
                :key="x.recordingId"
                class="list-row"
                style="margin-top: 8px"
              >
                <div class="row-top">
                  <span class="chip" :class="scoreChip(x.overall_score)">
                    {{ fmtScore(x.overall_score) }}
                  </span>
                  <span class="chip chip--secondary">{{ x.campaign_detected || "unknown" }}</span>
                  <span class="mono" style="opacity: 0.75">{{ String(x.recordingId).slice(0, 8) }}</span>
                </div>
                <div class="url-text">{{ x.summary_short || "(no summary)" }}</div>
                <div
                  v-if="x.coaching_json?.needs_improvement?.length"
                  class="muted"
                  style="margin-top: 4px"
                >
                  Needs: {{ x.coaching_json.needs_improvement.slice(0, 2).join("; ") }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Client Services tile -->
      <div class="tile" @click="toggle('client_services')">
        <div class="tile-head">
          <div class="tile-icon">👥</div>
          <div class="tile-text">
            <div class="tile-title">Client Services</div>
            <div class="tile-desc">Lead generation, in-market signals, competitor activity</div>
          </div>
          <div class="spacer" />
          <span v-if="loadingClientServices" class="chip chip--secondary" style="font-size: 12px">Loading...</span>
          <div class="chev" :class="{ open: isOpen('client_services') }"></div>
        </div>

        <div v-show="isOpen('client_services')" class="tile-body" @click.stop>
          <div v-if="!clientServicesData" class="hint">Click Load All to see results.</div>

          <div v-else>
            <div class="stats">
              <div class="stat">
                <div class="stat-label">Total</div>
                <div class="stat-value">{{ clientServicesData.totals.total }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Dealer Leads</div>
                <div class="stat-value chip chip--success">{{ clientServicesData.totals.leads }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">In-Market</div>
                <div class="stat-value chip chip--info">{{ clientServicesData.totals.in_market }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Lost Sales</div>
                <div class="stat-value chip chip--danger">{{ clientServicesData.totals.lost_sales }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Bought Elsewhere</div>
                <div class="stat-value chip chip--warning">{{ clientServicesData.totals.purchased_elsewhere }}</div>
              </div>
            </div>

            <div class="grid grid-2" style="margin-top: 12px">
              <!-- Interest -->
              <div class="subcard">
                <div class="tile-title" style="font-size: 14px">Customer Interest</div>
                <div class="hint" v-if="!clientServicesData.by_interest.length">No data.</div>
                <div
                  v-for="r in clientServicesData.by_interest"
                  :key="r.interest_level"
                  class="metric-row"
                >
                  <div class="metric-left">
                    <span class="chip" :class="badgeClass(r.interest_level)">{{ r.interest_level }}</span>
                  </div>
                  <div class="metric-right">
                    <span class="count-pill">{{ r.count }}</span>
                  </div>
                </div>
              </div>

              <!-- Top competitors with top 3 objections each -->
              <div class="subcard">
                <div class="tile-title" style="font-size: 14px">Competitor Purchases &amp; Objections</div>
                <div class="hint" v-if="!clientServicesData.top_competitors.length">No data.</div>
                <div
                  v-for="c in clientServicesData.top_competitors"
                  :key="c.competitor"
                  style="margin-bottom: 10px"
                >
                  <div class="metric-row">
                    <div class="metric-left">
                      <span class="chip chip--warning">{{ c.competitor }}</span>
                    </div>
                    <div class="metric-right">
                      <span class="count-pill">{{ c.count }}</span>
                    </div>
                  </div>
                  <div
                    v-if="c.top_objections && c.top_objections.length"
                    style="padding-left: 12px; margin-top: 3px"
                  >
                    <div
                      v-for="o in c.top_objections"
                      :key="o.bucket"
                      style="font-size: 12px; display: flex; justify-content: space-between; margin-bottom: 2px; color: var(--text-muted, #888)"
                    >
                      <span>{{ o.label }}</span>
                      <span class="count-pill" style="font-size: 11px; margin-left: 8px">{{ o.count }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Top dealers -->
            <div
              v-if="clientServicesData.top_dealers.length"
              class="subcard"
              style="margin-top: 12px"
            >
              <div class="tile-title" style="font-size: 14px">Top Dealer Follow-ups</div>
              <div
                v-for="d in clientServicesData.top_dealers"
                :key="d.dealer_name"
                class="metric-row"
              >
                <div class="metric-left">
                  <span class="chip chip--info">{{ d.dealer_name }}</span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ d.count }}</span>
                </div>
              </div>
            </div>

            <!-- Recent lost sales -->
            <div
              v-if="clientServicesData.recent_lost_sales.length"
              class="subcard"
              style="margin-top: 12px"
            >
              <div class="tile-title" style="font-size: 14px">Recent Lost Sales</div>
              <div
                v-for="x in clientServicesData.recent_lost_sales"
                :key="x.recordingId"
                class="list-row"
                style="margin-top: 8px"
              >
                <div class="row-top">
                  <span class="chip chip--danger">lost sale</span>
                  <span v-if="x.competitor_purchased" class="chip chip--warning">{{ x.competitor_purchased }}</span>
                  <span class="chip chip--secondary">{{ x.campaign_detected || "unknown" }}</span>
                  <span class="mono" style="opacity: 0.75">{{ String(x.recordingId).slice(0, 8) }}</span>
                </div>
                <div class="url-text">{{ x.summary_short || "(no summary)" }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Objections tile -->
      <div class="tile" @click="toggle('objections')">
        <div class="tile-head">
          <div class="tile-icon">⚡</div>
          <div class="tile-text">
            <div class="tile-title">Objections</div>
            <div class="tile-desc">Most frequent customer objections</div>
          </div>
          <div class="spacer" />
          <span v-if="loadingObjections" class="chip chip--secondary" style="font-size: 12px">Loading...</span>
          <div class="chev" :class="{ open: isOpen('objections') }"></div>
        </div>

        <div v-show="isOpen('objections')" class="tile-body" @click.stop>
          <div v-if="!objectionsData" class="hint">Click Load All to see results.</div>

          <div v-else>
            <div class="stats">
              <div class="stat">
                <div class="stat-label">Total interactions</div>
                <div class="stat-value">{{ objectionsData.totals.total }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">With objections</div>
                <div class="stat-value">{{ objectionsData.totals.with_objections }}</div>
              </div>
              <div class="stat">
                <div class="stat-label">Objection rate</div>
                <div class="stat-value">
                  {{
                    objectionsData.totals.total > 0
                      ? ((objectionsData.totals.with_objections / objectionsData.totals.total) * 100).toFixed(1) + "%"
                      : "n/a"
                  }}
                </div>
              </div>
            </div>

            <div class="subcard" style="margin-top: 12px">
              <div class="tile-title" style="font-size: 14px">Top Objections</div>
              <div class="hint" v-if="!objectionsData.top_objections.length">No objection data found.</div>
              <div
                v-for="o in objectionsData.top_objections"
                :key="o.bucket"
                class="metric-row"
              >
                <div class="metric-left">
                  <div class="metric-title" style="font-size: 13px">{{ o.label }}</div>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ o.count }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Campaign Compliance tile -->
      <div class="tile" @click="toggle('compliance')">
        <div class="tile-head">
          <div class="tile-icon">✅</div>
          <div class="tile-text">
            <div class="tile-title">Campaign Compliance</div>
            <div class="tile-desc">Compliance check pass rates by campaign</div>
          </div>
          <div class="spacer" />
          <span v-if="loadingCompliance" class="chip chip--secondary" style="font-size: 12px">Loading...</span>
          <div class="chev" :class="{ open: isOpen('compliance') }"></div>
        </div>

        <div v-show="isOpen('compliance')" class="tile-body" @click.stop>
          <div v-if="!complianceData" class="hint">Click Load All to see results.</div>

          <div v-else>
            <div class="stats">
              <div class="stat">
                <div class="stat-label">With compliance data</div>
                <div class="stat-value">{{ complianceData.total_with_compliance }}</div>
              </div>
            </div>

            <div class="grid grid-2" style="margin-top: 12px">
              <!-- Compliance rates -->
              <div class="subcard">
                <div class="tile-title" style="font-size: 14px">Pass Counts</div>
                <div
                  v-for="(val, key) in complianceData.compliance_rates"
                  :key="key"
                  class="metric-row"
                >
                  <div class="metric-left">
                    <span class="chip chip--secondary" style="font-size: 11px">{{ key }}</span>
                  </div>
                  <div class="metric-right">
                    <span
                      class="chip"
                      :class="val > 0 ? 'chip--success' : 'chip--secondary'"
                    >
                      {{ val }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- By campaign -->
              <div class="subcard">
                <div class="tile-title" style="font-size: 14px">By Campaign</div>
                <div class="hint" v-if="!complianceData.by_campaign.length">No data.</div>
                <div
                  v-for="c in complianceData.by_campaign"
                  :key="c.campaign"
                  class="metric-row"
                >
                  <div class="metric-left">
                    <span class="chip chip--secondary">{{ c.campaign }}</span>
                  </div>
                  <div class="metric-right">
                    <span class="count-pill">{{ c.count }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Narrative tile -->
      <div class="tile" @click="toggle('narrative')">
        <div class="tile-head">
          <div class="tile-icon">🧠</div>
          <div class="tile-text">
            <div class="tile-title">Narrative</div>
            <div class="tile-desc">LLM-generated executive summary</div>
          </div>
          <div class="spacer" />
          <span v-if="narrativeType !== 'generic'" class="chip chip--info" style="font-size: 12px">{{ narrativeType }}</span>
          <div class="chev" :class="{ open: isOpen('narrative') }"></div>
        </div>

        <div v-show="isOpen('narrative')" class="tile-body" @click.stop>
          <div class="muted">
            Generates a narrative summary from aggregated metrics.
            Use "Generate Narrative" in the Date Range tile. Narratives are cached per filter + provider + type combination.
          </div>

          <div
            v-if="narrativePretty"
            class="prompt-box"
            style="margin-top: 10px"
          >
            <pre class="pre">{{ narrativePretty }}</pre>
          </div>
          <div v-else class="hint" style="margin-top: 10px">
            Click "Generate Narrative" in the Date Range tile.
          </div>
        </div>
      </div>

      <!-- History tile -->
      <div class="tile" @click="toggle('history')">
        <div class="tile-head">
          <div class="tile-icon">🕘</div>
          <div class="tile-text">
            <div class="tile-title">Historical Narratives</div>
            <div class="tile-desc">Previously generated summaries</div>
          </div>
          <div class="spacer" />
          <div class="chev" :class="{ open: isOpen('history') }"></div>
        </div>

        <div v-show="isOpen('history')" class="tile-body" @click.stop>
          <div class="muted">
            Loads the latest saved narratives (cached outputs) for the selected type.
          </div>

          <div class="actions-row" style="margin-top: 10px; flex-wrap: wrap">
            <label class="label">Limit</label>
            <select v-model.number="historyLimit" class="select">
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>

            <button
              class="btn btn--ghost"
              :disabled="loadingHistory"
              @click="loadHistory"
            >
              {{ loadingHistory ? "Loading..." : "Refresh history" }}
            </button>
          </div>

          <div
            v-if="!history.length && !loadingHistory"
            class="hint"
            style="margin-top: 10px"
          >
            No narratives saved yet for this type. Generate one to see it here.
          </div>

          <div v-if="history.length" class="split" style="margin-top: 12px">
            <div class="panel panel--scroll" style="max-height: 320px">
              <div
                v-for="h in history"
                :key="h.id"
                class="list-row"
                :class="{ 'list-row--selected': selectedHistoryId === h.id }"
                @click="selectedHistoryId = h.id"
              >
                <div class="row-top">
                  <span class="chip chip--secondary">{{ h.filterKey }}</span>
                  <span class="chip chip--info">{{ h.narrativeType || "generic" }}</span>
                  <span class="chip">{{ h.providerUsed || "provider?" }}</span>
                  <span class="mono" style="opacity: 0.75">{{
                    String(h.id).slice(0, 8)
                  }}</span>
                </div>
                <div class="muted mono">{{ h.from }} → {{ h.to }}</div>
                <div class="muted" style="margin-top: 4px">
                  created: <span class="mono">{{ h.createdAt }}</span>
                </div>
              </div>
            </div>

            <div class="panel">
              <div v-if="selectedHistory">
                <div class="row-top">
                  <div class="tile-title">Selected Narrative</div>
                  <span class="chip chip--info">{{ selectedHistory.narrativeType || "generic" }}</span>
                  <span class="chip">{{ selectedHistory.providerUsed || "provider?" }}</span>
                  <span class="chip">{{ selectedHistory.model || "model?" }}</span>
                </div>

                <div class="hint" style="margin-top: 8px">
                  Window:
                  <span class="mono">{{ selectedHistory.from }}</span> to
                  <span class="mono">{{ selectedHistory.to }}</span>
                </div>

                <div class="prompt-box" style="margin-top: 10px">
                  <pre class="pre">{{ toPrettyInsights(selectedHistory.narrative) }}</pre>
                </div>
              </div>

              <div v-else class="hint">Select a narrative on the left.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Raw payload tile -->
      <div class="tile" @click="toggle('raw')">
        <div class="tile-head">
          <div class="tile-icon">⎘</div>
          <div class="tile-text">
            <div class="tile-title">Raw Payload</div>
            <div class="tile-desc">Inspect JSON returned from /summary</div>
          </div>
          <div class="spacer" />
          <div class="chev" :class="{ open: isOpen('raw') }"></div>
        </div>

        <div v-show="isOpen('raw')" class="tile-body" @click.stop>
          <div v-if="rawPretty" class="prompt-box">
            <pre class="pre">{{ rawPretty }}</pre>
          </div>
          <div v-else class="hint">Load metrics to see raw JSON.</div>
        </div>
      </div>
    </div>
  </div>
</template>
