<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref, watch } from "vue";
import { ApiPath } from "@/enums/api";
import { toPrettyInsights } from "@/utils/insights-response";
import NarrativeBriefing from "@/components/NarrativeBriefing.vue";
import InteractionDetailDrawer from "@/components/InteractionDetailDrawer.vue";
import Sparkline from "@/components/Sparkline.vue";
import { downloadCsv } from "@/utils/csv";

// ── Filters ──────────────────────────────────────────────────────────────────
const campaignOptions = ref<string[]>([]);
const manufactureOptions = ref<string[]>([]);
const modelOptions = ref<string[]>([]);
const dealerOptions = ref<string[]>([]);

const campaign = ref("");
const manufacture = ref("");
const model = ref("");
const dealer = ref("");
const surveyTakenOnly = ref(false);

function isoStartOfDay(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString();
}
function isoEndOfDayExclusive(d: Date) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + 1); return x.toISOString();
}

const now = new Date();
const from = ref(isoStartOfDay(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)));
const to = ref(isoEndOfDayExclusive(now));

const fromDateStr = computed({
  get: () => from.value.slice(0, 10),
  set: (v: string) => { from.value = isoStartOfDay(new Date(v + "T12:00:00")); },
});
const toDateStr = computed({
  get: () => {
    const d = new Date(to.value); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  },
  set: (v: string) => { to.value = isoEndOfDayExclusive(new Date(v + "T12:00:00")); },
});

const sharedParams = computed(() => ({
  from: from.value,
  to: to.value,
  ...(campaign.value && { campaign: campaign.value }),
  ...(manufacture.value && { manufacture: manufacture.value }),
  ...(model.value && { model: model.value }),
  ...(dealer.value && { dealer: dealer.value }),
  ...(surveyTakenOnly.value && { surveyTakenOnly: 'true' }),
}));

// ── Data ─────────────────────────────────────────────────────────────────────
const loading = ref(false);
const error = ref("");

const overview = ref<any>(null);
const categories = ref<any[]>([]);
const interestFactors = ref<any>(null);
const notPurchaseReasons = ref<any>(null);
const competitorPurchases = ref<any[]>([]);
const dealershipRatings = ref<any>(null);
const dealerVisits = ref<any[]>([]);
const modelPerformance = ref<any[]>([]);
const competitorAnalysis = ref<any>(null);
const quarterlyTrends = ref<any[]>([]);
const monthlyTrends = ref<any>(null);
const modelRisk = ref<any[]>([]);
const whyWeLose = ref<any>(null);
const whatsWorking = ref<any>(null);
// Transcript-mined insights (from campaign_transcript_json — beyond the survey).
const transcriptInsights = ref<any>(null);

// Drill-down
const expandedCategory = ref<string | null>(null);
const categoryRecords = ref<any[]>([]);
const loadingCategory = ref(false);

const expandedCompetitor = ref<string | null>(null);
const competitorRecords = ref<any[]>([]);
const loadingCompetitor = ref(false);
const competitorModels = ref<any[]>([]);

// Detail drawer — recordingId handed to the shared InteractionDetailDrawer.
const detailId = ref<string | null>(null);

// Competitive-panel drill-down (shared results list → detail drawer)
const drillKey = ref<string | null>(null);
const drillTitle = ref("");
const drillRecords = ref<any[]>([]);
const loadingDrill = ref(false);

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return "n/a";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function pct(n: number, total: number) {
  if (!total) return "0";
  return Math.round(n / total * 100).toString();
}

// Width as a share of a max value (for bars where the denominator is the
// largest bar rather than a total).
function barPct(n: number, max: number) {
  if (!max) return "0";
  return Math.round(n / max * 100).toString();
}

function maxCount(rows: Array<{ count: number }> | undefined) {
  if (!rows?.length) return 0;
  return Math.max(...rows.map((r) => r.count));
}

function riskColor(rate: number) {
  if (rate >= 40) return "#dc2626";
  if (rate >= 25) return "#ea580c";
  if (rate >= 12) return "#d97706";
  return "#059669";
}

// ── Transcript-insight display helpers ───────────────────────────────────────
const SENTIMENT_META = [
  { key: "positive", label: "Positive", cls: "bar-fill--green" },
  { key: "mixed", label: "Mixed", cls: "bar-fill--amber" },
  { key: "neutral", label: "Neutral", cls: "bar-fill--grey" },
  { key: "negative", label: "Negative", cls: "bar-fill--red" },
  { key: "not_expressed", label: "Not expressed", cls: "bar-fill--grey" },
];
// Returns { total, rows[] } for one sentiment topic (brand | vehicle | dealer).
function sentimentRows(topic: string) {
  const m: Record<string, number> = transcriptInsights.value?.sentiment?.[topic] ?? {};
  const total = Object.values(m).reduce((a, b) => a + (b || 0), 0);
  const rows = SENTIMENT_META.map((s) => ({ ...s, count: m[s.key] ?? 0 })).filter((r) => r.count > 0);
  return { total, rows };
}
// Sort a {label,count}-style measure list descending for display.
function sortedCounts(arr: any[] | undefined): any[] {
  return [...(arr ?? [])].sort((a, b) => b.count - a.count);
}
const SEVERITY_CLS: Record<string, string> = { high: "chip--danger", medium: "chip--warning", low: "" };

// Panel size: collapsed panels show only the top few rows; each can be expanded.
const PANEL_LIMIT = 6;
const expandedPanels = ref<Record<string, boolean>>({});
function panelVisible(list: any[] | undefined, key: string): any[] {
  const arr = list ?? [];
  return expandedPanels.value[key] ? arr : arr.slice(0, PANEL_LIMIT);
}
function togglePanel(key: string) { expandedPanels.value[key] = !expandedPanels.value[key]; }

// ── Monthly trend line charts (hand-rolled inline SVG, no chart lib) ─────────
const LINE_COLORS = [
  "#dc2626", "#ea580c", "#d97706", "#059669", "#0284c7", "#7c3aed",
  "#db2777", "#0d9488", "#4f46e5", "#65a30d", "#c026d3", "#0891b2",
];

function fmtMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[(m || 1) - 1]} ${String(y).slice(2)}`;
}

// Toggles: plot charts as % (share / defection rate) or raw counts.
const brandChartPct = ref(true);
const overallChartPct = ref(true);

type ChartSeries = { label: string; color: string; points: number[]; denom?: number[] };
function buildLineChart(
  series: ChartSeries[],
  months: string[],
  opts: { pctMode?: boolean; labelMode?: 'all' | 'peak' } = {},
) {
  const { pctMode = false, labelMode = 'peak' } = opts;
  const width = 860, height = 280, padL = 36, padR = 14, padT = 18, padB = 46;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const n = months.length;
  const suffix = pctMode ? '%' : '';

  // Plotted value per point (percentage of its denom, or the raw count).
  const plotAt = (s: ChartSeries, i: number): number => {
    const raw = s.points[i] ?? 0;
    if (!pctMode) return raw;
    const d = s.denom?.[i] ?? 0;
    return d ? (raw / d) * 100 : 0;
  };
  let max = 0;
  for (const s of series) for (let i = 0; i < s.points.length; i++) max = Math.max(max, plotAt(s, i));
  max = pctMode ? Math.max(Math.ceil(max / 10) * 10, 10) : Math.max(max, 1);

  const xAt = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v: number) => padT + innerH - (v / max) * innerH;

  const lines = series.map((s) => {
    let peakIdx = 0, peakPlot = -1;
    const pts = s.points.map((raw0, i) => {
      const raw = raw0 ?? 0;
      const plot = plotAt(s, i);
      const denomI = s.denom?.[i] ?? 0;
      const pct = denomI ? Math.round((raw / denomI) * 100) : null;
      if (plot > peakPlot) { peakPlot = plot; peakIdx = i; }
      const label = pctMode
        ? `${pct ?? 0}%`
        : (pct != null ? `${raw} (${pct}%)` : `${raw}`);
      return { x: xAt(i), y: yAt(plot), raw, pct, label, show: false };
    });
    pts.forEach((p, i) => { p.show = labelMode === 'all' ? p.raw > 0 : (i === peakIdx && peakPlot > 0); });
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return { label: s.label, color: s.color, d, pts };
  });

  const step = Math.max(1, Math.ceil(n / 12));
  const xLabels = months
    .map((m, i) => ({ x: xAt(i), label: fmtMonth(m), show: i % step === 0 || i === n - 1 }))
    .filter((l) => l.show);
  const yTicks = [0, 0.5, 1].map((f) => ({ y: padT + innerH - f * innerH, val: Math.round(max * f) + suffix }));
  return { width, height, padL, padR, padT, innerH, lines, xLabels, yTicks, max, n };
}

// Headline-rate sparklines for the overview strip — monthly defection rate and
// Chinese-OEM defection rate, derived from the already-loaded monthly trends.
function rateSeries(numerator: number[] | undefined, denom: number[] | undefined) {
  const d = monthlyTrends.value;
  if (!d?.months?.length || !numerator || !denom) return null;
  const pts = d.months.map((_: string, i: number) => {
    const num = numerator[i] ?? 0;
    const den = denom[i] ?? 0;
    return den ? Math.round((num / den) * 1000) / 10 : 0;
  });
  if (pts.length < 2) return null;
  return { points: pts, first: pts[0] ?? 0, latest: pts[pts.length - 1] ?? 0, months: pts.length };
}
const defectionTrend = computed(() =>
  rateSeries(monthlyTrends.value?.overall?.total_defections, monthlyTrends.value?.overall?.surveyed),
);
const chineseTrend = computed(() =>
  rateSeries(monthlyTrends.value?.overall?.chinese_defections, monthlyTrends.value?.overall?.surveyed),
);
function trendArrow(t: { first: number; latest: number } | null) {
  if (!t) return "";
  if (t.latest > t.first) return "▲";
  if (t.latest < t.first) return "▼";
  return "▶";
}

const chineseBrandChart = computed(() => {
  const d = monthlyTrends.value;
  if (!d?.months?.length || !d.brands?.length) return null;
  const series: ChartSeries[] = d.brands.map((b: any, i: number) => ({
    label: b.brand, color: LINE_COLORS[i % LINE_COLORS.length], points: b.points,
    denom: d.overall.total_defections,
  }));
  return buildLineChart(series, d.months, { pctMode: brandChartPct.value, labelMode: 'peak' });
});

const overallTrendChart = computed(() => {
  const d = monthlyTrends.value;
  if (!d?.months?.length) return null;
  // % mode = as a rate of that month's surveyed volume (defection rate).
  const surveyed = d.overall.surveyed ?? d.overall.total_defections;
  return buildLineChart(
    [
      { label: "All defections", color: "#0284c7", points: d.overall.total_defections, denom: surveyed },
      { label: "Chinese OEM", color: "#dc2626", points: d.overall.chinese_defections, denom: surveyed },
    ],
    d.months,
    { pctMode: overallChartPct.value, labelMode: 'all' },
  );
});

function ratingColor(v: number) {
  if (v >= 4) return "#059669";
  if (v >= 3) return "#0284c7";
  if (v >= 2) return "#ea580c";
  return "#dc2626";
}

// ── API ──────────────────────────────────────────────────────────────────────
async function loadFilterOptions() {
  try {
    const res = await axios.get(ApiPath.SurveyFilters);
    campaignOptions.value = res.data.campaigns ?? [];
    manufactureOptions.value = res.data.manufactures ?? [];
    modelOptions.value = res.data.models ?? [];
    dealerOptions.value = res.data.dealers ?? [];
  } catch { /* non-critical */ }
}

// ── Deep-linkable state: filters ↔ URL query, so a view can be shared/pasted ──
function writeUrlState() {
  const url = new URL(window.location.href);
  const q = url.searchParams;
  const setOrDel = (k: string, v: string) => (v ? q.set(k, v) : q.delete(k));
  setOrDel("campaign", campaign.value);
  setOrDel("make", manufacture.value);
  setOrDel("model", model.value);
  setOrDel("dealer", dealer.value);
  setOrDel("from", fromDateStr.value);
  setOrDel("to", toDateStr.value);
  setOrDel("taken", surveyTakenOnly.value ? "1" : "");
  window.history.replaceState({}, "", url);
}
function readUrlState() {
  const q = new URLSearchParams(window.location.search);
  const g = (k: string) => q.get(k) || "";
  if (g("campaign")) campaign.value = g("campaign");
  if (g("make")) manufacture.value = g("make");
  if (g("model")) model.value = g("model");
  if (g("dealer")) dealer.value = g("dealer");
  if (g("from")) fromDateStr.value = g("from");
  if (g("to")) toDateStr.value = g("to");
  if (q.get("taken") === "1") surveyTakenOnly.value = true;
}

async function loadAll() {
  loading.value = true;
  error.value = "";
  writeUrlState();
  expandedCategory.value = null;
  expandedCompetitor.value = null;
  detailId.value = null;
  drillKey.value = null;

  try {
    const p = sharedParams.value;
    const [ovRes, catRes, intRes, nprRes, compRes, drRes, dvRes, mpRes, caRes, qtRes, mtRes, mrRes, wwlRes, wwRes] = await Promise.all([
      axios.get(ApiPath.SurveyOverview, { params: p }),
      axios.get(ApiPath.SurveyCategories, { params: p }),
      axios.get(ApiPath.SurveyInterestFactors, { params: p }),
      axios.get(ApiPath.SurveyNotPurchaseReasons, { params: p }),
      axios.get(ApiPath.SurveyCompetitorPurchases, { params: p }),
      axios.get(ApiPath.SurveyDealershipRatings, { params: p }),
      axios.get(ApiPath.SurveyDealerVisits, { params: p }),
      axios.get(ApiPath.SurveyModelPerformance, { params: p }),
      axios.get(ApiPath.SurveyCompetitorAnalysis, { params: p }),
      axios.get(ApiPath.SurveyQuarterlyTrends, { params: p }),
      axios.get(ApiPath.SurveyMonthlyTrends, { params: p }),
      axios.get(ApiPath.SurveyModelRisk, { params: p }),
      axios.get(ApiPath.SurveyWhyWeLose, { params: p }),
      axios.get(ApiPath.SurveyWhatsWorking, { params: p }),
    ]);
    overview.value = ovRes.data;
    categories.value = catRes.data;
    interestFactors.value = intRes.data;
    notPurchaseReasons.value = nprRes.data;
    competitorPurchases.value = compRes.data;
    dealershipRatings.value = drRes.data;
    dealerVisits.value = dvRes.data;
    modelPerformance.value = mpRes.data;
    competitorAnalysis.value = caRes.data;
    quarterlyTrends.value = qtRes.data;
    monthlyTrends.value = mtRes.data;
    modelRisk.value = mrRes.data;
    whyWeLose.value = wwlRes.data;
    whatsWorking.value = wwRes.data;

    // Transcript insights are fetched separately and fail-soft: the underlying
    // campaign_transcript_json column / data may not exist yet, and a 500 here
    // must not take down the rest of the survey dashboard.
    try {
      transcriptInsights.value = (await axios.get(ApiPath.SurveyTranscriptInsights, { params: p })).data;
    } catch {
      transcriptInsights.value = null;
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load";
  } finally {
    loading.value = false;
  }
}

async function toggleCategory(cat: string) {
  if (expandedCategory.value === cat) { expandedCategory.value = null; return; }
  expandedCategory.value = cat;
  loadingCategory.value = true;
  try {
    const res = await axios.get(ApiPath.SurveyRecordsByCategory, { params: { ...sharedParams.value, category: cat, limit: 200 } });
    categoryRecords.value = res.data;
  } catch { categoryRecords.value = []; }
  finally { loadingCategory.value = false; }
}

async function toggleCompetitor(make: string) {
  if (expandedCompetitor.value === make) { expandedCompetitor.value = null; return; }
  expandedCompetitor.value = make;
  loadingCompetitor.value = true;
  try {
    const [recRes, modRes] = await Promise.all([
      axios.get(ApiPath.SurveyRecordsByCompetitor, { params: { ...sharedParams.value, make, limit: 200 } }),
      axios.get(ApiPath.SurveyCompetitorModels, { params: { ...sharedParams.value, make } }),
    ]);
    competitorRecords.value = recRes.data;
    competitorModels.value = modRes.data;
  } catch { competitorRecords.value = []; competitorModels.value = []; }
  finally { loadingCompetitor.value = false; }
}

// The record detail + "Ask AI" now live in the shared InteractionDetailDrawer
// (same drawer as Operations / Client Services). openDetail just sets the
// recordingId; the drawer fetches its own data via getInteractionDetail.
function openDetail(id: string | number) {
  detailId.value = String(id);
}

function closeDetail() { detailId.value = null; }

// Export the currently-loaded drill records to CSV (client-side). Projects the
// stable, human-useful columns in a sensible order.
function exportDrillCsv() {
  if (!drillRecords.value.length) return;
  const cols = [
    "interaction_id", "interaction_tps_id", "id_opportunity", "manufacture", "model",
    "dealer", "allocation_date", "result_code_desc", "survey_flow_status",
    "purchased_make", "purchased_model", "purchased_other_model", "purchased_new_used",
    "purchase_reason", "agent_notes", "evidence",
  ];
  const rows = drillRecords.value.map((r: any) =>
    Object.fromEntries(cols.map((c) => [c, r[c] ?? ""])),
  );
  const safeName = (drillTitle.value || "survey-records").replace(/[^\w.-]+/g, "_").slice(0, 80);
  downloadCsv(safeName, rows, cols);
}

// Open a drill list for any stat-tile selection. Toggling the same key closes
// it. Records reuse the existing detail drawer via openDetail(). `endpoint`
// selects the survey-answer drill (default) or the transcript drill — both
// return the same row shape so the modal + drawer are identical.
async function openDrill(
  key: string,
  title: string,
  params: Record<string, any>,
  endpoint: string = ApiPath.SurveyDrillRecords,
) {
  if (drillKey.value === key) { drillKey.value = null; return; }
  drillKey.value = key;
  drillTitle.value = title;
  loadingDrill.value = true;
  drillRecords.value = [];
  try {
    const res = await axios.get(endpoint, {
      params: { ...sharedParams.value, ...params, limit: 200 },
    });
    drillRecords.value = res.data;
  } catch { drillRecords.value = []; }
  finally { loadingDrill.value = false; }
}
// Transcript-tile drill (campaign_transcript_json). Thin wrapper over openDrill.
function openTranscriptDrill(key: string, title: string, params: Record<string, any>) {
  return openDrill(key, title, params, ApiPath.SurveyTranscriptDrillRecords);
}
function closeDrill() { drillKey.value = null; drillRecords.value = []; }

// Date range (ISO) for a "YYYY Q#" label, so a quarterly-trend row can drill
// into that quarter's records by overriding the shared from/to.
function quarterRange(quarter: string): { from: string; to: string } | null {
  const m = /(\d{4})\s*Q([1-4])/.exec(quarter);
  if (!m) return null;
  const year = parseInt(m[1]!, 10);
  const q = parseInt(m[2]!, 10);
  const startMonth = (q - 1) * 3; // 0-indexed
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 1); // exclusive
  return { from: start.toISOString(), to: end.toISOString() };
}
// Drill a quarterly-trend row into that quarter's defections (date-range override).
function drillQuarter(quarter: string) {
  const r = quarterRange(quarter);
  if (!r) return;
  openDrill(`q:${quarter}`, `${quarter} — defections`, { ...r, defectedOnly: 'true' });
}

// ── Narrative generation ─────────────────────────────────────────────────────
const narrativeProvider = ref("openai");
const narrativeModel = ref("");
const loadingNarrative = ref(false);
const narrative = ref<any>(null);        // parsed structured briefing (rich render)
const narrativeResultText = ref("");      // fallback pretty text if shape is unexpected
const narrativeError = ref("");
// The rich briefing render (hero, KPIs, competitor leaderboard, etc.) and its
// helpers live in the shared <NarrativeBriefing> component so the Narratives
// page renders saved briefings identically.

// A capable model materially improves the executive briefing. Options mirror the
// batch dashboard; "" = the provider's default. Reset on provider change.
const NARR_MODEL_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  openai: [
    { value: "", label: "Default — gpt-4o-mini (fast)" },
    { value: "gpt-4o", label: "gpt-4o (higher quality)" },
  ],
  anthropic: [
    { value: "", label: "Default — claude-haiku-4-5 (fast)" },
    { value: "claude-sonnet-5", label: "claude-sonnet-5 (higher quality)" },
    { value: "claude-opus-4-8", label: "claude-opus-4-8 (highest quality)" },
  ],
  grok: [{ value: "", label: "Default — grok-4-1-fast" }],
  gemini: [
    { value: "", label: "Default — gemini-1.5-flash (fast)" },
    { value: "gemini-1.5-pro", label: "gemini-1.5-pro (higher quality)" },
  ],
};
const narrativeModelOptions = computed(
  () => NARR_MODEL_OPTIONS[narrativeProvider.value] ?? [{ value: "", label: "Default" }]
);
watch(narrativeProvider, () => { narrativeModel.value = ""; });

async function generateNarrative() {
  loadingNarrative.value = true;
  narrativeError.value = "";
  narrative.value = null;
  narrativeResultText.value = "";
  try {
    const res = await axios.post(ApiPath.InsightsSummaryNarrative, null, {
      params: {
        from: from.value,
        to: to.value,
        filterKey: "all",
        provider: narrativeProvider.value,
        narrativeType: "survey_analytics",
        ...(narrativeModel.value && { model: narrativeModel.value }),
        ...(campaign.value && { campaign: campaign.value }),
      },
    });
    const n = res.data?.narrative ?? res.data;
    if (n && typeof n === "object" && !Array.isArray(n)) {
      narrative.value = n;
    } else {
      narrativeResultText.value = toPrettyInsights(n);
    }
  } catch (e: any) {
    narrativeError.value = e?.response?.data?.message || e?.message || "Failed to generate narrative";
  } finally {
    loadingNarrative.value = false;
  }
}

onMounted(async () => { readUrlState(); await loadFilterOptions(); await loadAll(); });
</script>

<template>
  <div class="sv-root">
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <h1 class="hero-title">Survey Analytics</h1>
          <div class="hero-subtitle">Structured survey data: purchase intent, competitor switching, dealership experience and interest drivers.</div>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="tile tile--accent">
      <div class="tile-head">
        <div class="tile-icon">&#9881;</div>
        <div class="tile-text">
          <div class="tile-title">Filters</div>
          <div class="tile-desc">Select date range and optionally filter by campaign, manufacturer, model or dealer</div>
        </div>
      </div>
      <div class="tile-body">
        <div class="filters-row">
          <div class="filter-group">
            <label class="label">From</label>
            <input type="date" v-model="fromDateStr" class="input input--date" />
          </div>
          <div class="filter-group">
            <label class="label">To</label>
            <input type="date" v-model="toDateStr" class="input input--date" />
          </div>
          <div class="filter-group">
            <label class="label">Campaign</label>
            <select v-model="campaign" class="select select--sm">
              <option value="">All</option>
              <option v-for="c in campaignOptions" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="label">Manufacturer</label>
            <select v-model="manufacture" class="select select--sm">
              <option value="">All</option>
              <option v-for="m in manufactureOptions" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="label">Model</label>
            <select v-model="model" class="select select--sm">
              <option value="">All</option>
              <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="label">Dealer</label>
            <select v-model="dealer" class="select select--sm">
              <option value="">All</option>
              <option v-for="d in dealerOptions" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="label">&nbsp;</label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="surveyTakenOnly" />
              Survey Taken only
            </label>
          </div>
          <button class="btn btn--primary" style="margin-top: 18px" :disabled="loading" @click="loadAll">
            {{ loading ? "Loading..." : "Load" }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-tile" style="margin-top: 10px">{{ error }}</div>

    <template v-if="overview">
      <!-- Overview strip (each tile drills to its records) -->
      <div class="stats-strip">
        <div class="stat stat--click" @click="openDrill('ov:total', 'All survey records', {})">
          <div class="stat-label">Total Records</div><div class="stat-value">{{ overview.total }}</div>
        </div>
        <div class="stat stat--click" @click="openDrill('ov:taken', 'Survey Taken', { flowStatus: 'Survey Taken' })">
          <div class="stat-label">Survey Taken</div><div class="stat-value chip chip--success">{{ overview.survey_taken }}</div>
        </div>
        <div class="stat stat--click" @click="openDrill('ov:nottaken', 'Survey Not Taken', { flowStatus: 'Survey Not Taken' })">
          <div class="stat-label">Survey Not Taken</div><div class="stat-value chip chip--secondary">{{ overview.survey_not_taken }}</div>
        </div>
        <div class="stat stat--click" @click="openDrill('ov:won', 'Bought client brand (won)', { wonOnly: 'true' })">
          <div class="stat-label">Bought Client Brand</div><div class="stat-value chip chip--success">{{ overview.won }}</div>
        </div>
        <div class="stat stat--click" @click="openDrill('ov:defected', 'Defected to a competitor', { defectedOnly: 'true' })">
          <div class="stat-label">Defected (Competitor)</div><div class="stat-value chip chip--danger">{{ overview.defected }}</div>
        </div>
        <div class="stat stat--click" @click="openDrill('ov:considering', 'Still considering', { stillConsidering: 'true' })">
          <div class="stat-label">Still Considering</div><div class="stat-value chip chip--info">{{ overview.still_considering }}</div>
        </div>
      </div>

      <!-- Headline-rate trends (monthly sparklines) -->
      <div v-if="defectionTrend || chineseTrend" class="spark-strip">
        <div v-if="defectionTrend" class="spark-card">
          <div class="spark-head">
            <span class="spark-title">Defection rate trend</span>
            <span class="spark-latest">{{ defectionTrend.latest }}% <span :class="defectionTrend.latest > defectionTrend.first ? 'spark-up' : 'spark-down'">{{ trendArrow(defectionTrend) }}</span></span>
          </div>
          <Sparkline :points="defectionTrend.points" color="#dc2626" :width="150" :height="30" />
          <div class="spark-sub">{{ defectionTrend.first }}% → {{ defectionTrend.latest }}% over {{ defectionTrend.months }} months</div>
        </div>
        <div v-if="chineseTrend" class="spark-card">
          <div class="spark-head">
            <span class="spark-title">Chinese-OEM defection rate</span>
            <span class="spark-latest">{{ chineseTrend.latest }}% <span :class="chineseTrend.latest > chineseTrend.first ? 'spark-up' : 'spark-down'">{{ trendArrow(chineseTrend) }}</span></span>
          </div>
          <Sparkline :points="chineseTrend.points" color="#ea580c" :width="150" :height="30" />
          <div class="spark-sub">{{ chineseTrend.first }}% → {{ chineseTrend.latest }}% over {{ chineseTrend.months }} months</div>
        </div>
      </div>

      <!-- Category breakdown + Model performance -->
      <div class="grid grid-2" style="margin-top: 14px">
        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#128203;</div>
            <div class="tile-text">
              <div class="tile-title">Outcome Categories</div>
              <div class="tile-desc">Click a category to see individual records</div>
            </div>
          </div>
          <div class="tile-body">
            <div v-for="c in panelVisible(categories, 'categories')" :key="c.category">
              <div class="metric-row metric-row--clickable" @click="toggleCategory(c.category)">
                <div class="metric-left"><span class="chip chip--secondary">{{ c.category }}</span></div>
                <div class="metric-right">
                  <span class="count-pill">{{ c.count }}</span>
                  <span class="pct-label">{{ pct(c.count, overview.total) }}%</span>
                  <span class="expand-icon">{{ expandedCategory === c.category ? '&#9650;' : '&#9660;' }}</span>
                </div>
              </div>
              <div v-if="expandedCategory === c.category" class="drill-panel">
                <div v-if="loadingCategory" class="hint">Loading...</div>
                <div v-else-if="!categoryRecords.length" class="hint">No records.</div>
                <div v-else v-for="r in categoryRecords" :key="r.interaction_id ?? r.id_opportunity" class="drill-row" @click="openDetail(r.interaction_id ?? r.id_opportunity)">
                  <div class="drill-row-top">
                    <span class="chip chip--secondary" style="font-size: 11px">{{ r.model || 'n/a' }}</span>
                    <span class="chip chip--secondary" style="font-size: 11px">{{ r.dealer || 'n/a' }}</span>
                    <span v-if="r.purchased_make" class="chip chip--warning" style="font-size: 11px">Bought: {{ r.purchased_make }}</span>
                    <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(r.allocation_date) }}</span>
                  </div>
                  <div class="drill-row-summary">{{ r.agent_notes || r.p2_has_not_purchased_yet || "(no notes)" }}</div>
                </div>
              </div>
            </div>
            <button v-if="categories.length > PANEL_LIMIT" class="panel-toggle" @click="togglePanel('categories')">
              {{ expandedPanels['categories'] ? 'Show less ▲' : `Show all ${categories.length} ▼` }}
            </button>
          </div>
        </div>

        <!-- Model Performance -->
        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#128663;</div>
            <div class="tile-text">
              <div class="tile-title">Model Performance</div>
              <div class="tile-desc">Enquired models: still considering vs purchased elsewhere</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!modelPerformance.length">No data.</div>
            <div
              v-for="m in panelVisible(modelPerformance, 'models')"
              :key="m.model"
              class="model-row model-row--click"
              @click="openDrill(`mp:${m.model}`, `${m.model} — survey records`, { drillModel: m.model })"
            >
              <div class="model-name">{{ m.model }}</div>
              <div class="model-stats">
                <span class="chip chip--secondary" style="font-size: 11px">{{ m.total }} total</span>
                <span class="chip chip--info" style="font-size: 11px">{{ m.still_considering }} considering</span>
                <span v-if="m.purchased_elsewhere" class="chip chip--danger" style="font-size: 11px">{{ m.purchased_elsewhere }} lost</span>
                <span class="chip chip--success" style="font-size: 11px">{{ m.survey_taken }} surveyed</span>
              </div>
              <!-- Mini bar -->
              <div class="model-bar-track">
                <div class="model-bar model-bar--considering" :style="{ width: pct(m.still_considering, m.total) + '%' }" />
                <div class="model-bar model-bar--lost" :style="{ width: pct(m.purchased_elsewhere, m.total) + '%' }" />
              </div>
            </div>
            <button v-if="modelPerformance.length > PANEL_LIMIT" class="panel-toggle" @click="togglePanel('models')">
              {{ expandedPanels['models'] ? 'Show less ▲' : `Show all ${modelPerformance.length} ▼` }}
            </button>
          </div>
        </div>
      </div>

      <!-- Interest factors + Not-purchase reasons -->
      <div class="grid grid-2" style="margin-top: 14px">
        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#11088;</div>
            <div class="tile-text">
              <div class="tile-title">Initial Interest Factors</div>
              <div class="tile-desc">What attracted customers ({{ interestFactors?.surveyed ?? 0 }} surveyed)</div>
            </div>
          </div>
          <div class="tile-body">
            <div
              v-if="interestFactors"
              v-for="f in interestFactors.factors"
              :key="f.factor"
              class="bar-row bar-row--click"
              @click="openDrill(`if:${f.key}`, `Interested in — ${f.factor}`, { interestFactor: f.key })"
            >
              <div class="bar-label">{{ f.factor }}</div>
              <div class="bar-track">
                <div class="bar-fill bar-fill--blue" :style="{ width: pct(f.count, interestFactors.surveyed) + '%' }" />
              </div>
              <div class="bar-value">{{ f.count }} <span class="pct-label">{{ pct(f.count, interestFactors.surveyed) }}%</span></div>
            </div>
          </div>
        </div>

        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#128683;</div>
            <div class="tile-text">
              <div class="tile-title">Not-Purchase Reasons</div>
              <div class="tile-desc">Why customers did not buy ({{ notPurchaseReasons?.surveyed ?? 0 }} surveyed)</div>
            </div>
          </div>
          <div class="tile-body">
            <template v-if="notPurchaseReasons">
              <div v-for="r in notPurchaseReasons.reasons" :key="r.key" class="npr-group">
                <div
                  class="bar-row bar-row--click"
                  @click="openDrill(`npr:${r.key}`, `Not purchased — ${r.reason}`, { notPurchaseReason: r.key })"
                >
                  <div class="bar-label">{{ r.reason }}</div>
                  <div class="bar-track">
                    <div class="bar-fill bar-fill--red" :style="{ width: pct(r.count, notPurchaseReasons.surveyed) + '%' }" />
                  </div>
                  <div class="bar-value">{{ r.count }} <span class="pct-label">{{ pct(r.count, notPurchaseReasons.surveyed) }}%</span></div>
                </div>
                <!-- Sub-reasons (second level) — click to drill to those records -->
                <div v-if="r.subReasons && r.subReasons.length" class="npr-subs">
                  <div
                    v-for="s in r.subReasons"
                    :key="s.value"
                    class="npr-sub"
                    @click="openDrill(`npr:${r.key}:${s.value}`, `${r.reason}: ${s.value}`, { notPurchaseReason: r.key, notPurchaseSubReason: s.value })"
                  >
                    <span class="npr-sub-label">&#8627; {{ s.value }}</span>
                    <span class="count-pill" style="font-size: 11px">{{ s.count }}</span>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Competitor Purchases + Dealership Ratings -->
      <div class="grid grid-2" style="margin-top: 14px">
        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#9878;</div>
            <div class="tile-text">
              <div class="tile-title">Competitor Purchases</div>
              <div class="tile-desc">Click a make to see models and individual records</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!competitorPurchases.length">No data.</div>
            <div v-for="c in panelVisible(competitorPurchases, 'competitors')" :key="c.make">
              <div class="metric-row metric-row--clickable" @click="toggleCompetitor(c.make)">
                <div class="metric-left"><span class="chip chip--warning">{{ c.make }}</span></div>
                <div class="metric-right">
                  <span class="count-pill">{{ c.count }}</span>
                  <span class="expand-icon">{{ expandedCompetitor === c.make ? '&#9650;' : '&#9660;' }}</span>
                </div>
              </div>
              <div v-if="expandedCompetitor === c.make" class="drill-panel">
                <div v-if="loadingCompetitor" class="hint">Loading...</div>
                <template v-else>
                  <!-- Model sub-breakdown -->
                  <div v-if="competitorModels.length" style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border)">
                    <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 4px">Models purchased</div>
                    <div v-for="m in competitorModels" :key="m.model" style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 2px">
                      <span>{{ m.model }}</span>
                      <span class="count-pill" style="font-size: 11px">{{ m.count }}</span>
                    </div>
                  </div>
                  <!-- Individual records -->
                  <div v-if="!competitorRecords.length" class="hint">No records.</div>
                  <div v-else v-for="r in competitorRecords" :key="r.interaction_id ?? r.id_opportunity" class="drill-row" @click="openDetail(r.interaction_id ?? r.id_opportunity)">
                    <div class="drill-row-top">
                      <span class="chip chip--secondary" style="font-size: 11px">Enquired: {{ r.model || 'n/a' }}</span>
                      <span class="chip chip--warning" style="font-size: 11px">Bought: {{ r.purchased_model || r.purchased_other_model || 'n/a' }}</span>
                      <span v-if="r.purchased_new_used" class="chip chip--secondary" style="font-size: 11px">{{ r.purchased_new_used }}</span>
                      <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(r.allocation_date) }}</span>
                    </div>
                    <div class="drill-row-summary">{{ r.purchase_reason || r.agent_notes || "(no notes)" }}</div>
                  </div>
                </template>
              </div>
            </div>
            <button v-if="competitorPurchases.length > PANEL_LIMIT" class="panel-toggle" @click="togglePanel('competitors')">
              {{ expandedPanels['competitors'] ? 'Show less ▲' : `Show all ${competitorPurchases.length} ▼` }}
            </button>
          </div>
        </div>

        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#127919;</div>
            <div class="tile-text">
              <div class="tile-title">Dealership Ratings</div>
              <div class="tile-desc">Customer ratings (1-5) from survey responses</div>
            </div>
          </div>
          <div class="tile-body">
            <div v-if="!dealershipRatings" class="hint">No data.</div>
            <template v-else>
              <!-- Rating distribution -->
              <div style="display: flex; gap: 8px; margin-bottom: 14px">
                <div
                  v-for="d in dealershipRatings.distribution"
                  :key="d.rating"
                  class="rating-block rating-block--click"
                  @click="openDrill(`rating:${d.rating}`, `Dealership rated ${d.rating}★`, { ratingScore: d.rating })"
                >
                  <div class="rating-star" :style="{ color: ratingColor(d.rating) }">{{ d.rating }}&#9733;</div>
                  <div class="rating-count">{{ d.count }}</div>
                </div>
              </div>
              <!-- By dealer -->
              <div v-if="dealershipRatings.by_dealer.length">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px">By Dealer (min 2 ratings)</div>
                <div
                  v-for="d in panelVisible(dealershipRatings.by_dealer, 'dealers')"
                  :key="d.dealer"
                  class="metric-row metric-row--clickable"
                  style="margin-bottom: 4px"
                  @click="openDrill(`dealer:${d.dealer}`, `${d.dealer} — rated records`, { dealer: d.dealer, ratedOnly: 'true' })"
                >
                  <div class="metric-left" style="flex: 1; font-size: 12px">{{ d.dealer }}</div>
                  <div class="metric-right">
                    <span class="chip" :style="{ background: ratingColor(d.avg_rating), color: '#fff', fontSize: '11px' }">{{ d.avg_rating }}&#9733;</span>
                    <span class="count-pill">{{ d.count }}</span>
                  </div>
                </div>
                <button v-if="dealershipRatings.by_dealer.length > PANEL_LIMIT" class="panel-toggle" @click="togglePanel('dealers')">
                  {{ expandedPanels['dealers'] ? 'Show less ▲' : `Show all ${dealershipRatings.by_dealer.length} ▼` }}
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Dealer visit outcomes -->
      <div v-if="dealerVisits.length" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#127970;</div>
          <div class="tile-text">
            <div class="tile-title">Dealer Visit Outcomes</div>
            <div class="tile-desc">Did the customer visit? Did they test drive?</div>
          </div>
        </div>
        <div class="tile-body">
          <div style="display: flex; gap: 12px; flex-wrap: wrap">
            <div
              v-for="v in dealerVisits"
              :key="v.visit_type"
              class="visit-chip visit-chip--click"
              @click="openDrill(`dv:${v.visit_type}`, `Dealer visit — ${v.visit_type}`, { dealerVisit: v.visit_type })"
            >
              <div class="visit-label">{{ v.visit_type }}</div>
              <div class="visit-count">{{ v.count }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Competitive intelligence ═══════════════════════════════════════ -->
      <div class="section-divider">Competitive Intelligence</div>

      <!-- Competitor league + Chinese OEM threat -->
      <div v-if="competitorAnalysis" class="grid grid-2" style="margin-top: 14px">
        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#9878;</div>
            <div class="tile-text">
              <div class="tile-title">Competitor League</div>
              <div class="tile-desc">Where lost customers went ({{ competitorAnalysis.total_defections }} defections) &mdash; &#127464;&#127475; marks Chinese / Chinese-owned OEMs</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!competitorAnalysis.brands.length">No competitor defections in scope.</div>
            <div
              v-for="b in panelVisible(competitorAnalysis.brands, 'league')"
              :key="b.make"
              class="bar-row bar-row--click"
              @click="openDrill(`comp:${b.make}`, `Defected to ${b.make}`, { competitorMake: b.make, defectedOnly: 'true' })"
            >
              <div class="bar-label">
                {{ b.make }}
                <span v-if="b.chinese" class="cn-chip" title="Chinese / Chinese-owned OEM">&#127464;&#127475; Chinese</span>
              </div>
              <div class="bar-track">
                <div class="bar-fill" :class="b.chinese ? 'bar-fill--amber' : 'bar-fill--grey'" :style="{ width: barPct(b.count, maxCount(competitorAnalysis.brands)) + '%' }" />
              </div>
              <div class="bar-value">{{ b.count }} <span class="pct-label">{{ pct(b.count, competitorAnalysis.total_defections) }}%</span></div>
            </div>
            <button v-if="competitorAnalysis.brands.length > PANEL_LIMIT" class="panel-toggle" @click="togglePanel('league')">
              {{ expandedPanels['league'] ? 'Show less ▲' : `Show all ${competitorAnalysis.brands.length} ▼` }}
            </button>
          </div>
        </div>

        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#127464;&#127475;</div>
            <div class="tile-text">
              <div class="tile-title">Chinese OEM Threat</div>
              <div class="tile-desc">Share of defections going to Chinese / Chinese-owned brands</div>
            </div>
          </div>
          <div class="tile-body">
            <div
              class="chinese-headline chinese-headline--click"
              @click="openDrill('cn:all', 'Defected to a Chinese / Chinese-owned OEM', { chineseOnly: 'true', defectedOnly: 'true' })"
            >
              <div class="chinese-share">{{ competitorAnalysis.chinese_share }}%</div>
              <div class="chinese-sub">{{ competitorAnalysis.chinese_defections }} of {{ competitorAnalysis.total_defections }} defections &middot; click to view</div>
            </div>
            <div class="chinese-track">
              <div class="chinese-bar" :style="{ width: competitorAnalysis.chinese_share + '%' }" />
            </div>
            <div v-if="competitorAnalysis.chinese_brands.length" style="margin-top: 12px">
              <div class="mini-head">Chinese brands taking customers</div>
              <div style="display: flex; flex-wrap: wrap; gap: 6px">
                <span
                  v-for="b in competitorAnalysis.chinese_brands"
                  :key="b.make"
                  class="chip chip--danger chip--click"
                  style="font-size: 11px"
                  @click="openDrill(`cn:${b.make}`, `Defected to ${b.make}`, { competitorMake: b.make, defectedOnly: 'true' })"
                >{{ b.make }} &middot; {{ b.count }}</span>
              </div>
            </div>
            <div v-else class="hint" style="margin-top: 12px">No Chinese-OEM defections in scope.</div>
          </div>
        </div>
      </div>

      <!-- Quarterly trend -->
      <div v-if="quarterlyTrends.length" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128200;</div>
          <div class="tile-text">
            <div class="tile-title">Quarter-on-Quarter Trend</div>
            <div class="tile-desc">Surveyed volume, defections and Chinese-OEM share by quarter</div>
          </div>
        </div>
        <div class="tile-body">
          <div class="trend-table">
            <div class="trend-head">
              <div>Quarter</div><div>Surveyed</div><div>Defections</div><div>Chinese share</div><div>Top competitor</div><div>Top Chinese competitor</div>
            </div>
            <div v-for="q in quarterlyTrends" :key="q.quarter" class="trend-row trend-row--click" @click="drillQuarter(q.quarter)">
              <div class="trend-q">{{ q.quarter }}</div>
              <div>{{ q.total }}</div>
              <div>{{ q.defections }} <span class="pct-label">{{ pct(q.defections, q.total) }}%</span></div>
              <div>
                <div class="chinese-track chinese-track--sm">
                  <div class="chinese-bar" :style="{ width: q.chinese_share + '%' }" />
                </div>
                <span class="pct-label">{{ q.chinese_share }}% ({{ q.chinese_defections }})</span>
              </div>
              <div>
                <span v-if="q.top_competitor" class="chip chip--warning" style="font-size: 11px">{{ q.top_competitor }}</span>
                <span v-if="q.top_competitor" class="pct-label">{{ q.top_competitor_share }}% ({{ q.top_competitor_count }})</span>
                <span v-else class="hint">&mdash;</span>
              </div>
              <div>
                <span v-if="q.top_chinese_competitor" class="chip chip--danger" style="font-size: 11px">{{ q.top_chinese_competitor }}</span>
                <span v-if="q.top_chinese_competitor" class="pct-label">{{ q.top_chinese_competitor_share }}% ({{ q.top_chinese_competitor_count }})</span>
                <span v-else class="hint">&mdash;</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Monthly trend: Chinese brands as separate lines -->
      <div v-if="chineseBrandChart" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128200;</div>
          <div class="tile-text">
            <div class="tile-title">Monthly Defections by Chinese OEM</div>
            <div class="tile-desc">Each Chinese / Chinese-owned brand across the selected period — {{ brandChartPct ? '% of that month’s defections' : 'defection counts' }}. Labels mark each brand’s peak.</div>
          </div>
          <div class="chart-toggle">
            <button :class="{ 'chart-toggle-on': brandChartPct }" @click="brandChartPct = true">%</button>
            <button :class="{ 'chart-toggle-on': !brandChartPct }" @click="brandChartPct = false">Count</button>
          </div>
        </div>
        <div class="tile-body">
          <div class="chart-scroll">
            <svg :viewBox="`0 0 ${chineseBrandChart.width} ${chineseBrandChart.height}`" class="linechart" preserveAspectRatio="xMidYMid meet">
              <g v-for="t in chineseBrandChart.yTicks" :key="'y' + t.val">
                <line :x1="chineseBrandChart.padL" :x2="chineseBrandChart.width - chineseBrandChart.padR" :y1="t.y" :y2="t.y" class="chart-grid" />
                <text :x="chineseBrandChart.padL - 6" :y="t.y + 3" class="chart-axis" text-anchor="end">{{ t.val }}</text>
              </g>
              <text v-for="(x, i) in chineseBrandChart.xLabels" :key="'x' + i" :x="x.x" :y="chineseBrandChart.height - 26" class="chart-axis" text-anchor="middle">{{ x.label }}</text>
              <template v-for="l in chineseBrandChart.lines" :key="l.label">
                <path :d="l.d" fill="none" :stroke="l.color" stroke-width="2" stroke-linejoin="round" />
                <circle v-for="(p, pi) in l.pts" :key="pi" :cx="p.x" :cy="p.y" r="2.6" :fill="l.color" />
                <text v-for="(p, pi) in l.pts.filter((pp) => pp.show)" :key="'l' + pi" :x="p.x" :y="p.y - 6" class="chart-point" text-anchor="middle" :fill="l.color">{{ l.label }} {{ p.label }}</text>
              </template>
            </svg>
          </div>
          <div class="chart-legend">
            <span v-for="l in chineseBrandChart.lines" :key="l.label" class="legend-item">
              <span class="legend-dot" :style="{ background: l.color }" />{{ l.label }}
            </span>
          </div>
        </div>
      </div>

      <!-- Monthly trend: overall -->
      <div v-if="overallTrendChart" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128201;</div>
          <div class="tile-text">
            <div class="tile-title">Monthly Defections — Overall</div>
            <div class="tile-desc">All competitor defections vs the Chinese-OEM subset, month by month — {{ overallChartPct ? '% of surveyed (defection rate)' : 'counts' }}</div>
          </div>
          <div class="chart-toggle">
            <button :class="{ 'chart-toggle-on': overallChartPct }" @click="overallChartPct = true">%</button>
            <button :class="{ 'chart-toggle-on': !overallChartPct }" @click="overallChartPct = false">Count</button>
          </div>
        </div>
        <div class="tile-body">
          <div class="chart-scroll">
            <svg :viewBox="`0 0 ${overallTrendChart.width} ${overallTrendChart.height}`" class="linechart" preserveAspectRatio="xMidYMid meet">
              <g v-for="t in overallTrendChart.yTicks" :key="'y' + t.val">
                <line :x1="overallTrendChart.padL" :x2="overallTrendChart.width - overallTrendChart.padR" :y1="t.y" :y2="t.y" class="chart-grid" />
                <text :x="overallTrendChart.padL - 6" :y="t.y + 3" class="chart-axis" text-anchor="end">{{ t.val }}</text>
              </g>
              <text v-for="(x, i) in overallTrendChart.xLabels" :key="'x' + i" :x="x.x" :y="overallTrendChart.height - 26" class="chart-axis" text-anchor="middle">{{ x.label }}</text>
              <template v-for="l in overallTrendChart.lines" :key="l.label">
                <path :d="l.d" fill="none" :stroke="l.color" stroke-width="2.5" stroke-linejoin="round" />
                <circle v-for="(p, pi) in l.pts" :key="pi" :cx="p.x" :cy="p.y" r="3" :fill="l.color" />
                <text v-for="(p, pi) in l.pts.filter((pp) => pp.show)" :key="'l' + pi" :x="p.x" :y="p.y - 7" class="chart-point" text-anchor="middle" :fill="l.color">{{ p.label }}</text>
              </template>
            </svg>
          </div>
          <div class="chart-legend">
            <span v-for="l in overallTrendChart.lines" :key="l.label" class="legend-item">
              <span class="legend-dot" :style="{ background: l.color }" />{{ l.label }}
            </span>
          </div>
        </div>
      </div>

      <!-- Model risk -->
      <div v-if="modelRisk.length" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#9888;</div>
          <div class="tile-text">
            <div class="tile-title">Model Risk Ranking</div>
            <div class="tile-desc">Enquired models ranked by defection rate (min 3 records)</div>
          </div>
        </div>
        <div class="tile-body">
          <div class="risk-table">
            <div class="risk-head">
              <div>Model</div><div>Defection rate</div><div>Lost / total</div><div>Top competitor</div><div>Chinese</div><div>Top reason</div>
            </div>
            <div
              v-for="m in panelVisible(modelRisk, 'risk')"
              :key="m.model"
              class="risk-row risk-row--click"
              @click="openDrill(`model:${m.model}`, `${m.model} — defected to competitors`, { drillModel: m.model, defectedOnly: 'true' })"
            >
              <div class="risk-model">{{ m.model }}</div>
              <div>
                <span class="risk-pill" :style="{ background: riskColor(m.defection_rate) }">{{ m.defection_rate }}%</span>
              </div>
              <div>{{ m.defections }} / {{ m.total }}</div>
              <div><span v-if="m.top_competitor" class="chip chip--warning" style="font-size: 11px">{{ m.top_competitor }}</span><span v-else class="hint">&mdash;</span></div>
              <div><span v-if="m.chinese_share" class="chip chip--danger" style="font-size: 11px">{{ m.chinese_share }}%</span><span v-else class="hint">&mdash;</span></div>
              <div><span v-if="m.top_reason" class="chip chip--secondary" style="font-size: 11px">{{ m.top_reason }}</span><span v-else class="hint">&mdash;</span></div>
            </div>
          </div>
          <button v-if="modelRisk.length > PANEL_LIMIT" class="panel-toggle" @click="togglePanel('risk')">
            {{ expandedPanels['risk'] ? 'Show less ▲' : `Show all ${modelRisk.length} ▼` }}
          </button>
        </div>
      </div>

      <!-- Why we lose: Chinese vs other -->
      <div v-if="whyWeLose" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128269;</div>
          <div class="tile-text">
            <div class="tile-title">Why We Lose</div>
            <div class="tile-desc">Not-purchase reasons among defectors &mdash; Chinese-OEM buyers vs everyone else</div>
          </div>
        </div>
        <div class="tile-body">
          <div class="grid grid-2">
            <div>
              <div class="mini-head">Chinese-OEM defectors ({{ whyWeLose.chinese.cohort }})</div>
              <div
                v-for="r in whyWeLose.chinese.reasons"
                :key="r.key"
                class="bar-row bar-row--click"
                @click="openDrill(`wl:cn:${r.key}`, `Defected to Chinese OEM — ${r.reason}`, { chineseOnly: 'true', notPurchaseReason: r.key, defectedOnly: 'true' })"
              >
                <div class="bar-label">{{ r.reason }}</div>
                <div class="bar-track"><div class="bar-fill bar-fill--red" :style="{ width: pct(r.count, whyWeLose.chinese.cohort) + '%' }" /></div>
                <div class="bar-value">{{ r.count }} <span class="pct-label">{{ pct(r.count, whyWeLose.chinese.cohort) }}%</span></div>
              </div>
            </div>
            <div>
              <div class="mini-head">Other competitor defectors ({{ whyWeLose.other.cohort }})</div>
              <div
                v-for="r in whyWeLose.other.reasons"
                :key="r.key"
                class="bar-row bar-row--click"
                @click="openDrill(`wl:ot:${r.key}`, `Defected to other competitor — ${r.reason}`, { excludeChinese: 'true', notPurchaseReason: r.key, defectedOnly: 'true' })"
              >
                <div class="bar-label">{{ r.reason }}</div>
                <div class="bar-track"><div class="bar-fill bar-fill--grey" :style="{ width: pct(r.count, whyWeLose.other.cohort) + '%' }" /></div>
                <div class="bar-value">{{ r.count }} <span class="pct-label">{{ pct(r.count, whyWeLose.other.cohort) }}%</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- What's working -->
      <div v-if="whatsWorking" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#9989;</div>
          <div class="tile-text">
            <div class="tile-title">What's Working</div>
            <div class="tile-desc">The "won" cohort: {{ whatsWorking.won }} positive outcomes<span v-if="whatsWorking.avg_rating != null"> &middot; avg dealership rating {{ whatsWorking.avg_rating }}&#9733;</span></div>
          </div>
        </div>
        <div class="tile-body">
          <div class="grid grid-2">
            <div>
              <div class="mini-head">What attracted them</div>
              <div
                v-for="f in whatsWorking.factors"
                :key="f.factor"
                class="bar-row bar-row--click"
                @click="openDrill(`ww:f:${f.key}`, `Won — attracted by ${f.factor}`, { wonOnly: 'true', interestFactor: f.key })"
              >
                <div class="bar-label">{{ f.factor }}</div>
                <div class="bar-track"><div class="bar-fill bar-fill--green" :style="{ width: pct(f.count, whatsWorking.won) + '%' }" /></div>
                <div class="bar-value">{{ f.count }} <span class="pct-label">{{ pct(f.count, whatsWorking.won) }}%</span></div>
              </div>
            </div>
            <div>
              <div class="mini-head">Models that won most</div>
              <div class="hint" v-if="!whatsWorking.top_models.length">No data.</div>
              <div
                v-for="m in whatsWorking.top_models"
                :key="m.model"
                class="metric-row metric-row--clickable"
                style="margin-bottom: 4px"
                @click="openDrill(`ww:m:${m.model}`, `${m.model} — won (bought client brand)`, { wonOnly: 'true', drillModel: m.model })"
              >
                <div class="metric-left" style="flex: 1; font-size: 12px">{{ m.model }}</div>
                <div class="metric-right"><span class="count-pill">{{ m.count }}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ══════════ Transcript Insights (beyond the survey) ══════════ -->
      <div v-if="transcriptInsights" class="tile" style="margin-top: 22px; border-top: 3px solid #6366f1">
        <div class="tile-head">
          <div class="tile-icon">&#127908;</div>
          <div class="tile-text">
            <div class="tile-title">Transcript Insights &mdash; beyond the survey</div>
            <div class="tile-desc">
              Mined from the call transcripts by the LLM ({{ transcriptInsights.total_with_transcript }} calls analysed).
              Verbatim voice-of-customer, balanced sentiment, competitor make/model and frustrations the tick-box survey can't capture.
            </div>
          </div>
        </div>
        <div v-if="!transcriptInsights.total_with_transcript" class="tile-body">
          <div class="hint">No transcript insights yet — run batch insights on NMGB Survey calls (with a capable model) to populate this.</div>
        </div>
      </div>

      <!-- Voice-of-customer sentiment -->
      <div v-if="transcriptInsights && transcriptInsights.total_with_transcript" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128172;</div>
          <div class="tile-text">
            <div class="tile-title">Voice-of-Customer Sentiment</div>
            <div class="tile-desc">Positive &amp; negative views on the Nissan brand, the vehicle and the dealer</div>
          </div>
        </div>
        <div class="tile-body">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px">
            <div v-for="topic in [{k:'brand',t:'Brand (Nissan)'},{k:'vehicle',t:'Current vehicle'},{k:'dealer',t:'Dealer'}]" :key="topic.k">
              <div class="mini-head">{{ topic.t }}</div>
              <div
                v-for="r in sentimentRows(topic.k).rows"
                :key="r.key"
                class="bar-row bar-row--click"
                @click="openTranscriptDrill(`sent:${topic.k}:${r.key}`, `${topic.t} sentiment — ${r.label}`, { sentimentTopic: topic.k, sentimentValue: r.key })"
              >
                <div class="bar-label">{{ r.label }}</div>
                <div class="bar-track"><div class="bar-fill" :class="r.cls" :style="{ width: pct(r.count, sentimentRows(topic.k).total) + '%' }" /></div>
                <div class="bar-value">{{ r.count }} <span class="pct-label">{{ pct(r.count, sentimentRows(topic.k).total) }}%</span></div>
              </div>
              <div v-if="!sentimentRows(topic.k).rows.length" class="hint">No data.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Competitors considered (transcript) -->
      <div v-if="transcriptInsights && transcriptInsights.total_with_transcript" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#127950;</div>
          <div class="tile-text">
            <div class="tile-title">Competitors Considered (from transcript)</div>
            <div class="tile-desc">
              Brands the customer considered, test-drove or bought &mdash; recovered from speech, including those the survey left blank.
              {{ transcriptInsights.competitors.chinese_share }}% of mentions are Chinese / Chinese-owned OEMs.
            </div>
          </div>
        </div>
        <div class="tile-body">
          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
            <div class="stat"><div class="stat-label">Brand mentions</div><div class="stat-value">{{ transcriptInsights.competitors.considered_total }}</div></div>
            <div
              class="stat stat--click"
              @click="openTranscriptDrill('ti:cn', 'Considered a Chinese / Chinese-owned OEM', { transcriptChineseOnly: 'true' })"
            >
              <div class="stat-label">Chinese-OEM mentions</div><div class="stat-value chip chip--danger">{{ transcriptInsights.competitors.chinese_considered }}</div>
            </div>
          </div>
          <div
            v-for="b in panelVisible(transcriptInsights.competitors.brands, 'ti-comp')"
            :key="b.brand"
            class="bar-row bar-row--click"
            @click="openTranscriptDrill(`ti:brand:${b.brand}`, `Considered ${b.brand}`, { transcriptBrand: b.brand })"
          >
            <div class="bar-label">
              {{ b.brand }}
              <span v-if="b.chinese" class="chip chip--danger" style="font-size: 10px; margin-left: 6px">CN</span>
              <div v-if="b.models.length" class="hint" style="font-size: 11px">{{ b.models.join(', ') }}</div>
            </div>
            <div class="bar-track"><div class="bar-fill" :class="b.chinese ? 'bar-fill--amber' : 'bar-fill--grey'" :style="{ width: barPct(b.count, maxCount(transcriptInsights.competitors.brands)) + '%' }" /></div>
            <div class="bar-value">{{ b.count }}</div>
          </div>
          <div v-if="!transcriptInsights.competitors.brands.length" class="hint">No competitors mentioned.</div>
          <button v-if="transcriptInsights.competitors.brands.length > PANEL_LIMIT" class="panel-toggle" @click="togglePanel('ti-comp')">
            {{ expandedPanels['ti-comp'] ? 'Show less' : `Show all ${transcriptInsights.competitors.brands.length}` }}
          </button>
        </div>
      </div>

      <!-- Why competitors win (transcript) -->
      <div v-if="transcriptInsights && transcriptInsights.total_with_transcript" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#127942;</div>
          <div class="tile-text">
            <div class="tile-title">Why Competitors Win (from transcript)</div>
            <div class="tile-desc">Reasons the customer preferred a competitor &mdash; split by whether they considered a Chinese OEM</div>
          </div>
        </div>
        <div class="tile-body">
          <div class="grid grid-3">
            <div>
              <div class="mini-head">All competitors</div>
              <div
                v-for="r in transcriptInsights.reasons"
                :key="r.key"
                class="bar-row bar-row--click"
                @click="openTranscriptDrill(`ti:reason:${r.key}`, `Competitor reason — ${r.label}`, { competitorReason: r.key })"
              >
                <div class="bar-label">{{ r.label }}</div>
                <div class="bar-track"><div class="bar-fill bar-fill--grey" :style="{ width: barPct(r.count, maxCount(transcriptInsights.reasons)) + '%' }" /></div>
                <div class="bar-value">{{ r.count }}</div>
              </div>
              <div v-if="!transcriptInsights.reasons.length" class="hint">No data.</div>
            </div>
            <div>
              <div class="mini-head">Non-Chinese competitors</div>
              <div
                v-for="r in transcriptInsights.non_chinese_reasons"
                :key="r.key"
                class="bar-row bar-row--click"
                @click="openTranscriptDrill(`ti:noncnreason:${r.key}`, `Non-Chinese competitor reason — ${r.label}`, { competitorReason: r.key, transcriptNonChineseOnly: 'true' })"
              >
                <div class="bar-label">{{ r.label }}</div>
                <div class="bar-track"><div class="bar-fill bar-fill--blue" :style="{ width: barPct(r.count, maxCount(transcriptInsights.non_chinese_reasons)) + '%' }" /></div>
                <div class="bar-value">{{ r.count }}</div>
              </div>
              <div v-if="!transcriptInsights.non_chinese_reasons || !transcriptInsights.non_chinese_reasons.length" class="hint">No data.</div>
            </div>
            <div>
              <div class="mini-head">Chinese OEM competitors</div>
              <div
                v-for="r in transcriptInsights.chinese_reasons"
                :key="r.key"
                class="bar-row bar-row--click"
                @click="openTranscriptDrill(`ti:cnreason:${r.key}`, `Chinese-OEM competitor reason — ${r.label}`, { competitorReason: r.key, transcriptChineseOnly: 'true' })"
              >
                <div class="bar-label">{{ r.label }}</div>
                <div class="bar-track"><div class="bar-fill bar-fill--red" :style="{ width: barPct(r.count, maxCount(transcriptInsights.chinese_reasons)) + '%' }" /></div>
                <div class="bar-value">{{ r.count }}</div>
              </div>
              <div v-if="!transcriptInsights.chinese_reasons.length" class="hint">No reasons for Chinese-OEM defections captured.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Frustrations -->
      <div v-if="transcriptInsights && transcriptInsights.frustrations.total" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#9888;</div>
          <div class="tile-text">
            <div class="tile-title">Customer Frustrations &amp; Resolutions</div>
            <div class="tile-desc">{{ transcriptInsights.frustrations.total }} frustrations across the cohort, with what NMGB could do about them</div>
          </div>
        </div>
        <div class="tile-body">
          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px">
            <div
              v-for="(count, sev) in transcriptInsights.frustrations.by_severity"
              :key="'sev'+sev"
              class="stat stat--click"
              @click="openTranscriptDrill(`ti:frsev:${sev}`, `Frustrations — ${sev} severity`, { frustrationSeverity: sev })"
            >
              <div class="stat-label">{{ sev }} severity</div>
              <div class="stat-value chip" :class="SEVERITY_CLS[sev] || ''">{{ count }}</div>
            </div>
            <div
              v-for="(count, res) in transcriptInsights.frustrations.by_resolvable"
              :key="'res'+res"
              class="stat stat--click"
              @click="openTranscriptDrill(`ti:frres:${res}`, `Frustrations — resolvable: ${res}`, { frustrationResolvable: res })"
            >
              <div class="stat-label">resolvable: {{ res }}</div>
              <div class="stat-value">{{ count }}</div>
            </div>
          </div>
          <div class="grid grid-2">
            <div>
              <div class="mini-head">Top themes</div>
              <div
                v-for="t in transcriptInsights.frustrations.top_themes"
                :key="t.theme"
                class="bar-row bar-row--click"
                @click="openTranscriptDrill(`ti:frtheme:${t.theme}`, `Frustration — ${t.theme}`, { frustrationTheme: t.theme })"
              >
                <div class="bar-label">{{ t.theme }}</div>
                <div class="bar-track"><div class="bar-fill bar-fill--red" :style="{ width: barPct(t.count, maxCount(transcriptInsights.frustrations.top_themes)) + '%' }" /></div>
                <div class="bar-value">{{ t.count }}</div>
              </div>
            </div>
            <div>
              <div class="mini-head">What we could do (high-severity first)</div>
              <div
                v-for="(s, i) in transcriptInsights.frustrations.samples"
                :key="'fr'+i"
                class="ti-sample--click"
                style="margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid var(--border)"
                @click="openTranscriptDrill(`ti:frsample:${s.theme}`, `Frustration — ${s.theme}`, { frustrationTheme: s.theme })"
              >
                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap">
                  <span class="chip" :class="SEVERITY_CLS[s.severity] || ''" style="font-size: 10px">{{ s.severity }}</span>
                  <strong style="font-size: 12px">{{ s.theme }}</strong>
                  <span class="hint" style="font-size: 11px">&middot; {{ s.owner }} &middot; resolvable: {{ s.resolvable }}</span>
                </div>
                <div v-if="s.recommended_action" style="font-size: 12px; margin-top: 3px">&#8594; {{ s.recommended_action }}</div>
                <div v-if="s.quote" class="hint" style="font-size: 11px; font-style: italic; margin-top: 2px">&ldquo;{{ s.quote }}&rdquo;</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Reportable measures -->
      <div v-if="transcriptInsights && transcriptInsights.total_with_transcript" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128202;</div>
          <div class="tile-text">
            <div class="tile-title">Reportable Measures</div>
            <div class="tile-desc">Signals the survey doesn't ask about: EV stance, loyalty, price-expectation gaps and dealer follow-up</div>
          </div>
        </div>
        <div class="tile-body">
          <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px">
            <div class="stat stat--click" @click="openTranscriptDrill('ti:pricegap', 'Price-expectation gap', { priceGap: 'true' })">
              <div class="stat-label">Price-expectation gap</div><div class="stat-value chip chip--warning">{{ transcriptInsights.measures.price_expectation_gap_yes }}</div>
            </div>
            <div class="stat stat--click" @click="openTranscriptDrill('ti:fu:yes', 'Dealer followed up', { dealerFollowUp: 'yes' })">
              <div class="stat-label">Dealer followed up</div><div class="stat-value">{{ transcriptInsights.measures.dealer_follow_up_yes }}</div>
            </div>
            <div class="stat stat--click" @click="openTranscriptDrill('ti:fu:no', 'Dealer did NOT follow up', { dealerFollowUp: 'no' })">
              <div class="stat-label">Dealer did NOT follow up</div><div class="stat-value chip chip--danger">{{ transcriptInsights.measures.dealer_follow_up_no }}</div>
            </div>
          </div>
          <div class="grid grid-2">
            <div>
              <div class="mini-head">EV / hybrid stance</div>
              <div
                v-for="e in sortedCounts(transcriptInsights.measures.ev_sentiment)"
                :key="e.stance"
                class="bar-row bar-row--click"
                @click="openTranscriptDrill(`ti:ev:${e.stance}`, `EV / hybrid stance — ${e.stance}`, { evStance: e.stance })"
              >
                <div class="bar-label">{{ e.stance }}</div>
                <div class="bar-track"><div class="bar-fill bar-fill--blue" :style="{ width: barPct(e.count, maxCount(transcriptInsights.measures.ev_sentiment)) + '%' }" /></div>
                <div class="bar-value">{{ e.count }}</div>
              </div>
            </div>
            <div>
              <div class="mini-head">Would consider Nissan again</div>
              <div
                v-for="l in sortedCounts(transcriptInsights.measures.loyalty)"
                :key="l.answer"
                class="bar-row bar-row--click"
                @click="openTranscriptDrill(`ti:loyalty:${l.answer}`, `Would consider again — ${l.answer}`, { loyaltyAnswer: l.answer })"
              >
                <div class="bar-label">{{ l.answer }}</div>
                <div class="bar-track"><div class="bar-fill bar-fill--green" :style="{ width: barPct(l.count, maxCount(transcriptInsights.measures.loyalty)) + '%' }" /></div>
                <div class="bar-value">{{ l.count }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Key quotes + survey gaps -->
      <div v-if="transcriptInsights && (transcriptInsights.quotes.length || transcriptInsights.gaps.length)" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128172;</div>
          <div class="tile-text">
            <div class="tile-title">Key Quotes &amp; Survey Gaps Filled</div>
            <div class="tile-desc">Report-ready verbatims, and what the transcript revealed that the survey missed</div>
          </div>
        </div>
        <div class="tile-body">
          <div class="grid grid-2">
            <div>
              <div class="mini-head">Notable quotes</div>
              <div v-for="(qt, i) in panelVisible(transcriptInsights.quotes, 'ti-quotes')" :key="'q'+i" style="margin-bottom: 8px">
                <div style="font-size: 12px; font-style: italic">&ldquo;{{ qt.quote }}&rdquo;</div>
                <div class="hint" style="font-size: 11px">{{ qt.theme }}<span v-if="qt.sentiment"> &middot; {{ qt.sentiment }}</span></div>
              </div>
              <div v-if="!transcriptInsights.quotes.length" class="hint">No quotes captured.</div>
              <button v-if="transcriptInsights.quotes.length > PANEL_LIMIT" class="panel-toggle" @click="togglePanel('ti-quotes')">
                {{ expandedPanels['ti-quotes'] ? 'Show less' : `Show all ${transcriptInsights.quotes.length}` }}
              </button>
            </div>
            <div>
              <div class="mini-head">Survey gaps filled</div>
              <ul style="margin: 0; padding-left: 18px">
                <li v-for="(g, i) in panelVisible(transcriptInsights.gaps, 'ti-gaps')" :key="'g'+i" style="font-size: 12px; margin-bottom: 4px">{{ g }}</li>
              </ul>
              <div v-if="!transcriptInsights.gaps.length" class="hint">None flagged.</div>
              <button v-if="transcriptInsights.gaps.length > PANEL_LIMIT" class="panel-toggle" @click="togglePanel('ti-gaps')">
                {{ expandedPanels['ti-gaps'] ? 'Show less' : `Show all ${transcriptInsights.gaps.length}` }}
              </button>
            </div>
          </div>
        </div>
      </div>

    </template>

    <!-- Drill results modal (from any competitive panel click) -->
    <Teleport to="body">
      <div v-if="drillKey" class="drill-modal-backdrop" @click="closeDrill" />
      <div v-if="drillKey" class="drill-modal">
        <div class="drill-modal-header">
          <div>
            <div class="drill-modal-title">{{ drillTitle }}</div>
            <div class="drill-modal-sub">{{ loadingDrill ? 'Loading…' : drillRecords.length + ' record(s) — click a row for full detail' }}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px">
            <button
              v-if="drillRecords.length"
              class="btn btn--ghost btn--sm"
              title="Export these records to CSV"
              @click="exportDrillCsv"
            >Export CSV</button>
            <button class="drawer-close" @click="closeDrill">&times;</button>
          </div>
        </div>
        <div class="drill-modal-body">
          <div v-if="loadingDrill" class="hint">Loading…</div>
          <div v-else-if="!drillRecords.length" class="hint">No matching records.</div>
          <div v-else v-for="r in drillRecords" :key="r.interaction_id ?? r.id_opportunity" class="drill-row" @click="openDetail(r.interaction_id ?? r.id_opportunity)">
            <div class="drill-row-top">
              <span class="chip chip--secondary" style="font-size: 11px">Enquired: {{ r.model || 'n/a' }}</span>
              <span v-if="r.dealer" class="chip chip--secondary" style="font-size: 11px">{{ r.dealer }}</span>
              <span v-if="r.purchased_make" class="chip chip--warning" style="font-size: 11px">Bought: {{ r.purchased_make }}<template v-if="r.purchased_model || r.purchased_other_model"> {{ r.purchased_model || r.purchased_other_model }}</template></span>
              <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(r.allocation_date) }}</span>
            </div>
            <div v-if="r.evidence" class="drill-row-summary" style="font-style: italic">&ldquo;{{ r.evidence }}&rdquo;</div>
            <div v-else class="drill-row-summary">{{ r.purchase_reason || r.agent_notes || "(no notes)" }}</div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Generate Narrative -->
    <div v-if="overview" class="tile" style="margin-top: 14px">
      <div class="tile-head">
        <div class="tile-icon">&#128221;</div>
        <div class="tile-text">
          <div class="tile-title">Generate Executive Narrative</div>
          <div class="tile-desc">Director-level briefing built from survey answers <strong>and</strong> transcript insights: competitive landscape, Chinese-OEM threat &amp; quarterly trend, why customers defect, model risk, emerging themes, what Nissan does well, and recommendations</div>
        </div>
      </div>
      <div class="tile-body">
        <div style="display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 14px">
          <div class="filter-group">
            <label class="label">Provider</label>
            <select v-model="narrativeProvider" class="select select--sm">
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="grok">Grok</option>
              <option value="gemini">Gemini</option>
            </select>
          </div>
          <div class="filter-group">
            <label class="label">Model</label>
            <select v-model="narrativeModel" class="select select--sm">
              <option v-for="m in narrativeModelOptions" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </div>
          <button class="btn btn--primary" :disabled="loadingNarrative" @click="generateNarrative">
            {{ loadingNarrative ? "Generating..." : "Generate Narrative" }}
          </button>
        </div>
        <div v-if="narrativeError" class="error-tile">{{ narrativeError }}</div>

        <!-- Loading shimmer -->
        <div v-if="loadingNarrative" class="nb-loading">
          <div class="nb-spinner" />
          <div>Analysing survey answers &amp; call transcripts, drafting the briefing…</div>
        </div>

        <!-- Rich executive briefing (shared component; also used on the Narratives page) -->
        <NarrativeBriefing v-else-if="narrative" :narrative="narrative" />

        <!-- Fallback: raw pretty text if the shape wasn't as expected -->
        <div v-else-if="narrativeResultText" class="narrative-box"><pre class="narrative-pre">{{ narrativeResultText }}</pre></div>
        <div v-else class="hint">Click Generate to create an AI briefing. Blends aggregated survey metrics, free-text comments and transcript-mined insights.</div>
      </div>
    </div>

    <!-- Detail drawer — shared component (same drawer as Operations / Client Services) -->
    <InteractionDetailDrawer :recording-id="detailId" @close="closeDetail" />
  </div>
</template>

<style scoped>
.sv-root { position: relative; }

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
  padding-top: 4px;
}

/* ── Stats strip ─────────────────────────────────────────────────────────── */
.stats-strip {
  display: flex; gap: 16px; flex-wrap: wrap; margin-top: 14px;
  padding: 14px 16px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
}

/* ── Headline-rate sparklines ────────────────────────────────────────────── */
.spark-strip { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; }
.spark-card {
  flex: 1; min-width: 220px;
  padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
}
.spark-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.spark-title { font-size: 12px; font-weight: 700; color: var(--ink); }
.spark-latest { font-size: 13px; font-weight: 800; color: var(--ink); }
.spark-up { color: #dc2626; font-size: 11px; }
.spark-down { color: #059669; font-size: 11px; }
.spark-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }

/* ── Bar rows (interest factors, not-purchase reasons) ───────────────────── */
.bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.bar-label { font-size: 12px; min-width: 130px; color: var(--ink); }
.bar-track { flex: 1; background: var(--surface-2, #e0e0e0); border-radius: 3px; height: 7px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
.bar-fill--blue { background: linear-gradient(90deg, #bae6fd, #0284c7); }
.bar-fill--red { background: linear-gradient(90deg, #fecaca, #dc2626); }
.bar-fill--green { background: linear-gradient(90deg, #bbf7d0, #059669); }
.bar-fill--amber { background: linear-gradient(90deg, #fed7aa, #ea580c); }
.bar-fill--grey { background: linear-gradient(90deg, #cbd5e1, #64748b); }
.bar-value { font-size: 12px; min-width: 70px; text-align: right; font-weight: 700; color: var(--ink); }
.pct-label { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 4px; }

/* ── Not-purchase reason sub-levels ──────────────────────────────────────── */
.npr-group { margin-bottom: 8px; }
.npr-subs { margin: 2px 0 4px 18px; display: flex; flex-direction: column; gap: 2px; }
.npr-sub {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 3px 8px; font-size: 12px; color: var(--muted);
  border-left: 2px solid var(--border); border-radius: 0 4px 4px 0; cursor: pointer;
  transition: background 0.12s;
}
.npr-sub:hover { background: var(--surface-soft, rgba(0, 0, 0, 0.04)); color: var(--ink); }
.npr-sub-label { flex: 1; word-break: break-word; }

/* ── Model performance rows ──────────────────────────────────────────────── */
.model-row { margin-bottom: 12px; }
.model-name { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
.model-stats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.model-bar-track { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--surface-2, #e0e0e0); }
.model-bar { height: 100%; transition: width 0.4s ease; }
.model-bar--considering { background: #0284c7; }
.model-bar--lost { background: #dc2626; }

/* ── Rating blocks ───────────────────────────────────────────────────────── */
.rating-block { text-align: center; min-width: 48px; padding: 6px 8px; border-radius: var(--radius-md, 6px); border: 1px solid var(--border); background: var(--surface); }
.rating-star { font-size: 16px; font-weight: 800; }
.rating-count { font-size: 11px; color: var(--muted); }

/* ── Visit chips ─────────────────────────────────────────────────────────── */
.visit-chip { padding: 8px 14px; border-radius: var(--radius-md, 6px); border: 1px solid var(--border); background: var(--surface); text-align: center; }
.visit-label { font-size: 12px; font-weight: 700; color: var(--ink); margin-bottom: 2px; }
.visit-count { font-size: 18px; font-weight: 800; color: var(--brand, #6366f1); }

/* ── Clickable metric rows ───────────────────────────────────────────────── */
.metric-row--clickable { cursor: pointer; border-radius: var(--radius-md, 6px); padding: 4px 6px; margin: -4px -6px; transition: background 0.15s; }
.metric-row--clickable:hover { background: var(--surface-soft, rgba(0, 0, 0, 0.03)); }
.expand-icon { font-size: 10px; color: var(--muted); margin-left: 8px; }

/* ── Drill-down panel ────────────────────────────────────────────────────── */
.drill-panel { padding: 8px 0 8px 12px; border-left: 3px solid var(--brand, #6366f1); margin: 4px 0 8px 8px; }
.drill-row { padding: 8px 10px; border-radius: var(--radius-md, 6px); cursor: pointer; transition: background 0.15s; }
.drill-row:hover { background: var(--surface-soft, rgba(0, 0, 0, 0.03)); }
.drill-row-top { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.drill-row-summary { font-size: 13px; color: var(--ink); margin-top: 3px; line-height: 1.4; }

/* ── Drawer ──────────────────────────────────────────────────────────────── */
.drawer-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 999; }
.drawer { position: fixed; top: 0; right: 0; width: min(960px, 92vw); height: 100vh; background: var(--surface, #fff); border-left: 1px solid var(--border); z-index: 1000; display: flex; flex-direction: column; box-shadow: -4px 0 24px rgba(0,0,0,0.12); }
.drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.drawer-title { font-size: 16px; font-weight: 800; color: var(--ink); }
.drawer-close { background: none; border: none; font-size: 24px; cursor: pointer; color: var(--muted); padding: 0 4px; line-height: 1; }
.drawer-close:hover { color: var(--ink); }

/* ── Ask AI ──────────────────────────────────────────────────────────────── */
.ask-ai-btn {
  border: 1px solid var(--brand, #6366f1); background: var(--brand, #6366f1); color: #fff;
  font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 8px; cursor: pointer;
}
.ask-ai-btn:hover { filter: brightness(1.08); }
.ask-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 1200; }
.ask-modal {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(620px, 94vw); max-height: 84vh; z-index: 1201;
  background: var(--surface, #fff); border: 1px solid var(--border);
  border-radius: var(--radius-lg, 10px); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
  display: flex; flex-direction: column;
}
.ask-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.ask-title { font-size: 15px; font-weight: 800; color: var(--ink); }
.ask-body { padding: 14px 18px; overflow-y: auto; flex: 1; }
.ask-suggestions { display: flex; flex-wrap: wrap; gap: 8px; }
.ask-chip { border: 1px solid var(--border); background: var(--surface); color: var(--ink); font-size: 12px; padding: 5px 10px; border-radius: 14px; cursor: pointer; }
.ask-chip:hover { background: var(--surface-soft, rgba(0, 0, 0, 0.04)); }
.ask-turn { margin-bottom: 14px; }
.ask-q { font-weight: 700; color: var(--ink); font-size: 13px; margin-bottom: 6px; }
.ask-q::before { content: "Q: "; color: var(--brand, #6366f1); }
.ask-a { font-size: 13px; line-height: 1.6; color: var(--ink); white-space: pre-wrap; background: var(--surface-soft, #f8f8f8); border-radius: 8px; padding: 10px 12px; }
.ask-input { display: flex; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border); flex-shrink: 0; }
.ask-textarea { flex: 1; resize: vertical; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; background: var(--surface); color: var(--ink); }
.drawer-body { flex: 1; overflow-y: auto; padding: 0; }
.drawer-columns { display: grid; grid-template-columns: 1fr 1fr; height: 100%; }
.drawer-col { overflow-y: auto; min-height: 0; }
.drawer-col--left { border-right: 1px solid var(--border); }
@media (max-width: 700px) { .drawer-columns { grid-template-columns: 1fr; } .drawer-col--left { border-right: none; border-bottom: 1px solid var(--border); } }
.drawer-section { padding: 16px 20px; border-bottom: 1px solid var(--border); }
.drawer-section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; color: var(--brand, #6366f1); margin-bottom: 10px; }
.drawer-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.drawer-meta-grid > div { display: flex; flex-direction: column; gap: 2px; }
.drawer-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }

/* ── Narrative ────────────────────────────────────────────────────────────── */
.narrative-box {
  background: var(--surface-soft, #f8f8f8);
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 6px);
  padding: 16px;
  max-height: 500px;
  overflow-y: auto;
}

.narrative-pre {
  margin: 0;
  font-size: 12px;
  font-family: ui-monospace, "Courier New", monospace;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  color: var(--ink);
}

/* ── Section divider ─────────────────────────────────────────────────────── */
.section-divider {
  margin: 24px 0 4px; padding-bottom: 6px;
  font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--brand, #6366f1); border-bottom: 2px solid var(--border);
}

/* ── Mini heading (inside a tile column) ─────────────────────────────────── */
.mini-head { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }

/* ── Chinese OEM threat panel ────────────────────────────────────────────── */
.chinese-headline { display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.chinese-share { font-size: 34px; font-weight: 800; color: #dc2626; line-height: 1; }
.chinese-sub { font-size: 12px; color: var(--muted); }
.chinese-track { background: var(--surface-2, #e0e0e0); border-radius: 4px; height: 10px; overflow: hidden; }
.chinese-track--sm { height: 6px; }
.chinese-bar { height: 100%; background: linear-gradient(90deg, #fca5a5, #dc2626); border-radius: 4px; transition: width 0.4s ease; }

/* ── Trend table ─────────────────────────────────────────────────────────── */
.trend-table { display: flex; flex-direction: column; gap: 2px; }
.trend-head, .trend-row {
  display: grid; grid-template-columns: 1fr 0.8fr 1.2fr 1.8fr 1.6fr 1.6fr;
  gap: 10px; align-items: center; padding: 6px 8px; font-size: 12px;
}
.trend-head { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--muted); }
.trend-row { border-radius: 6px; }
.trend-row:nth-child(even) { background: var(--surface-soft, rgba(0,0,0,0.02)); }
.trend-q { font-weight: 700; color: var(--ink); }

/* ── Risk table ──────────────────────────────────────────────────────────── */
.risk-table { display: flex; flex-direction: column; gap: 2px; }
.risk-head, .risk-row {
  display: grid; grid-template-columns: 1.4fr 1fr 1fr 1.3fr 0.8fr 1.3fr;
  gap: 10px; align-items: center; padding: 6px 8px; font-size: 12px;
}
.risk-head { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--muted); }
.risk-row { border-radius: 6px; }
.risk-row:nth-child(even) { background: var(--surface-soft, rgba(0,0,0,0.02)); }
.risk-model { font-weight: 700; color: var(--ink); }
.risk-pill { color: #fff; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 10px; }
.risk-row--click { cursor: pointer; transition: background 0.15s; }
.risk-row--click:hover { background: var(--surface-soft, rgba(0, 0, 0, 0.04)); }

/* ── Clickable bar rows (competitive panels) ─────────────────────────────── */
.bar-row--click { cursor: pointer; border-radius: 6px; padding: 2px 4px; margin: 0 -4px 8px; transition: background 0.15s; }
.bar-row--click:hover { background: var(--surface-soft, rgba(0, 0, 0, 0.04)); }

/* ── Other clickable stat surfaces (every tile drills into its records) ──── */
.stat--click, .rating-block--click, .visit-chip--click,
.chinese-headline--click, .model-row--click, .trend-row--click,
.risk-row--click, .ti-sample--click { cursor: pointer; transition: background 0.15s, box-shadow 0.15s, transform 0.1s; }
.stat--click { border-radius: var(--radius-md, 6px); padding: 4px 8px; margin: -4px -8px; }
.stat--click:hover, .rating-block--click:hover, .visit-chip--click:hover,
.model-row--click:hover, .trend-row--click:hover, .ti-sample--click:hover { background: var(--surface-soft, rgba(0, 0, 0, 0.04)); }
.rating-block--click:hover, .visit-chip--click:hover { box-shadow: 0 2px 8px -3px rgba(0, 0, 0, 0.25); transform: translateY(-1px); }
.chinese-headline--click { border-radius: var(--radius-md, 6px); padding: 4px 8px; margin: -4px -8px 4px; }
.chinese-headline--click:hover { background: rgba(220, 38, 38, 0.06); }
.chip--click { cursor: pointer; }
.chip--click:hover { filter: brightness(1.08); }
.trend-row--click:hover { background: var(--surface-soft, rgba(0, 0, 0, 0.05)); }

/* ── All survey answers (drawer) ─────────────────────────────────────────── */
.answer-group { margin-bottom: 12px; }
.answer-group-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--muted); margin: 6px 0 4px;
}
.answer-row {
  display: flex; justify-content: space-between; gap: 12px; padding: 3px 0;
  font-size: 12px; border-bottom: 1px dotted var(--border);
}
.answer-label { color: var(--muted); flex-shrink: 0; }
.answer-value { color: var(--ink); font-weight: 600; text-align: right; word-break: break-word; }
.answer-yn { font-size: 10px; font-weight: 800; padding: 0 8px; }
.answer-n { color: var(--muted); font-weight: 700; }

/* ── Line charts ─────────────────────────────────────────────────────────── */
.chart-scroll { width: 100%; overflow-x: auto; }
.linechart { width: 100%; min-width: 520px; height: auto; display: block; }
.chart-grid { stroke: var(--border); stroke-width: 1; }
.chart-axis { fill: var(--muted); font-size: 10px; }
.chart-point { font-size: 10px; font-weight: 700; paint-order: stroke; stroke: var(--surface, #fff); stroke-width: 3px; }
.chart-toggle { margin-left: auto; display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.chart-toggle button { border: none; background: var(--surface); color: var(--muted); font-size: 12px; font-weight: 600; padding: 4px 12px; cursor: pointer; }
.chart-toggle button.chart-toggle-on { background: var(--brand, #6366f1); color: #fff; }
.chart-legend { display: flex; flex-wrap: wrap; gap: 10px 16px; margin-top: 10px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink); }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

/* ── Panel size toggle ───────────────────────────────────────────────────── */
.panel-toggle {
  width: 100%; margin-top: 8px; padding: 6px 10px;
  border: 1px dashed var(--border); background: transparent; border-radius: 6px;
  font-size: 12px; font-weight: 600; color: var(--brand, #6366f1); cursor: pointer;
}
.panel-toggle:hover { background: var(--surface-soft, rgba(0, 0, 0, 0.04)); }

/* ── Chinese-OEM chip (competitor league) ────────────────────────────────── */
.cn-chip {
  display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 10px;
  font-size: 9px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
  background: #dc2626; color: #fff; vertical-align: middle; white-space: nowrap;
}

/* ── Drill results modal ─────────────────────────────────────────────────── */
.drill-modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 900; }
.drill-modal {
  position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(760px, 94vw); max-height: 82vh; z-index: 901;
  background: var(--surface, #fff); border: 1px solid var(--border);
  border-radius: var(--radius-lg, 10px); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  display: flex; flex-direction: column;
}
.drill-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.drill-modal-title { font-size: 15px; font-weight: 800; color: var(--ink); }
.drill-modal-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.drill-modal-body { padding: 8px 12px; overflow-y: auto; }

/* ── Drawer transition ───────────────────────────────────────────────────── */
.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }

/* ══════════ Executive narrative — loading state ══════════ */
/* The rich briefing render + its styles live in the shared NarrativeBriefing.vue. */
.nb-loading { display: flex; align-items: center; gap: 14px; padding: 32px; color: var(--muted); font-size: 14px; }
.nb-spinner { width: 26px; height: 26px; border: 3px solid rgba(99,102,241,0.25); border-top-color: #6366f1; border-radius: 50%; animation: nb-spin 0.8s linear infinite; }
@keyframes nb-spin { to { transform: rotate(360deg); } }

</style>
