<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import IconChip from "./IconChip.vue";
import { ApiPath } from "@/enums/api";

interface Overview {
  generatedAt: string;
  totals: {
    interactions: number;
    transcripts: number;
    embeddings: number;
    insights: number;
    errors: number;
  };
  byStatus: Array<{ status: string; count: number }>;
  byCampaignType: Array<{ campaign: string; type: string; count: number }>;
  campaignTimeline: Array<{
    campaign: string;
    count: number;
    firstLoaded: string | null;
    lastLoaded: string | null;
    firstInteraction: string | null;
    lastInteraction: string | null;
  }>;
  loadedByDate: Array<{ date: string; count: number }>;
  errorSources: { pipeline: number; transcription: number | null; llm: number | null };
}

const data = ref<Overview | null>(null);
const loading = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    data.value = (await axios.get<Overview>(ApiPath.InsightsSummaryOverview)).data;
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load overview";
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// Interactions as a campaign × type matrix: one row per campaign, one column
// per type (call/chat/survey/…) plus a total — compact grid, less vertical space.
const TYPE_ORDER = ["call", "chat", "survey"];
const allTypes = computed(() => {
  const set = new Set<string>();
  for (const r of data.value?.byCampaignType ?? []) set.add(r.type);
  return [...set].sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a);
    const ib = TYPE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
});
const campaignMatrix = computed(() => {
  const rows: Record<string, { campaign: string; total: number; counts: Record<string, number> }> = {};
  for (const r of data.value?.byCampaignType ?? []) {
    const row = (rows[r.campaign] ??= { campaign: r.campaign, total: 0, counts: {} });
    row.counts[r.type] = (row.counts[r.type] ?? 0) + r.count;
    row.total += r.count;
  }
  return Object.values(rows).sort((a, b) => b.total - a.total);
});

const maxDayCount = computed(() =>
  Math.max(1, ...(data.value?.loadedByDate ?? []).map((d) => d.count)),
);

function fmtInt(n: number | null | undefined) {
  return typeof n === "number" ? n.toLocaleString() : "—";
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}
function fmtStamp(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function statusChip(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "insights_done") return "chip chip--success";
  if (s === "transcribed") return "chip chip--info";
  if (s === "transcribing" || s === "insights_pending") return "chip chip--info";
  if (s === "pending_transcription") return "chip chip--warning";
  if (s === "error") return "chip chip--danger";
  return "chip chip--secondary";
}
</script>

<template>
  <div>
    <!-- Hero -->
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <h1 class="hero-title">Data Overview</h1>
          <div class="hero-subtitle">
            A snapshot of what's in the database — interactions by campaign and type, processing counts, and when data was loaded.
          </div>
        </div>
        <div class="hero-right chip-row">
          <span v-if="data" class="chip chip--secondary">Updated {{ fmtStamp(data.generatedAt) }}</span>
          <button class="btn btn--primary" :disabled="loading" @click="load">
            {{ loading ? "Loading…" : "Refresh" }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-tile"><div class="error-title">Error</div><div class="error-text">{{ error }}</div></div>
    <div v-else-if="!data && loading" class="hint" style="padding: 24px">Loading overview…</div>

    <template v-else-if="data">
      <!-- KPI row -->
      <div class="stats" style="margin-bottom: 14px">
        <div class="stat">
          <div class="stat-label">Interactions</div>
          <div class="stat-value">{{ fmtInt(data.totals.interactions) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Transcriptions</div>
          <div class="stat-value">{{ fmtInt(data.totals.transcripts) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Insights</div>
          <div class="stat-value">{{ fmtInt(data.totals.insights) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Embeddings</div>
          <div class="stat-value">{{ fmtInt(data.totals.embeddings) }}</div>
        </div>
      </div>

      <div class="grid grid-2">
        <!-- Pipeline status -->
        <div class="tile">
          <div class="tile-head">
            <IconChip name="status" />
            <div class="tile-text">
              <div class="tile-title">Processing Status</div>
              <div class="tile-desc">Where interactions sit in the transcription → insights pipeline</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!data.byStatus.length">No data.</div>
            <div v-for="s in data.byStatus" :key="s.status" class="metric-row">
              <div class="metric-left"><span :class="statusChip(s.status)">{{ s.status }}</span></div>
              <div class="metric-right"><span class="count-pill">{{ fmtInt(s.count) }}</span></div>
            </div>

            <div class="subcard" style="margin-top: 12px">
              <div class="tile-title" style="font-size: 13px">Errors by source</div>
              <div class="metric-row" style="border: none; padding: 3px 0">
                <div class="metric-left">pipeline (status = error)</div>
                <div class="metric-right"><span class="count-pill">{{ fmtInt(data.errorSources.pipeline) }}</span></div>
              </div>
              <div class="metric-row" style="border: none; padding: 3px 0">
                <div class="metric-left">transcription failures</div>
                <div class="metric-right"><span class="count-pill">{{ fmtInt(data.errorSources.transcription) }}</span></div>
              </div>
              <div class="metric-row" style="border: none; padding: 3px 0">
                <div class="metric-left">LLM failed attempts</div>
                <div class="metric-right"><span class="count-pill">{{ fmtInt(data.errorSources.llm) }}</span></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Loaded by date -->
        <div class="tile">
          <div class="tile-head">
            <IconChip name="loaded-date" />
            <div class="tile-text">
              <div class="tile-title">Data Loaded by Date</div>
              <div class="tile-desc">Interactions created per day — {{ data.loadedByDate.length }} days of history</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!data.loadedByDate.length">No data.</div>
            <div v-else class="ov-bars">
              <div v-for="d in data.loadedByDate" :key="d.date" class="ov-bar-row">
                <div class="ov-bar-date mono">{{ d.date }}</div>
                <div class="ov-bar-track">
                  <div class="ov-bar-fill" :style="{ width: (d.count / maxDayCount * 100) + '%' }" />
                </div>
                <div class="ov-bar-count">{{ fmtInt(d.count) }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top: 14px">
        <!-- Interactions by campaign & type -->
        <div class="tile">
          <div class="tile-head">
            <IconChip name="distribution" />
            <div class="tile-text">
              <div class="tile-title">Interactions by Campaign &amp; Type</div>
              <div class="tile-desc">Every interaction in the DB, grouped by its campaign label and channel</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!campaignMatrix.length">No interactions loaded.</div>
            <div v-else class="ov-scroll">
              <table class="ov-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th class="num">Total</th>
                    <th v-for="t in allTypes" :key="t" class="num" style="text-transform: capitalize">{{ t }}s</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in campaignMatrix" :key="r.campaign">
                    <td><span class="chip chip--secondary">{{ r.campaign }}</span></td>
                    <td class="num"><span class="count-pill">{{ fmtInt(r.total) }}</span></td>
                    <td v-for="t in allTypes" :key="t" class="num">{{ r.counts[t] ? fmtInt(r.counts[t]) : "—" }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Campaign timeline -->
        <div class="tile">
          <div class="tile-head">
            <IconChip name="calendar" />
            <div class="tile-text">
              <div class="tile-title">Campaign Data Windows</div>
              <div class="tile-desc">When each campaign's data was loaded, and the span it covers</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!data.campaignTimeline.length">No data.</div>
            <div v-else class="ov-scroll">
              <table class="ov-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th class="num">Records</th>
                    <th>Loaded</th>
                    <th>Interactions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in data.campaignTimeline" :key="c.campaign">
                    <td><span class="chip chip--secondary">{{ c.campaign }}</span></td>
                    <td class="num"><span class="count-pill">{{ fmtInt(c.count) }}</span></td>
                    <td class="mono">{{ fmtDate(c.firstLoaded) }} → {{ fmtDate(c.lastLoaded) }}</td>
                    <td class="mono">{{ fmtDate(c.firstInteraction) }} → {{ fmtDate(c.lastInteraction) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ov-scroll { overflow-x: auto; }
.ov-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ov-table th, .ov-table td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border, #e5e7eb); }
.ov-table th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted, #6b7280); font-weight: 700; }
.ov-table td.num, .ov-table th.num { text-align: right; }
.ov-table .mono { font-size: 12px; color: var(--ink, #111827); }

.ov-bars { display: flex; flex-direction: column; gap: 4px; max-height: 420px; overflow-y: auto; }
.ov-bar-row { display: flex; align-items: center; gap: 10px; }
.ov-bar-date { width: 92px; flex-shrink: 0; font-size: 12px; color: var(--muted, #6b7280); }
.ov-bar-track { flex: 1; background: var(--surface-2, #eef2f7); border-radius: 4px; height: 16px; overflow: hidden; }
.ov-bar-fill { height: 100%; background: linear-gradient(90deg, #1a3a5c 0%, #2b6cb0 100%); border-radius: 4px; transition: width 0.3s ease; min-width: 2px; }
.ov-bar-count { width: 60px; flex-shrink: 0; text-align: right; font-size: 12px; font-weight: 700; color: var(--ink, #111827); }
</style>
