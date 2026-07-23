<script setup lang="ts">
import IconChip from "./IconChip.vue";
import axios from "axios";
import { computed, onMounted, ref, watch } from "vue";
import { ApiPath } from "@/enums/api";
import { toPrettyInsights } from "@/utils/insights-response";
import InteractionDetailDrawer from "./InteractionDetailDrawer.vue";
import ParityBar from "./ParityBar.vue";
import ParitySegmentBar from "./ParitySegmentBar.vue";
import OutcomeDonut from "./OutcomeDonut.vue";
import Sparkline from "./Sparkline.vue";

// ── Filters ──────────────────────────────────────────────────────────────────
const campaignOptions = ref<string[]>([]);
const agentOptions = ref<string[]>([]);
const outcomeOptions = ref<string[]>([]);
const vehicleMakeOptions = ref<string[]>([]);
// All make+model pairs from the backend; the visible model list is derived
// from these and the currently-selected make (see vehicleModelOptions).
const vehicleModelPairs = ref<{ make: string; model: string }[]>([]);
const excludeOutcomes = ref<string[]>([]);

// Model options chained to the selected make: when a make is chosen, only its
// models are offered; otherwise every distinct model is shown.
const vehicleModelOptions = computed(() => {
  const pairs = vehicleMake.value
    ? vehicleModelPairs.value.filter((p) => p.make === vehicleMake.value)
    : vehicleModelPairs.value;
  return Array.from(new Set(pairs.map((p) => p.model))).sort((a, b) => a.localeCompare(b));
});

const COMMON_EXCLUSIONS = [
  "npcb", "noanswer", "agam", "test chat", "test chat - client",
  "customer end chat", "customer ended chat", "customer ended chat - no interaction",
];

const commonExclusionsAvailable = computed(() =>
  outcomeOptions.value.filter((o) =>
    COMMON_EXCLUSIONS.some((ce) => o.toLowerCase() === ce),
  ),
);

const allCommonExcluded = computed(() =>
  commonExclusionsAvailable.value.length > 0 &&
  commonExclusionsAvailable.value.every((o) => excludeOutcomes.value.includes(o)),
);

function toggleCommonExclusions() {
  if (allCommonExcluded.value) {
    excludeOutcomes.value = excludeOutcomes.value.filter(
      (o) => !commonExclusionsAvailable.value.includes(o),
    );
  } else {
    const toAdd = commonExclusionsAvailable.value.filter(
      (o) => !excludeOutcomes.value.includes(o),
    );
    excludeOutcomes.value = [...excludeOutcomes.value, ...toAdd];
  }
}

const allOutcomesExcluded = computed(() =>
  outcomeOptions.value.length > 0 &&
  excludeOutcomes.value.length === outcomeOptions.value.length,
);

function toggleAllOutcomes() {
  excludeOutcomes.value = allOutcomesExcluded.value ? [] : [...outcomeOptions.value];
}

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
const interactionFilter = ref<InteractionFilter>("chats");
const campaign = ref("");
const agent = ref("");
const vehicleMake = ref("");
const vehicleModels = ref<string[]>([]);

const sharedParams = computed(() => ({
  from: from.value,
  to: to.value,
  filterKey: interactionFilter.value,
  ...(campaign.value && { campaign: campaign.value }),
  ...(agent.value && { agent: agent.value }),
  ...(excludeOutcomes.value.length && { excludeOutcomes: excludeOutcomes.value.join(',') }),
  ...(vehicleMake.value && { vehicleMake: vehicleMake.value }),
  ...(vehicleModels.value.length && { vehicleModels: vehicleModels.value.join(',') }),
}));

// ── Data state ───────────────────────────────────────────────────────────────
const loading = ref(false);
const error = ref("");

const csData = ref<any>(null);
const opportunityData = ref<any>(null);
const trendsData = ref<any>(null);

// Monthly trend series for the two headline rates → sparklines.
function csRateSeries(numerator: number[] | undefined, denom: number[] | undefined) {
  const d = trendsData.value;
  if (!d?.months?.length || !numerator || !denom) return null;
  const pts = d.months.map((_: string, i: number) => {
    const den = denom[i] ?? 0;
    return den ? Math.round(((numerator[i] ?? 0) / den) * 1000) / 10 : 0;
  });
  if (pts.length < 2) return null;
  return { points: pts, first: pts[0] ?? 0, latest: pts[pts.length - 1] ?? 0, months: pts.length };
}
const negativeViewTrend = computed(() =>
  csRateSeries(trendsData.value?.any_negative_view, trendsData.value?.parity_total),
);
const opportunityTrend = computed(() =>
  csRateSeries(trendsData.value?.opportunities, trendsData.value?.opp_classified),
);

// Interest level drill-down
// Each drill row tracks its own open state + interactions so multiple rows
// (separate stats) can be open at once and toggle independently.
const openInterest = ref<Record<string, boolean>>({});
const interestInteractionsMap = ref<Record<string, any[]>>({});
const loadingInterestMap = ref<Record<string, boolean>>({});
function isInterestOpen(key: string) { return !!openInterest.value[key]; }

// Competitor drill-down
const openCompetitor = ref<Record<string, boolean>>({});
const competitorInteractionsMap = ref<Record<string, any[]>>({});
const loadingCompetitorMap = ref<Record<string, boolean>>({});
function isCompetitorOpen(key: string) { return !!openCompetitor.value[key]; }

// Opportunity drill-down
const openOpportunityReason = ref<Record<string, boolean>>({});
const opportunityInteractionsMap = ref<Record<string, any[]>>({});
const loadingOpportunityReasonMap = ref<Record<string, boolean>>({});
function isOpportunityOpen(key: string) { return !!openOpportunityReason.value[key]; }

// Parity campaign analysis
const parityData = ref<any>(null);
// True when the user has selected the Parity campaign. The Parity tile then
// carries the full picture, so the generic client-services sections (interest,
// competitor purchases/objections, follow-ups, lost sales) are hidden.
const isParityCampaign = computed(() => campaign.value === "Parity");
// Parity drill-downs are independently toggleable: each drill key tracks its own
// open state + interactions, so separate stats (e.g. the four negative-view cards)
// open and close without affecting one another.
const openParity = ref<Record<string, boolean>>({});
const parityInteractionsMap = ref<Record<string, any[]>>({});
const loadingParityMap = ref<Record<string, boolean>>({});

function isParityOpen(key: string) {
  return !!openParity.value[key];
}

// ── Period-vs-period comparison ──────────────────────────────────────────────
type CompareMode = "previous" | "last_year" | "custom";
const compareEnabled = ref(false);
const compareMode = ref<CompareMode>("previous");
const compareFromStr = ref<string>(""); // for custom mode (YYYY-MM-DD)
const compareToStr = ref<string>(""); // for custom mode (YYYY-MM-DD)

const csDataCompare = ref<any>(null);
const opportunityDataCompare = ref<any>(null);
const parityDataCompare = ref<any>(null);

// Resolve the comparison window (from / to ISO) based on the current window
// plus the user's chosen mode. `to` follows the same end-of-day-exclusive
// convention as the primary `to` ref.
const compareWindow = computed<{ from: string; to: string } | null>(() => {
  if (!compareEnabled.value) return null;

  const curFrom = new Date(from.value);
  const curTo = new Date(to.value);
  if (Number.isNaN(curFrom.getTime()) || Number.isNaN(curTo.getTime())) return null;

  if (compareMode.value === "previous") {
    const duration = curTo.getTime() - curFrom.getTime();
    const newTo = new Date(curFrom);
    const newFrom = new Date(curFrom.getTime() - duration);
    return { from: newFrom.toISOString(), to: newTo.toISOString() };
  }

  if (compareMode.value === "last_year") {
    const newFrom = new Date(curFrom);
    newFrom.setFullYear(newFrom.getFullYear() - 1);
    const newTo = new Date(curTo);
    newTo.setFullYear(newTo.getFullYear() - 1);
    return { from: newFrom.toISOString(), to: newTo.toISOString() };
  }

  // custom
  if (!compareFromStr.value || !compareToStr.value) return null;
  const cFrom = new Date(compareFromStr.value + "T12:00:00");
  const cTo = new Date(compareToStr.value + "T12:00:00");
  cFrom.setHours(0, 0, 0, 0);
  cTo.setHours(0, 0, 0, 0);
  cTo.setDate(cTo.getDate() + 1);
  return { from: cFrom.toISOString(), to: cTo.toISOString() };
});

const compareParams = computed(() => {
  const w = compareWindow.value;
  if (!w) return null;
  return {
    from: w.from,
    to: w.to,
    filterKey: interactionFilter.value,
    ...(campaign.value && { campaign: campaign.value }),
    ...(agent.value && { agent: agent.value }),
    ...(excludeOutcomes.value.length && { excludeOutcomes: excludeOutcomes.value.join(",") }),
    ...(vehicleMake.value && { vehicleMake: vehicleMake.value }),
    ...(vehicleModels.value.length && { vehicleModels: vehicleModels.value.join(",") }),
  };
});

// Human-readable label for the comparison window — used in the banner / strip
const compareWindowLabel = computed(() => {
  const w = compareWindow.value;
  if (!w) return "";
  const f = new Date(w.from);
  const t = new Date(w.to);
  // back off the end-of-day-exclusive so the display matches user expectation
  t.setDate(t.getDate() - 1);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  return `${fmt(f)} → ${fmt(t)}`;
});

// Share of customers (with Parity answers) who raised a negative view on at least
// one of brand / vehicle / dealer / finance. Denominator is parityData.total — the
// interactions that actually answered the views questions — so it matches the
// per-view Customer Views cards. null when there's no Parity data in scope.
const negativeViewRate = computed<number | null>(() => {
  const d = parityData.value;
  if (!d || !d.total) return null;
  return Math.round((d.any_negative_view / d.total) * 100);
});
const negativeViewRateCompare = computed<number | null>(() => {
  const d = parityDataCompare.value;
  if (!d || !d.total) return null;
  return Math.round((d.any_negative_view / d.total) * 100);
});

// Volume-by-outcome for the overview donut. Mapped to the chart's {label,count}
// shape; compare data is null unless a comparison period is loaded.
const outcomeChartData = computed(() =>
  (csData.value?.by_outcome ?? []).map((o: any) => ({ label: o.outcome, count: o.count })),
);
const outcomeChartCompare = computed(() =>
  csDataCompare.value
    ? (csDataCompare.value.by_outcome ?? []).map((o: any) => ({ label: o.outcome, count: o.count }))
    : null,
);

// Volume-by-vehicle-make for the overview donut, same shape/treatment as outcome.
const vehicleMakeChartData = computed(() =>
  (csData.value?.by_vehicle_make ?? []).map((m: any) => ({ label: m.vehicle_make, count: m.count })),
);
const vehicleMakeChartCompare = computed(() =>
  csDataCompare.value
    ? (csDataCompare.value.by_vehicle_make ?? []).map((m: any) => ({ label: m.vehicle_make, count: m.count }))
    : null,
);

// Pretty delta between two numbers (returns label, sign, pct text).
function compareDelta(current: number | null | undefined, prev: number | null | undefined) {
  if (typeof current !== "number" || typeof prev !== "number") {
    return { available: false, dir: "flat" as const, abs: 0, pct: 0, pctLabel: "—" };
  }
  const abs = current - prev;
  let pct = 0;
  let pctLabel = "—";
  if (prev !== 0) {
    pct = (abs / prev) * 100;
    const sign = pct > 0 ? "+" : "";
    pctLabel = `${sign}${pct.toFixed(1)}%`;
  } else if (current !== 0) {
    pctLabel = "new";
  } else {
    pctLabel = "0%";
  }
  return {
    available: true,
    dir: abs > 0 ? ("up" as const) : abs < 0 ? ("down" as const) : ("flat" as const),
    abs,
    pct,
    pctLabel,
  };
}

function compareArrow(dir: "up" | "down" | "flat") {
  if (dir === "up") return "▲";
  if (dir === "down") return "▼";
  return "▬";
}

function compareClass(dir: "up" | "down" | "flat") {
  if (dir === "up") return "cmp-up";
  if (dir === "down") return "cmp-down";
  return "cmp-flat";
}

function fmtInt(n: number | null | undefined): string {
  if (typeof n !== "number") return "—";
  return n.toLocaleString();
}

// Look up a count in a comparison list by key name (brand or reason).
function compareCount(
  list: Array<Record<string, any>> | null | undefined,
  keyName: string,
  field: "brand" | "reason",
): number {
  if (!list) return 0;
  const found = list.find((item) => item[field] === keyName);
  return found?.count ?? 0;
}

// Detail drawer
const detailId = ref<string | null>(null);

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return "n/a";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function badgeClass(level: string) {
  if (level === "high") return "chip chip--success";
  if (level === "medium") return "chip chip--info";
  if (level === "low") return "chip chip--warning";
  return "chip chip--secondary";
}

function opportunityReasonLabel(r: string) {
  const labels: Record<string, string> = {
    existing_policy: "Existing Policy",
    recent_policy_lapse: "Recent Policy (60 days)",
    renewal_enquiry: "Renewal Enquiry",
    cancellation_enquiry: "Cancellation Enquiry",
    policy_update: "Policy/Account Update",
    opt_out: "Opt Out Request",
    breakdown_report: "Breakdown Report",
    phone_line_complaint: "Phone Line Complaint",
    myrac_enquiry: "MyRAC Enquiry",
  };
  return labels[r] || r.replace(/_/g, " ");
}

// ── API calls ────────────────────────────────────────────────────────────────
async function loadFilterOptions() {
  try {
    const res = await axios.get(ApiPath.InsightsSummaryFilters, {
      params: { filterKey: interactionFilter.value },
    });
    campaignOptions.value = res.data.campaigns ?? [];
    agentOptions.value = res.data.agents ?? [];
    outcomeOptions.value = res.data.outcomes ?? [];
    vehicleMakeOptions.value = res.data.vehicleMakes ?? [];
    vehicleModelPairs.value = res.data.vehicleModels ?? [];
    if (campaign.value && !campaignOptions.value.includes(campaign.value)) campaign.value = "";
    if (agent.value && !agentOptions.value.includes(agent.value)) agent.value = "";
    if (vehicleMake.value && !vehicleMakeOptions.value.includes(vehicleMake.value)) vehicleMake.value = "";
    vehicleModels.value = vehicleModels.value.filter((m) => vehicleModelOptions.value.includes(m));
    excludeOutcomes.value = excludeOutcomes.value.filter((o) => outcomeOptions.value.includes(o));
  } catch { /* non-critical */ }
}

watch(interactionFilter, () => { loadFilterOptions(); });

// When the make changes, drop any selected models that don't belong to it.
watch(vehicleMake, () => {
  vehicleModels.value = vehicleModels.value.filter((m) => vehicleModelOptions.value.includes(m));
});

async function loadAll() {
  loading.value = true;
  error.value = "";
  openInterest.value = {};
  interestInteractionsMap.value = {};
  loadingInterestMap.value = {};
  openCompetitor.value = {};
  competitorInteractionsMap.value = {};
  loadingCompetitorMap.value = {};
  openOpportunityReason.value = {};
  opportunityInteractionsMap.value = {};
  loadingOpportunityReasonMap.value = {};
  openParity.value = {};
  parityInteractionsMap.value = {};
  loadingParityMap.value = {};
  detailId.value = null;

  const isParity = isParityCampaign.value;
  const compareP = compareParams.value;

  try {
    const [
      csRes,
      oppRes,
      parityRes,
      trendsRes,
      csResCompare,
      oppResCompare,
      parityResCompare,
    ] = await Promise.all([
      axios.get(ApiPath.InsightsSummaryClientServices, { params: sharedParams.value }),
      axios.get(ApiPath.OpsOpportunity, { params: sharedParams.value }).catch(() => ({ data: null })),
      isParity
        ? axios.get(ApiPath.ParityCampaignAnalysis, { params: sharedParams.value }).catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
      axios.get(ApiPath.ClientServicesTrends, { params: sharedParams.value }).catch(() => ({ data: null })),
      compareP
        ? axios.get(ApiPath.InsightsSummaryClientServices, { params: compareP }).catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
      compareP
        ? axios.get(ApiPath.OpsOpportunity, { params: compareP }).catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
      compareP && isParity
        ? axios.get(ApiPath.ParityCampaignAnalysis, { params: compareP }).catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
    ]);
    csData.value = csRes.data;
    opportunityData.value = oppRes.data;
    parityData.value = parityRes.data;
    trendsData.value = trendsRes.data;
    csDataCompare.value = csResCompare.data;
    opportunityDataCompare.value = oppResCompare.data;
    parityDataCompare.value = parityResCompare.data;
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load";
  } finally {
    loading.value = false;
  }
}

// Re-fetch when comparison toggles or mode/window changes so the user doesn't
// have to click Load again. Skip the initial flush so onMounted's load wins.
watch(
  [compareEnabled, compareMode, compareFromStr, compareToStr],
  () => {
    if (!csData.value) return; // initial load hasn't happened yet
    loadAll();
  },
  { flush: "post" },
);

// Drill-down toggle for Parity sub-questions. `key` is a unique identifier
// (e.g. "consent:yes", "decision:no", "brand:BMW", "reason:price") and
// `criteria` is the backend filter to pass through.
async function toggleParity(
  key: string,
  criteria: {
    consentAnswer?: string;
    decisionAnswer?: string;
    dealerInTouch?: string;
    competitorBrand?: string;
    competitorReason?: string;
    viewKey?: string;
    viewAnswer?: string;
    affordabilityAnswer?: string;
    lifestyleVehicleAnswer?: string;
  },
) {
  // Toggle this key independently of any other open drill-down.
  if (openParity.value[key]) {
    delete openParity.value[key];
    return;
  }
  openParity.value[key] = true;
  // Re-fetch each open (avoids showing stale rows if filters changed since last open).
  loadingParityMap.value[key] = true;
  try {
    const res = await axios.get(ApiPath.ParityInteractions, {
      params: { ...sharedParams.value, ...criteria, limit: 200 },
    });
    parityInteractionsMap.value[key] = res.data;
  } catch {
    parityInteractionsMap.value[key] = [];
  } finally {
    loadingParityMap.value[key] = false;
  }
}

// Bucket helpers for the breakdown bars
function pctOfTotal(count: number, total: number): number {
  if (!total) return 0;
  return Math.round((count / total) * 100);
}

function parityAnswerChip(answer: string | null | undefined) {
  if (answer === "yes") return "chip chip--success";
  if (answer === "no") return "chip chip--danger";
  return "chip chip--secondary";
}

// Each view is now a yes/no "did the customer express a NEGATIVE view?" answer
// (yes = a concern was raised). `rowField` maps to the projected drill-down column.
const viewKeys = [
  { key: "brand", label: "View on Brand", rowField: "view_brand_answer", summaryField: "view_brand_summary", quoteField: "view_brand_quote" },
  { key: "current_vehicle", label: "View on Current Vehicle", rowField: "view_vehicle_answer", summaryField: "view_vehicle_summary", quoteField: "view_vehicle_quote" },
  { key: "dealer", label: "View on Dealer", rowField: "view_dealer_answer", summaryField: "view_dealer_summary", quoteField: "view_dealer_quote" },
  { key: "finance_agreement", label: "View on Finance Agreement", rowField: "view_finance_answer", summaryField: "view_finance_summary", quoteField: "view_finance_quote" },
] as const;

const viewBuckets = ["yes", "no"] as const;

// A negative view (yes) is the signal worth surfacing, so yes is red.
function viewAnswerChip(bucket: string | null | undefined) {
  if (bucket === "yes") return "chip chip--danger";
  if (bucket === "no") return "chip chip--success";
  return "chip chip--secondary";
}

function viewAnswerColor(bucket: string) {
  if (bucket === "yes") return "var(--danger, #ef4444)";
  if (bucket === "no") return "var(--success, #22c55e)";
  return "#94a3b8";
}

function viewAnswerLabel(bucket: string | null | undefined) {
  if (bucket === "yes") return "negative";
  if (bucket === "no") return "none";
  return "not raised";
}

// Customer Circumstances cards (affordability + lifestyle changes).
// For these questions a "yes" answer typically signals a concern (affordability
// issue, life change disrupting position), so the bar is red for yes and green
// for no — flipped from the consent/decision sections where yes is positive.
const situationKeys = [
  {
    key: "affordability_issues",
    label: "Affordability Issues",
    rowField: "affordability_answer",
    detailField: "affordability_detail",
    quoteField: "affordability_quote",
    buildCriteria: (b: string) => ({ affordabilityAnswer: b }),
  },
  {
    key: "lifestyle_change_vehicle",
    label: "Lifestyle change",
    rowField: "lifestyle_vehicle_answer",
    detailField: "lifestyle_vehicle_detail",
    quoteField: "lifestyle_vehicle_quote",
    buildCriteria: (b: string) => ({ lifestyleVehicleAnswer: b }),
  },
] as const;

function situationBarColor(bucket: string) {
  if (bucket === "yes") return "var(--danger, #ef4444)";
  if (bucket === "no") return "var(--success, #22c55e)";
  return "#94a3b8";
}

// For affordability / lifestyle, a "yes" is a concern — so yes is red, no green
// (flipped from parityAnswerChip, which treats yes as positive).
function situationAnswerChip(answer: string | null | undefined) {
  if (answer === "yes") return "chip chip--danger";
  if (answer === "no") return "chip chip--success";
  return "chip chip--secondary";
}

// ── Segment builders for the consolidated ParitySegmentBar ──────────────────
// Each card renders ONE segmented bar instead of one row per bucket. These map
// the per-bucket counts into the {key,label,chipClass,color,count,...} shape the
// bar expects, carrying the open state so chevrons reflect which drill is shown.
function viewSegments(vk: (typeof viewKeys)[number]) {
  return viewBuckets.map((bucket) => ({
    key: bucket,
    label: viewAnswerLabel(bucket),
    chipClass: viewAnswerChip(bucket),
    color: viewAnswerColor(bucket),
    count: parityData.value.views[vk.key][bucket],
    compareCount: parityDataCompare.value?.views?.[vk.key]?.[bucket] ?? null,
    open: isParityOpen("view:" + vk.key + ":" + bucket),
  }));
}

// n/a sits in the MIDDLE so the bar reads concern (left) · n/a · clear (right).
function situationSegments(sk: (typeof situationKeys)[number]) {
  return (["yes", "n_a", "no"] as const).map((bucket) => ({
    key: bucket,
    label: bucket === "n_a" ? "n/a" : bucket,
    chipClass: situationAnswerChip(bucket === "n_a" ? "n_a" : bucket),
    color: situationBarColor(bucket),
    count: parityData.value.customer_situation[sk.key][bucket],
    compareCount: parityDataCompare.value?.customer_situation?.[sk.key]?.[bucket] ?? null,
    open: isParityOpen("situation:" + sk.key + ":" + bucket),
  }));
}

// Consent: yes (agreed) is green, no is red, n/a grey — n/a in the middle.
function consentSegments() {
  return (["yes", "n_a", "no"] as const).map((bucket) => ({
    key: bucket,
    label: bucket === "n_a" ? "n/a" : bucket,
    chipClass: parityAnswerChip(bucket === "n_a" ? "n_a" : bucket),
    color: bucket === "yes" ? "var(--success, #22c55e)" : bucket === "no" ? "var(--danger, #ef4444)" : "#94a3b8",
    count: parityData.value.consent[bucket],
    compareCount: parityDataCompare.value?.consent?.[bucket] ?? null,
    open: isParityOpen("consent:" + bucket),
  }));
}

// Decision: yes (already decided) is blue, no grey — chip colours track the bar
// so the legend swatch and segment agree.
function decisionSegments() {
  return (["yes", "n_a", "no"] as const).map((bucket) => ({
    key: bucket,
    label: bucket === "n_a" ? "n/a" : bucket,
    chipClass: bucket === "yes" ? "chip chip--info" : "chip chip--secondary",
    color: bucket === "yes" ? "#0ea5e9" : bucket === "no" ? "#a3a3a3" : "#94a3b8",
    count: parityData.value.decision_made[bucket],
    compareCount: parityDataCompare.value?.decision_made?.[bucket] ?? null,
    open: isParityOpen("decision:" + bucket),
  }));
}

// Competitor identified: yes is amber (a competitor in play), no green, n/a grey.
// Display-only — there is no per-bucket drill-down for this breakdown.
function competitorSegments() {
  return (["yes", "n_a", "no"] as const).map((bucket) => ({
    key: bucket,
    label: bucket === "n_a" ? "n/a" : bucket,
    chipClass: bucket === "yes" ? "chip chip--warning" : bucket === "no" ? "chip chip--success" : "chip chip--secondary",
    color: bucket === "yes" ? "#f59e0b" : bucket === "no" ? "var(--success, #22c55e)" : "#94a3b8",
    count: parityData.value.competitors.breakdown[bucket],
    compareCount: parityDataCompare.value?.competitors?.breakdown?.[bucket] ?? null,
  }));
}

async function toggleInterest(level: string) {
  if (openInterest.value[level]) {
    delete openInterest.value[level];
    return;
  }
  openInterest.value[level] = true;
  loadingInterestMap.value[level] = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByInterestLevel, {
      params: { ...sharedParams.value, interestLevel: level, limit: 200 },
    });
    interestInteractionsMap.value[level] = res.data;
  } catch { interestInteractionsMap.value[level] = []; }
  finally { loadingInterestMap.value[level] = false; }
}

async function toggleCompetitor(competitor: string) {
  if (openCompetitor.value[competitor]) {
    delete openCompetitor.value[competitor];
    return;
  }
  openCompetitor.value[competitor] = true;
  loadingCompetitorMap.value[competitor] = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByCompetitor, {
      params: { ...sharedParams.value, competitor, limit: 200 },
    });
    competitorInteractionsMap.value[competitor] = res.data;
  } catch { competitorInteractionsMap.value[competitor] = []; }
  finally { loadingCompetitorMap.value[competitor] = false; }
}

async function toggleOpportunityReason(reason: string) {
  if (openOpportunityReason.value[reason]) {
    delete openOpportunityReason.value[reason];
    return;
  }
  openOpportunityReason.value[reason] = true;
  loadingOpportunityReasonMap.value[reason] = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByOpportunityReason, {
      params: { ...sharedParams.value, reason, limit: 200 },
    });
    opportunityInteractionsMap.value[reason] = res.data;
  } catch { opportunityInteractionsMap.value[reason] = []; }
  finally { loadingOpportunityReasonMap.value[reason] = false; }
}

function openDetail(recordingId: string) {
  detailId.value = recordingId;
}

function closeDetail() {
  detailId.value = null;
}

function selectCampaign(campaignName: string) {
  campaign.value = campaignName;
  loadAll();
}

function clearCampaign() {
  campaign.value = "";
  loadAll();
}

// ── Narrative generation ─────────────────────────────────────────────────────
const narrativeProvider = ref("openai");
const loadingNarrative = ref(false);
const narrativeResult = ref("");
const narrativeError = ref("");

async function generateNarrative() {
  loadingNarrative.value = true;
  narrativeError.value = "";
  narrativeResult.value = "";
  const narrativeType = interactionFilter.value === "chats" ? "chats_client_services" : "calls_client_services";
  try {
    const res = await axios.post(ApiPath.InsightsSummaryNarrative, null, {
      params: {
        ...sharedParams.value,
        provider: narrativeProvider.value,
        narrativeType,
      },
    });
    narrativeResult.value = toPrettyInsights(res.data?.narrative ?? res.data);
  } catch (e: any) {
    narrativeError.value = e?.response?.data?.message || e?.message || "Failed to generate narrative";
  } finally {
    loadingNarrative.value = false;
  }
}

onMounted(async () => {
  await loadFilterOptions();
  await loadAll();
});
</script>

<template>
  <div class="cs-root">
    <!-- Hero -->
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <h1 class="hero-title">Campaign Insights</h1>
          <div class="hero-subtitle">Lead generation, market intelligence, competitor activity and sales opportunity classification.</div>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="tile tile--accent">
      <div class="tile-head">
        <IconChip name="filters" />
        <div class="tile-text">
          <div class="tile-title">Filters</div>
          <div class="tile-desc">Select date range, channel and optionally filter by campaign or agent</div>
        </div>
      </div>
      <div class="tile-body">
        <div class="filters-panel">
          <!-- Left: dates, channel, campaign, agent -->
          <div class="filters-left">
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
                <label class="label">Channel</label>
                <select v-model="interactionFilter" class="select select--sm">
                  <option value="calls">Calls only</option>
                  <option value="chats">Chats only</option>
                  <option value="all">All</option>
                </select>
              </div>
            </div>
            <div class="filters-row">
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
            </div>
            <div class="filters-row">
              <button class="btn btn--primary" :disabled="loading" @click="loadAll">
                {{ loading ? "Loading..." : "Load" }}
              </button>
            </div>
          </div>

          <!-- Right: Make/Model (col 1) and Outcomes (col 2) on a shared 4-row grid
               so the controls line up across the columns:
                 row 1 = Make heading        / Exclude-Outcomes heading
                 row 2 = Make dropdown       / Select-all toggle
                 row 3 = Model heading       / Exclude test/abandoned toggle
                 row 4 = Model multi-select  / Outcomes multi-select -->
          <div class="filters-right">
            <!-- Column 1: Make + Model -->
            <label v-if="vehicleMakeOptions.length" class="label fr-c1 fr-r1">Make</label>
            <select v-if="vehicleMakeOptions.length" v-model="vehicleMake" class="select select--sm fr-c1 fr-r2">
              <option value="">All</option>
              <option v-for="m in vehicleMakeOptions" :key="m" :value="m">{{ m }}</option>
            </select>
            <label v-if="vehicleModelOptions.length" class="label fr-c1 fr-r3">
              Model
              <span v-if="vehicleMake" style="font-weight: 400; opacity: 0.6">({{ vehicleMake }} only)</span>
              <button
                v-if="vehicleModels.length"
                type="button"
                class="btn-quick-exclude"
                style="margin-left: 6px"
                @click="vehicleModels = []"
              >Clear ({{ vehicleModels.length }})</button>
            </label>
            <select v-if="vehicleModelOptions.length" v-model="vehicleModels" multiple class="select select--sm select--multi fr-c1 fr-r4" style="height: 190px">
              <option v-for="m in vehicleModelOptions" :key="m" :value="m">{{ m }}</option>
            </select>

            <!-- Column 2: Outcomes -->
            <label v-if="outcomeOptions.length" class="label fr-c2 fr-r1">Exclude Outcomes</label>
            <button
              v-if="outcomeOptions.length"
              type="button"
              class="btn-quick-exclude fr-c2 fr-r2"
              style="justify-self: start"
              @click="toggleAllOutcomes"
            >{{ allOutcomesExcluded ? "Clear all" : "Select all" }}</button>
            <button
              v-if="commonExclusionsAvailable.length"
              type="button"
              class="btn-quick-exclude fr-c2 fr-r3"
              :class="{ 'btn-quick-exclude--active': allCommonExcluded }"
              style="justify-self: start"
              @click="toggleCommonExclusions"
            >{{ allCommonExcluded ? "&#10003; Common excluded" : "Exclude test/abandoned" }}</button>
            <select v-if="outcomeOptions.length" v-model="excludeOutcomes" multiple class="select select--sm select--multi fr-c2 fr-r4" style="height: 190px">
              <optgroup v-if="commonExclusionsAvailable.length" label="Commonly excluded">
                <option v-for="o in commonExclusionsAvailable" :key="'c-' + o" :value="o">{{ o }}</option>
              </optgroup>
              <optgroup label="All outcomes">
                <option v-for="o in outcomeOptions" :key="o" :value="o">{{ o }}</option>
              </optgroup>
            </select>
          </div>
        </div>

        <!-- Compare-to controls -->
        <div class="filters-row" style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border)">
          <div class="filter-group">
            <label class="label" style="display: flex; align-items: center; gap: 6px">
              <input type="checkbox" v-model="compareEnabled" /> Compare to another period
            </label>
          </div>
          <template v-if="compareEnabled">
            <div class="filter-group">
              <label class="label">Comparison mode</label>
              <select v-model="compareMode" class="select select--sm">
                <option value="previous">Previous period (same length back)</option>
                <option value="last_year">Same period last year</option>
                <option value="custom">Custom date range</option>
              </select>
            </div>
            <template v-if="compareMode === 'custom'">
              <div class="filter-group">
                <label class="label">Compare from</label>
                <input type="date" v-model="compareFromStr" class="input input--date" />
              </div>
              <div class="filter-group">
                <label class="label">Compare to</label>
                <input type="date" v-model="compareToStr" class="input input--date" />
              </div>
            </template>
            <div v-if="compareWindowLabel" class="filter-group" style="align-self: flex-end">
              <span class="cmp-window-pill">{{ compareWindowLabel }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div v-if="error" class="error-tile" style="margin-top: 10px">
      <div class="error-title">Error</div>
      <div class="error-text">{{ error }}</div>
    </div>

    <template v-if="csData">
      <!-- Campaign filter banner — sits above the headline stats -->
      <div v-if="campaign" class="campaign-banner" style="margin-bottom: 14px">
        <div class="campaign-banner-text">
          Filtering by campaign: <strong>{{ campaign }}</strong>
        </div>
        <button class="btn btn--sm" @click="clearCampaign">Clear campaign filter</button>
      </div>

      <!-- Overview strip -->
      <div class="stats-strip">
        <div class="stat">
          <div class="stat-label">Total Interactions</div>
          <div class="stat-value">{{ csData.totals.total }}</div>
          <div v-if="csDataCompare" class="cmp-line">
            <span>vs <strong>{{ fmtInt(csDataCompare.totals.total) }}</strong></span>
            <span :class="compareClass(compareDelta(csData.totals.total, csDataCompare.totals.total).dir)">
              {{ compareArrow(compareDelta(csData.totals.total, csDataCompare.totals.total).dir) }}
              {{ compareDelta(csData.totals.total, csDataCompare.totals.total).pctLabel }}
            </span>
          </div>
        </div>
        <!-- Negative View Rate — share of customers who raised ANY negative view
             (brand / vehicle / dealer / finance). Sourced from the Parity campaign
             answers, so it only has data when the Parity campaign is in scope. -->
        <div class="stat stat--wide">
          <div class="stat-label">Negative View Rate</div>
          <template v-if="negativeViewRate !== null">
            <div class="stat-value chip chip--danger">{{ negativeViewRate }}%</div>
            <div class="stat-subnote">
              {{ fmtInt(parityData.any_negative_view) }} of {{ fmtInt(parityData.total) }} — brand · vehicle · dealer · finance
            </div>
            <div v-if="negativeViewRateCompare !== null" class="cmp-line">
              <span>vs <strong>{{ negativeViewRateCompare }}%</strong></span>
              <span :class="compareClass(compareDelta(negativeViewRate, negativeViewRateCompare).dir)">
                {{ compareArrow(compareDelta(negativeViewRate, negativeViewRateCompare).dir) }}
                {{ compareDelta(negativeViewRate, negativeViewRateCompare).pctLabel }}
              </span>
            </div>
            <div v-if="negativeViewTrend" class="trend-spark" :title="`Monthly trend: ${negativeViewTrend.first}% → ${negativeViewTrend.latest}% over ${negativeViewTrend.months} months`">
              <Sparkline :points="negativeViewTrend.points" color="#dc2626" :width="140" :height="26" />
              <span class="trend-spark-cap">monthly trend</span>
            </div>
          </template>
          <template v-else>
            <div class="stat-value chip chip--secondary">—</div>
            <div class="stat-subnote">Select the Parity campaign to populate</div>
          </template>
        </div>
        <template v-if="opportunityData && opportunityData.classified > 0">
          <div class="stat">
            <div class="stat-label">Opportunity Rate</div>
            <div class="stat-value chip chip--success">{{ Math.round(opportunityData.opportunities / opportunityData.classified * 100) }}%</div>
            <div v-if="opportunityDataCompare && opportunityDataCompare.classified > 0" class="cmp-line">
              <span>vs <strong>{{ Math.round(opportunityDataCompare.opportunities / opportunityDataCompare.classified * 100) }}%</strong></span>
              <span :class="compareClass(compareDelta(
                Math.round(opportunityData.opportunities / opportunityData.classified * 100),
                Math.round(opportunityDataCompare.opportunities / opportunityDataCompare.classified * 100)
              ).dir)">
                {{ compareArrow(compareDelta(
                  Math.round(opportunityData.opportunities / opportunityData.classified * 100),
                  Math.round(opportunityDataCompare.opportunities / opportunityDataCompare.classified * 100)
                ).dir) }}
                {{ compareDelta(
                  Math.round(opportunityData.opportunities / opportunityData.classified * 100),
                  Math.round(opportunityDataCompare.opportunities / opportunityDataCompare.classified * 100)
                ).pctLabel }}
              </span>
            </div>
            <div v-if="opportunityTrend" class="trend-spark" :title="`Monthly trend: ${opportunityTrend.first}% → ${opportunityTrend.latest}% over ${opportunityTrend.months} months`">
              <Sparkline :points="opportunityTrend.points" color="#059669" :width="140" :height="26" />
              <span class="trend-spark-cap">monthly trend</span>
            </div>
          </div>
        </template>

        <!-- Volume breakdown donuts share the overview row with the stat cards.
             Legend "vs N%" appears per slice when a compare period is loaded. -->
        <div class="stat-chart">
          <div class="stat-label">By Outcome</div>
          <OutcomeDonut :data="outcomeChartData" :compare-data="outcomeChartCompare" :size="120" />
        </div>
        <div class="stat-chart">
          <div class="stat-label">By Vehicle Make</div>
          <OutcomeDonut :data="vehicleMakeChartData" :compare-data="vehicleMakeChartCompare" :size="120" />
        </div>
      </div>

      <!-- Campaigns in Dataset -->
      <div v-if="campaignOptions.length && !campaign" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <IconChip name="campaigns" />
          <div class="tile-text">
            <div class="tile-title">Campaigns in Dataset</div>
            <div class="tile-desc">Click a campaign to filter the dashboard</div>
          </div>
        </div>
        <div class="tile-body">
          <div class="campaigns-grid">
            <div
              v-for="c in campaignOptions"
              :key="c"
              class="campaign-card"
              @click="selectCampaign(c)"
            >
              <div class="campaign-card-name">{{ c }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sales Opportunity Classification -->
      <div
        v-if="opportunityData && opportunityData.classified > 0"
        class="tile"
        style="margin-top: 14px"
      >
        <div class="tile-head">
          <IconChip name="opportunity" />
          <div class="tile-text">
            <div class="tile-title">Sales Opportunity Classification</div>
            <div class="tile-desc">Breakdown of records classified as opportunities vs not — click a reason to view individual records</div>
          </div>
        </div>
        <div class="tile-body">
          <!-- Summary strip -->
          <div class="opp-summary-strip">
            <div class="opp-stat">
              <div class="opp-stat-value">{{ opportunityData.classified }}</div>
              <div class="opp-stat-label">Classified</div>
            </div>
            <div class="opp-stat opp-stat--opportunity">
              <div class="opp-stat-value">{{ opportunityData.opportunities }}</div>
              <div class="opp-stat-label">Opportunities</div>
            </div>
            <div class="opp-stat opp-stat--not">
              <div class="opp-stat-value">{{ opportunityData.not_opportunities }}</div>
              <div class="opp-stat-label">Not Opportunities</div>
            </div>
            <div class="opp-stat">
              <div class="opp-stat-value">{{ Math.round(opportunityData.opportunities / opportunityData.classified * 100) }}%</div>
              <div class="opp-stat-label">Opportunity Rate</div>
            </div>
          </div>

          <!-- Opportunity row -->
          <div v-if="opportunityData.opportunities > 0">
            <div class="metric-row metric-row--clickable" @click="toggleOpportunityReason('__opportunity')">
              <div class="metric-left">
                <span class="chip chip--success" style="font-size: 12px">Opportunity to Sell</span>
              </div>
              <div class="metric-right">
                <span class="count-pill">{{ opportunityData.opportunities }}</span>
                <span class="expand-icon">{{ isOpportunityOpen('__opportunity') ? '&#9650;' : '&#9660;' }}</span>
              </div>
            </div>
            <div v-if="isOpportunityOpen('__opportunity')" class="drill-panel">
              <div v-if="loadingOpportunityReasonMap['__opportunity']" class="hint">Loading interactions...</div>
              <div v-else-if="!(opportunityInteractionsMap['__opportunity'] || []).length" class="hint">No interactions found.</div>
              <div
                v-else
                v-for="ix in opportunityInteractionsMap['__opportunity']"
                :key="ix.recordingId"
                class="drill-row"
                @click="openDetail(ix.recordingId)"
              >
                <div class="drill-row-top">
                  <span class="chip chip--success" style="font-size: 11px">Opportunity</span>
                  <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                  <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                  <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                </div>
                <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
              </div>
            </div>
          </div>

          <!-- Reason breakdown -->
          <div
            v-for="r in opportunityData.reason_breakdown"
            :key="r.reason"
          >
            <div class="metric-row metric-row--clickable" @click="toggleOpportunityReason(r.reason)">
              <div class="metric-left">
                <span class="chip chip--danger" style="font-size: 12px">{{ opportunityReasonLabel(r.reason) }}</span>
              </div>
              <div class="metric-right">
                <span class="count-pill">{{ r.count }}</span>
                <span class="expand-icon">{{ isOpportunityOpen(r.reason) ? '&#9650;' : '&#9660;' }}</span>
              </div>
            </div>
            <div v-if="isOpportunityOpen(r.reason)" class="drill-panel">
              <div v-if="loadingOpportunityReasonMap[r.reason]" class="hint">Loading interactions...</div>
              <div v-else-if="!(opportunityInteractionsMap[r.reason] || []).length" class="hint">No interactions found.</div>
              <div
                v-else
                v-for="ix in opportunityInteractionsMap[r.reason]"
                :key="ix.recordingId"
                class="drill-row"
                @click="openDetail(ix.recordingId)"
              >
                <div class="drill-row-top">
                  <span class="chip chip--danger" style="font-size: 11px">{{ opportunityReasonLabel(ix.not_opportunity_reason || r.reason) }}</span>
                  <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                  <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                  <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                </div>
                <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Campaign Analysis (Parity) -->
      <div v-if="parityData && parityData.total > 0" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <IconChip name="analysis" />
          <div class="tile-text">
            <div class="tile-title">Campaign Analysis &mdash; Parity</div>
            <div class="tile-desc">
              {{ parityData.total }} interaction{{ parityData.total === 1 ? '' : 's' }} with extracted Q&amp;A.
              <span v-if="parityDataCompare" class="cmp-inline">
                vs <strong>{{ fmtInt(parityDataCompare.total) }}</strong>
                <span :class="compareClass(compareDelta(parityData.total, parityDataCompare.total).dir)">
                  {{ compareArrow(compareDelta(parityData.total, parityDataCompare.total).dir) }}
                  {{ compareDelta(parityData.total, parityDataCompare.total).pctLabel }}
                </span>
                in comparison window.
              </span>
              Click a row to drill in.
            </div>
          </div>
        </div>
        <div class="tile-body">

          <!-- Row 1: Customer Decision (consent + decision) beside Customer Circumstances -->
          <div class="parity-row">
          <div class="parity-row-group">
          <div class="parity-section-divider parity-section-divider--first">
            <span class="parity-section-divider-label">Customer Decision</span>
          </div>
          <div class="views-grid views-grid--pair">
          <div class="views-card">
          <div class="views-card-title">Consent to Dealer Contact</div>

          <ParitySegmentBar
            :segments="consentSegments()"
            :total="parityData.total"
            :compare-total="parityDataCompare?.total"
            detailed-compare
            @toggle="(bucket) => toggleParity('consent:' + bucket, { consentAnswer: bucket })"
          />
          <template
            v-for="bucket in (['yes','no','n_a'] as const)"
            :key="'consent-' + bucket"
          >
            <div v-if="isParityOpen('consent:' + bucket)" class="drill-panel">
              <div v-if="loadingParityMap['consent:' + bucket]" class="hint">Loading interactions...</div>
              <div v-else-if="!(parityInteractionsMap['consent:' + bucket] || []).length" class="hint">No interactions found.</div>
              <div
                v-else
                v-for="ix in parityInteractionsMap['consent:' + bucket]"
                :key="ix.recordingId"
                class="drill-row"
                @click="openDetail(ix.recordingId)"
              >
                <div class="drill-row-top">
                  <span :class="parityAnswerChip(ix.consent_answer)" style="font-size: 11px">consent: {{ ix.consent_answer || 'n/a' }}</span>
                  <span v-if="ix.outcome" class="chip chip--info" style="font-size: 11px">outcome: {{ ix.outcome }}</span>
                  <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                  <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                </div>
                <div v-if="ix.consent_quote" class="parity-drill-quote">"{{ ix.consent_quote }}"</div>
                <div v-else class="drill-row-summary" style="opacity: 0.5">(no quote captured)</div>
              </div>
            </div>
          </template>
          </div>

          <div class="views-card">
          <div class="views-card-title">Has the customer already decided?</div>

          <ParitySegmentBar
            :segments="decisionSegments()"
            :total="parityData.total"
            :compare-total="parityDataCompare?.total"
            detailed-compare
            @toggle="(bucket) => toggleParity('decision:' + bucket, { decisionAnswer: bucket })"
          />
          <template
            v-for="bucket in (['yes','no','n_a'] as const)"
            :key="'decision-' + bucket"
          >
            <div v-if="isParityOpen('decision:' + bucket)" class="drill-panel">
              <div v-if="loadingParityMap['decision:' + bucket]" class="hint">Loading interactions...</div>
              <div v-else-if="!(parityInteractionsMap['decision:' + bucket] || []).length" class="hint">No interactions found.</div>
              <div
                v-else
                v-for="ix in parityInteractionsMap['decision:' + bucket]"
                :key="ix.recordingId"
                class="drill-row"
                @click="openDetail(ix.recordingId)"
              >
                <div class="drill-row-top">
                  <span :class="parityAnswerChip(ix.decision_answer)" style="font-size: 11px">decided: {{ ix.decision_answer || 'n/a' }}</span>
                  <span
                    class="chip"
                    :class="ix.dealer_touch_answer === 'yes' ? 'chip--info' : ix.dealer_touch_answer === 'no' ? 'chip--warning' : 'chip--secondary'"
                    style="font-size: 11px"
                  >
                    dealer in touch: {{ ix.dealer_touch_answer || 'n/a' }}
                  </span>
                  <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                  <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                  <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                </div>
                <div v-if="ix.decision_detail" class="drill-row-summary">{{ ix.decision_detail }}</div>
                <div v-else class="drill-row-summary" style="opacity: 0.5">(no decision detail)</div>
                <div v-if="ix.decision_quote" class="parity-drill-quote">"{{ ix.decision_quote }}"</div>
              </div>
            </div>
          </template>
          </div>
          </div>
          </div>

          <div class="parity-row-group">
          <div class="parity-section-divider parity-section-divider--first">
            <span class="parity-section-divider-label">Customer Circumstances</span>
          </div>
          <div class="views-grid views-grid--pair">
            <div
              v-for="sk in situationKeys"
              :key="sk.key"
              class="views-card"
            >
              <div class="views-card-title">{{ sk.label }}</div>
              <ParitySegmentBar
                :segments="situationSegments(sk)"
                :total="parityData.total"
                :compare-total="parityDataCompare?.total"
                detailed-compare
                @toggle="(bucket) => toggleParity('situation:' + sk.key + ':' + bucket, sk.buildCriteria(bucket))"
              />
              <template
                v-for="bucket in (['yes','no','n_a'] as const)"
                :key="sk.key + '-' + bucket"
              >
                <div v-if="isParityOpen('situation:' + sk.key + ':' + bucket)" class="drill-panel">
                  <div v-if="loadingParityMap['situation:' + sk.key + ':' + bucket]" class="hint">Loading interactions...</div>
                  <div v-else-if="!(parityInteractionsMap['situation:' + sk.key + ':' + bucket] || []).length" class="hint">No interactions found.</div>
                  <div
                    v-else
                    v-for="ix in parityInteractionsMap['situation:' + sk.key + ':' + bucket]"
                    :key="ix.recordingId"
                    class="drill-row"
                    @click="openDetail(ix.recordingId)"
                  >
                    <div class="drill-row-top">
                      <span :class="situationAnswerChip(ix[sk.rowField])" style="font-size: 11px">
                        {{ sk.label }}: {{ ix[sk.rowField] || 'n/a' }}
                      </span>
                      <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">outcome: {{ ix.outcome }}</span>
                      <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                      <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                    <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                    </div>
                    <div v-if="ix[sk.detailField]" class="drill-row-summary">{{ ix[sk.detailField] }}</div>
                    <div v-else class="drill-row-summary" style="opacity: 0.5">{{ ix.summary_short || "(no summary)" }}</div>
                    <div v-if="ix[sk.quoteField]" class="parity-drill-quote">"{{ ix[sk.quoteField] }}"</div>
                  </div>
                </div>
              </template>
            </div>
          </div>
          </div>
          </div>

          <!-- Customer Views -->
          <div class="parity-section-divider">
            <span class="parity-section-divider-label">Customer Views</span>
          </div>
          <div class="parity-sub-desc" style="margin-bottom: 12px">
            Whether the customer raised a NEGATIVE view of their current brand, vehicle, dealer or finance agreement.
            Click a bucket to see the underlying interactions.
          </div>

          <div class="views-grid">
            <div
              v-for="vk in viewKeys"
              :key="vk.key"
              class="views-card"
            >
              <div class="views-card-title">{{ vk.label }}</div>
              <ParitySegmentBar
                :segments="viewSegments(vk)"
                :total="parityData.total"
                :compare-total="parityDataCompare?.total"
                detailed-compare
                @toggle="(bucket) => toggleParity('view:' + vk.key + ':' + bucket, { viewKey: vk.key, viewAnswer: bucket })"
              />
              <template
                v-for="bucket in viewBuckets"
                :key="vk.key + '-' + bucket"
              >
                <div v-if="isParityOpen('view:' + vk.key + ':' + bucket)" class="drill-panel">
                  <div v-if="loadingParityMap['view:' + vk.key + ':' + bucket]" class="hint">Loading interactions...</div>
                  <div v-else-if="!(parityInteractionsMap['view:' + vk.key + ':' + bucket] || []).length" class="hint">No interactions found.</div>
                  <div
                    v-else
                    v-for="ix in parityInteractionsMap['view:' + vk.key + ':' + bucket]"
                    :key="ix.recordingId"
                    class="drill-row"
                    @click="openDetail(ix.recordingId)"
                  >
                    <div class="drill-row-top">
                      <span
                        :class="viewAnswerChip(ix[vk.rowField])"
                        style="font-size: 11px"
                      >{{ vk.label }}: {{ viewAnswerLabel(ix[vk.rowField]) }}</span>
                      <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">outcome: {{ ix.outcome }}</span>
                      <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                      <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                    <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                    </div>
                    <div v-if="ix[vk.summaryField]" class="drill-row-summary">{{ ix[vk.summaryField] }}</div>
                    <div v-else class="drill-row-summary" style="opacity: 0.5">{{ ix.summary_short || "(no summary)" }}</div>
                    <div v-if="ix[vk.quoteField]" class="parity-drill-quote">"{{ ix[vk.quoteField] }}"</div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <!-- Competitors -->
          <div class="parity-section-divider">
            <span class="parity-section-divider-label">Competitors</span>
          </div>

          <div class="parity-row parity-row--thirds">
          <div class="parity-row-group">
          <div class="parity-sub-title">Competitor identified?</div>
          <div class="parity-sub-desc">
            <strong>{{ parityData.competitors.total_with_competitor }}</strong>
            of <strong>{{ parityData.total }}</strong>
            interactions ({{ pctOfTotal(parityData.competitors.total_with_competitor, parityData.total) }}%)
            mentioned a competitor vehicle.
          </div>

          <ParitySegmentBar
            :segments="competitorSegments()"
            :total="parityData.total"
            :compare-total="parityDataCompare?.total"
            :interactive="false"
            detailed-compare
          />
          </div>

          <div class="parity-row-group">
          <!-- Competitor reasons (focus of this section) -->
          <div class="parity-sub-title">Why competitor wins</div>
          <div class="parity-sub-desc">
            Reasons cited across the {{ parityData.competitors.total_with_competitor }} interaction{{ parityData.competitors.total_with_competitor === 1 ? '' : 's' }} where a competitor was identified.
          </div>
          <div v-if="!parityData.competitors.competitor_reasons.length" class="hint">No competitor reasons extracted yet.</div>
          <div
            v-for="r in parityData.competitors.competitor_reasons"
            :key="'reason-' + r.reason"
          >
            <div
              class="metric-row metric-row--clickable"
              @click="toggleParity('reason:' + r.reason, { competitorReason: r.reason })"
            >
              <div class="metric-left">
                <span class="chip chip--info metric-chip--fixed" style="font-size: 12px" :title="String(r.reason).replace(/_/g, ' ')">{{ String(r.reason).replace(/_/g, ' ') }}</span>
                <ParityBar
                  :current="r.count"
                  :total="parityData.competitors.total_with_competitor"
                  color="#0284c7"
                  :compare-current="parityDataCompare ? compareCount(parityDataCompare.competitors?.competitor_reasons, r.reason, 'reason') : null"
                  :compare-total="parityDataCompare?.competitors?.total_with_competitor"
                />
                <span class="parity-pct">{{ pctOfTotal(r.count, parityData.competitors.total_with_competitor) }}%</span>
              </div>
              <div class="metric-right">
                <span v-if="parityDataCompare" class="cmp-pill">
                  vs <strong>{{ compareCount(parityDataCompare.competitors.competitor_reasons, r.reason, 'reason') }}</strong>
                  <span :class="compareClass(compareDelta(r.count, compareCount(parityDataCompare.competitors.competitor_reasons, r.reason, 'reason')).dir)">
                    {{ compareArrow(compareDelta(r.count, compareCount(parityDataCompare.competitors.competitor_reasons, r.reason, 'reason')).dir) }}
                    {{ compareDelta(r.count, compareCount(parityDataCompare.competitors.competitor_reasons, r.reason, 'reason')).pctLabel }}
                  </span>
                </span>
                <span class="count-pill">{{ r.count }}</span>
                <span class="expand-icon">{{ isParityOpen('reason:' + r.reason) ? '&#9650;' : '&#9660;' }}</span>
              </div>
            </div>
            <div v-if="isParityOpen('reason:' + r.reason)" class="drill-panel">
              <div v-if="loadingParityMap['reason:' + r.reason]" class="hint">Loading interactions...</div>
              <div v-else-if="!(parityInteractionsMap['reason:' + r.reason] || []).length" class="hint">No interactions found.</div>
              <div
                v-else
                v-for="ix in parityInteractionsMap['reason:' + r.reason]"
                :key="ix.recordingId"
                class="drill-row"
                @click="openDetail(ix.recordingId)"
              >
                <div class="drill-row-top">
                  <span class="chip chip--info" style="font-size: 11px">{{ String(r.reason).replace(/_/g, ' ') }}</span>
                  <span v-if="ix.competitor_brand" class="chip chip--warning" style="font-size: 11px">
                    {{ ix.competitor_brand }}<template v-if="ix.competitor_model"> / {{ ix.competitor_model }}</template>
                  </span>
                  <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">outcome: {{ ix.outcome }}</span>
                  <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                  <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                </div>
                <div v-if="ix.competitor_reasons_detail" class="drill-row-summary">{{ ix.competitor_reasons_detail }}</div>
                <div v-else class="drill-row-summary" style="opacity: 0.5">{{ ix.summary_short || "(no summary)" }}</div>
                <div v-if="ix.competitor_reasons_quote || ix.competitor_vehicle_quote" class="parity-drill-quote">"{{ ix.competitor_reasons_quote || ix.competitor_vehicle_quote }}"</div>
              </div>
            </div>
          </div>

          </div>

          <div class="parity-row-group">
          <!-- Competitor brand breakdown (secondary view) -->
          <div class="parity-sub-title">Competitor brands cited</div>
          <div class="parity-sub-desc">
            Rival makes named where a competitor was identified.
          </div>
          <div v-if="!parityData.competitors.competitor_brands.length" class="hint">No competitor brand named.</div>
          <div
            v-for="b in parityData.competitors.competitor_brands"
            :key="'brand-' + b.brand"
          >
            <div
              class="metric-row metric-row--clickable"
              @click="toggleParity('brand:' + b.brand, { competitorBrand: b.brand })"
            >
              <div class="metric-left">
                <span class="chip chip--warning metric-chip--fixed" style="font-size: 12px" :title="b.brand">{{ b.brand }}</span>
                <ParityBar
                  :current="b.count"
                  :total="parityData.competitors.total_with_competitor"
                  color="#f59e0b"
                  :compare-current="parityDataCompare ? compareCount(parityDataCompare.competitors?.competitor_brands, b.brand, 'brand') : null"
                  :compare-total="parityDataCompare?.competitors?.total_with_competitor"
                />
                <span class="parity-pct">{{ pctOfTotal(b.count, parityData.competitors.total_with_competitor) }}%</span>
              </div>
              <div class="metric-right">
                <span v-if="parityDataCompare" class="cmp-pill">
                  vs <strong>{{ compareCount(parityDataCompare.competitors.competitor_brands, b.brand, 'brand') }}</strong>
                  <span :class="compareClass(compareDelta(b.count, compareCount(parityDataCompare.competitors.competitor_brands, b.brand, 'brand')).dir)">
                    {{ compareArrow(compareDelta(b.count, compareCount(parityDataCompare.competitors.competitor_brands, b.brand, 'brand')).dir) }}
                    {{ compareDelta(b.count, compareCount(parityDataCompare.competitors.competitor_brands, b.brand, 'brand')).pctLabel }}
                  </span>
                </span>
                <span class="count-pill">{{ b.count }}</span>
                <span class="expand-icon">{{ isParityOpen('brand:' + b.brand) ? '&#9650;' : '&#9660;' }}</span>
              </div>
            </div>
            <div v-if="isParityOpen('brand:' + b.brand)" class="drill-panel">
              <div v-if="loadingParityMap['brand:' + b.brand]" class="hint">Loading interactions...</div>
              <div v-else-if="!(parityInteractionsMap['brand:' + b.brand] || []).length" class="hint">No interactions found.</div>
              <div
                v-else
                v-for="ix in parityInteractionsMap['brand:' + b.brand]"
                :key="ix.recordingId"
                class="drill-row"
                @click="openDetail(ix.recordingId)"
              >
                <div class="drill-row-top">
                  <span class="chip chip--warning" style="font-size: 11px">
                    {{ ix.competitor_brand || b.brand }}<template v-if="ix.competitor_model"> / {{ ix.competitor_model }}</template>
                  </span>
                  <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">outcome: {{ ix.outcome }}</span>
                  <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                  <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                </div>
                <div v-if="ix.competitor_reasons_detail" class="drill-row-summary">{{ ix.competitor_reasons_detail }}</div>
                <div v-else class="drill-row-summary" style="opacity: 0.5">{{ ix.summary_short || "(no summary)" }}</div>
                <div v-if="ix.competitor_reasons_quote || ix.competitor_vehicle_quote" class="parity-drill-quote">"{{ ix.competitor_reasons_quote || ix.competitor_vehicle_quote }}"</div>
              </div>
            </div>
          </div>
          </div>
          </div>

        </div>
      </div>

      <!-- Client Services Metrics — hidden on Parity (the Parity tile covers it) -->
      <div v-if="!isParityCampaign" class="grid grid-2" style="margin-top: 14px">
        <!-- Customer Interest -->
        <div class="tile">
          <div class="tile-head">
            <IconChip name="trends" />
            <div class="tile-text">
              <div class="tile-title">Customer Interest</div>
              <div class="tile-desc">Click an interest level to see individual interactions</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!csData.by_interest.length">No data.</div>
            <div
              v-for="r in csData.by_interest"
              :key="r.interest_level"
            >
              <div class="metric-row metric-row--clickable" @click="toggleInterest(r.interest_level)">
                <div class="metric-left">
                  <span :class="badgeClass(r.interest_level)">{{ r.interest_level }}</span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ r.count }}</span>
                  <span class="expand-icon">{{ isInterestOpen(r.interest_level) ? '&#9650;' : '&#9660;' }}</span>
                </div>
              </div>
              <div v-if="isInterestOpen(r.interest_level)" class="drill-panel">
                <div v-if="loadingInterestMap[r.interest_level]" class="hint">Loading interactions...</div>
                <div v-else-if="!(interestInteractionsMap[r.interest_level] || []).length" class="hint">No interactions found.</div>
                <div
                  v-else
                  v-for="ix in interestInteractionsMap[r.interest_level]"
                  :key="ix.recordingId"
                  class="drill-row"
                  @click="openDetail(ix.recordingId)"
                >
                  <div class="drill-row-top">
                    <span :class="badgeClass(ix.interest_level || r.interest_level)" style="font-size: 11px">{{ ix.interest_level || r.interest_level }}</span>
                    <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                    <span v-if="ix.campaign" class="chip chip--secondary" style="font-size: 11px">{{ ix.campaign }}</span>
                    <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                    <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                  </div>
                  <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Competitor Purchases & Objections -->
        <div class="tile">
          <div class="tile-head">
            <IconChip name="comparison" />
            <div class="tile-text">
              <div class="tile-title">Competitor Purchases &amp; Objections</div>
              <div class="tile-desc">Click a competitor to see individual interactions</div>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!csData.top_competitors.length">No data.</div>
            <div
              v-for="c in csData.top_competitors"
              :key="c.competitor"
              style="margin-bottom: 10px"
            >
              <div class="metric-row metric-row--clickable" @click="toggleCompetitor(c.competitor)">
                <div class="metric-left">
                  <span class="chip chip--warning">{{ c.competitor }}</span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ c.count }}</span>
                  <span class="expand-icon">{{ isCompetitorOpen(c.competitor) ? '&#9650;' : '&#9660;' }}</span>
                </div>
              </div>
              <div
                v-if="c.top_objections && c.top_objections.length && !isCompetitorOpen(c.competitor)"
                style="padding-left: 12px; margin-top: 3px"
              >
                <div
                  v-for="o in c.top_objections"
                  :key="o.objection"
                  style="font-size: 12px; display: flex; justify-content: space-between; margin-bottom: 2px; color: var(--muted)"
                >
                  <span>{{ o.objection }}</span>
                  <span class="count-pill" style="font-size: 11px; margin-left: 8px">{{ o.count }}</span>
                </div>
              </div>
              <div v-if="isCompetitorOpen(c.competitor)" class="drill-panel">
                <div v-if="loadingCompetitorMap[c.competitor]" class="hint">Loading interactions...</div>
                <div v-else-if="!(competitorInteractionsMap[c.competitor] || []).length" class="hint">No interactions found.</div>
                <div
                  v-else
                  v-for="ix in competitorInteractionsMap[c.competitor]"
                  :key="ix.recordingId"
                  class="drill-row"
                  @click="openDetail(ix.recordingId)"
                >
                  <div class="drill-row-top">
                    <span class="chip chip--warning" style="font-size: 11px">{{ ix.competitor_purchased || c.competitor }}</span>
                    <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                    <span v-if="ix.campaign" class="chip chip--secondary" style="font-size: 11px">{{ ix.campaign }}</span>
                    <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                    <span v-if="ix.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="ix.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ ix.dealer_name }}<sup v-if="ix.dealer_inferred" class="chip-infer">*</sup></span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span><span v-if="ix.interactionTpsId" class="drill-row-tps" title="TPS ID">{{ ix.interactionTpsId }}</span>
                  </div>
                  <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Top Dealer Follow-ups -->
      <div v-if="!isParityCampaign && csData.top_dealers.length" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <IconChip name="dealer" />
          <div class="tile-text">
            <div class="tile-title">Top Dealer Follow-ups</div>
            <div class="tile-desc">Dealers with the most lead follow-ups</div>
          </div>
        </div>
        <div class="tile-body">
          <div
            v-for="d in csData.top_dealers"
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
      </div>

      <!-- Recent Lost Sales -->
      <div v-if="!isParityCampaign && csData.recent_lost_sales.length" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <IconChip name="lost" />
          <div class="tile-text">
            <div class="tile-title">Recent Lost Sales</div>
            <div class="tile-desc">Click to view full interaction detail</div>
          </div>
        </div>
        <div class="tile-body">
          <div
            v-for="x in csData.recent_lost_sales"
            :key="x.recordingId"
            class="drill-row"
            @click="openDetail(x.recordingId)"
          >
            <div class="drill-row-top">
              <span class="chip chip--danger" style="font-size: 11px">lost sale</span>
              <span v-if="x.competitor_purchased" class="chip chip--warning" style="font-size: 11px">{{ x.competitor_purchased }}</span>
              <span class="chip chip--secondary" style="font-size: 11px">{{ x.campaign_detected || "unknown" }}</span>
              <span v-if="x.dealer_name" class="chip chip--dealer" style="font-size: 11px" :title="x.dealer_inferred ? 'Dealer — inferred from transcript (no source dealer)' : 'Dealer — from source data'">&#127970; {{ x.dealer_name }}<sup v-if="x.dealer_inferred" class="chip-infer">*</sup></span>
              <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(x.interactionDateTime) }}</span>
            </div>
            <div class="drill-row-summary">{{ x.summary_short || "(no summary)" }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- Generate Narrative -->
    <div v-if="csData" class="tile" style="margin-top: 14px">
      <div class="tile-head">
        <IconChip name="narrative" />
        <div class="tile-text">
          <div class="tile-title">Generate Narrative</div>
          <div class="tile-desc">AI-generated executive briefing based on current filters</div>
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
          <button class="btn btn--primary" :disabled="loadingNarrative" @click="generateNarrative">
            {{ loadingNarrative ? "Generating..." : "Generate Narrative" }}
          </button>
        </div>
        <div v-if="narrativeError" class="error-tile">{{ narrativeError }}</div>
        <div v-if="narrativeResult" class="narrative-box"><pre class="narrative-pre">{{ narrativeResult }}</pre></div>
        <div v-else-if="!loadingNarrative" class="hint">Click Generate to create an AI briefing from the current client services data.</div>
      </div>
    </div>

    <InteractionDetailDrawer :recording-id="detailId" @close="closeDetail" />
  </div>
</template>

<style scoped>
.cs-root {
  position: relative;
}

/* ── Campaigns grid ─────────────────────────────────────────────────────────── */
.campaigns-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.campaign-card {
  padding: 10px 14px;
  border-radius: var(--radius-md, 6px);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s;
  background: var(--surface);
}

.campaign-card:hover {
  border-color: var(--brand, #6366f1);
  background: color-mix(in srgb, var(--brand, #6366f1) 6%, var(--surface));
  box-shadow: 0 0 0 1px var(--brand, #6366f1);
}

.campaign-card-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}

/* ── Campaign comparison banner ───────────────────────────────────────────── */
.campaign-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--brand, #6366f1) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--brand, #6366f1) 30%, transparent);
}

.campaign-banner-text {
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

/* ── Opportunity summary strip ──────────────────────────────────────────────── */
.opp-summary-strip {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
  padding: 12px 14px;
  background: var(--surface-soft, #f8f8f8);
  border-radius: var(--radius-md, 6px);
  border: 1px solid var(--border);
}

.opp-stat {
  text-align: center;
  min-width: 80px;
}

.opp-stat-value {
  font-size: 20px;
  font-weight: 800;
  color: var(--ink);
}

.opp-stat-label {
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.opp-stat--opportunity .opp-stat-value {
  color: var(--success, #22c55e);
}

.opp-stat--not .opp-stat-value {
  color: var(--danger, #ef4444);
}

/* ── Stats strip ──────────────────────────────────────────────────────────── */
.stats-strip {
  display: flex;
  gap: 16px 24px;
  flex-wrap: wrap;
  align-items: flex-start;
  margin-top: 14px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
/* Negative View Rate gets more room for its breakdown subnote. */
.stat--wide {
  min-width: 220px;
}
/* Donut breakdowns sit in the same overview row as the stat cards, set off by a
   light divider. They wrap to the next line on narrow viewports. */
.stat-chart {
  flex: 1 1 320px;
  min-width: 300px;
  padding-left: 24px;
  border-left: 1px solid var(--border);
}
.stat-chart .stat-label {
  margin-bottom: 8px;
}
.stat-subnote {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}

/* ── Filters panel (two sides) ────────────────────────────────────────────── */
.filters-panel {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  align-items: flex-start;
}
.filters-left {
  flex: 1 1 340px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.filters-right {
  flex: 1 1 340px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 18px;
  row-gap: 6px;
  align-items: start;
}
/* Shared 4-row grid so each control lines up with its counterpart in the other
   column: heading/heading, make-dropdown/select-all, model-heading/exclude-test,
   multi-select/multi-select. */
.fr-c1 { grid-column: 1; }
.fr-c2 { grid-column: 2; }
.fr-r1 { grid-row: 1; }
.fr-r2 { grid-row: 2; }
.fr-r3 { grid-row: 3; }
.fr-r4 { grid-row: 4; }
.filters-right .select {
  width: 100%;
  min-width: 0;
}
@media (max-width: 760px) {
  .filters-right {
    grid-template-columns: 1fr;
  }
  .filters-right > * {
    grid-column: 1 !important;
    grid-row: auto !important;
  }
}

/* ── Exclude outcomes ─────────────────────────────────────────────────────── */
.exclude-outcomes-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.btn-quick-exclude {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: var(--radius-md, 6px);
  border: 1px dashed var(--border);
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn-quick-exclude:hover {
  border-color: var(--brand, #6366f1);
  color: var(--brand, #6366f1);
}

.btn-quick-exclude--active {
  border-style: solid;
  border-color: var(--brand, #6366f1);
  background: color-mix(in srgb, var(--brand, #6366f1) 10%, var(--surface));
  color: var(--brand, #6366f1);
}

/* ── Clickable metric rows ──────────────────────────────────────────────────── */
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

/* ── Drill-down panel ────────────────────────────────────────────────────── */
.drill-panel {
  padding: 8px 0 8px 12px;
  border-left: 3px solid var(--brand, #6366f1);
  margin: 4px 0 8px 8px;
}

.drill-row {
  position: relative;
  padding: 8px 10px;
  padding-bottom: 18px;
  border-radius: var(--radius-md, 6px);
  cursor: pointer;
  transition: background 0.15s;
}

/* TPS id pinned to the bottom-right of each drill-down item */
.drill-row-tps {
  position: absolute;
  right: 10px;
  bottom: 5px;
  font-family: var(--mono, monospace);
  font-size: 10px;
  opacity: 0.5;
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

/* ── Dimension rows ──────────────────────────────────────────────────────── */
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

.dim-bar {
  height: 100%;
  transition: width 0.4s ease;
  border-radius: 3px;
}

.dim-chip {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 700;
}

/* ── Score bucket chips ─────────────────────────────────────────────────── */
.bucket-chip--below5 {
  background: color-mix(in srgb, #ef4444 15%, transparent);
  color: #dc2626;
  border: 1px solid color-mix(in srgb, #ef4444 40%, transparent);
}

.bucket-chip--5to7 {
  background: color-mix(in srgb, #f97316 12%, transparent);
  color: #ea580c;
  border: 1px solid color-mix(in srgb, #f97316 35%, transparent);
}

.bucket-chip--7to9 {
  background: color-mix(in srgb, #0ea5e9 12%, transparent);
  color: #0284c7;
  border: 1px solid color-mix(in srgb, #0ea5e9 35%, transparent);
}

.bucket-chip--9plus {
  background: color-mix(in srgb, #10b981 12%, transparent);
  color: #059669;
  border: 1px solid color-mix(in srgb, #10b981 35%, transparent);
}

/* ── QA scoring in detail drawer ──────────────────────────────────────────── */
.qa-section {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.qa-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.qa-section-title {
  font-size: 12px;
  font-weight: 800;
  text-transform: capitalize;
  color: var(--ink);
}

.qa-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  flex-wrap: wrap;
}

.qa-label {
  font-size: 12px;
  min-width: 140px;
  text-transform: capitalize;
  color: var(--ink);
}

.qa-rationale {
  font-size: 11px;
  color: var(--muted);
  flex: 1;
  min-width: 120px;
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
  width: min(1400px, 95vw);
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
  padding: 14px 20px;
  background: linear-gradient(135deg, #1a3a5c 0%, #2b6cb0 100%);
  color: #fff;
  flex-shrink: 0;
}

.drawer-header-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.drawer-title {
  font-size: 15px;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.02em;
}

.drawer-header-sub {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.75);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-header-sep {
  margin: 0 5px;
  opacity: 0.5;
}

.drawer-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.drawer-header-score {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 38px;
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 800;
  color: #fff;
}

.drawer-close {
  background: rgba(255, 255, 255, 0.15);
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #fff;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  line-height: 1;
}

.drawer-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.drawer-columns {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  height: 100%;
}

.drawer-col {
  overflow-y: auto;
  min-height: 0;
  border-right: 1px solid var(--border);
}

.drawer-col:last-child {
  border-right: none;
}

@media (max-width: 900px) {
  .drawer-columns {
    grid-template-columns: 1fr;
  }
  .drawer-col {
    border-right: none;
    border-bottom: 1px solid var(--border);
  }
  .drawer-col:last-child {
    border-bottom: none;
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
  grid-template-columns: auto 1fr auto 1fr;
  gap: 5px 10px;
  align-items: baseline;
}

.drawer-meta-grid > div {
  display: contents;
}

.drawer-value {
  font-size: 13px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
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
  padding: 8px 4px;
}

.chat-msg { display: flex; }
.chat-msg--agent { justify-content: flex-start; }
.chat-msg--customer { justify-content: flex-end; }

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

.chat-sender { font-size: 11px; font-weight: 700; margin-bottom: 2px; opacity: 0.7; }
.chat-content { margin-bottom: 4px; }
.chat-time { font-size: 10px; opacity: 0.5; text-align: right; }

.drawer-transcript {
  margin: 0;
  font-size: 12px;
  font-family: ui-monospace, "Courier New", monospace;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--surface-soft, #f8f8f8);
  padding: 12px;
  border-radius: var(--radius-md, 6px);
  line-height: 1.6;
}

/* ── Narrative ─────────────────────────────────────────────────────────────── */
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

/* ── Parity campaign analysis ───────────────────────────────────────────────── */
.parity-sub-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin: 8px 0 2px;
}

.parity-sub-desc {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
}

/* Consent + decision shown side by side */
.parity-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 28px;
  align-items: start;
}
.parity-col {
  min-width: 0;
}
@media (max-width: 720px) {
  .parity-two-col {
    grid-template-columns: 1fr;
  }
}

/* Section-specific quote shown inside a parity drill-down row */
.parity-drill-quote {
  font-style: italic;
  opacity: 0.75;
  font-size: 12px;
  margin-top: 3px;
}

.parity-section-divider {
  display: flex;
  align-items: center;
  margin: 22px 0 10px;
  padding-top: 14px;
  border-top: 2px dashed var(--border);
}

.parity-section-divider-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
}

.parity-bar-track {
  flex: 1;
  height: 8px;
  background: var(--border);
  border-radius: 4px;
  overflow: hidden;
  min-width: 80px;
  max-width: 360px;
  display: inline-block;
  margin: 0 10px;
  vertical-align: middle;
}

.parity-bar {
  display: block;
  height: 100%;
  border-radius: 4px;
  transition: width 0.25s ease;
}

.parity-pct {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink);
  min-width: 34px;
  text-align: right;
}

.views-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  margin-bottom: 8px;
}

/* Two section-groups (Customer Decision + Customer Circumstances) sharing one
   row; each wraps to its own line on narrow screens. */
.parity-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 28px;
}
.parity-row-group {
  flex: 1 1 380px;
  min-width: 0;
}
/* Three columns (Competitors: identified · why-wins · brands-cited). */
.parity-row--thirds .parity-row-group {
  flex-basis: 240px;
}

/* Fixed-width label chip for the competitor reason/brand rows: truncates with
   an ellipsis so the bars, %s and counts beside it all line up. Full text is in
   the title tooltip and the drill-down rows. */
.metric-chip--fixed {
  flex: 0 0 96px;
  max-width: 96px;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  box-sizing: border-box;
}
/* The paired cards inside a half-width group are compact (single segment bar),
   so allow a tighter min-width than the full-row views-grid. */
.views-grid--pair {
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}
/* Row-1 dividers sit at the top of the tile body — drop the usual top margin. */
.parity-section-divider--first {
  margin-top: 0;
}

.views-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.02);
}

.views-card-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink);
  margin-bottom: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

/* ── Period-vs-period comparison styling ───────────────────────────────────── */
.cmp-window-pill {
  display: inline-block;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px dashed var(--border);
  background: rgba(2, 132, 199, 0.08);
  font-size: 11px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
}

/* Subtitle under stats-strip values: "vs 1,234 ▲ +5.4%" */
.cmp-line {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
}

.trend-spark {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.trend-spark-cap {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.cmp-line strong {
  color: var(--ink);
  font-weight: 700;
}

/* Inline compare badge used inside metric-right (Consent / Decision /
   Competitors breakdown / brand / reason rows). */
.cmp-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.04);
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}

.cmp-pill strong {
  color: var(--ink);
  font-weight: 700;
}

/* Inline text inside the Parity tile description. */
.cmp-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 6px;
  font-size: 12px;
  color: var(--muted);
}

/* Compact arrow + compare-count inside the views-row count cell. */
.views-cmp {
  display: inline-block;
  margin-left: 4px;
  font-size: 10px;
  font-weight: 600;
}

.cmp-up   { color: #16a34a; font-weight: 700; }
.cmp-down { color: #dc2626; font-weight: 700; }
.cmp-flat { color: #94a3b8; }

/* Compact one-row layout for view sentiment buckets.
   Grid columns: [chip] [flexible bar] [%] [|] [count] [▼]
   The pipe column is an explicit divider so the % and the count never crowd
   each other when the card is narrow. */
.views-row {
  display: grid;
  grid-template-columns: 78px 1fr 34px 1px 30px 12px;
  align-items: center;
  column-gap: 8px;
  padding: 5px 4px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.views-row--compare {
  grid-template-columns: 70px 1fr 30px 1px 76px 12px;
}

.views-row:hover {
  background: rgba(0, 0, 0, 0.04);
}

.views-row > .chip {
  text-align: center;
  width: 100%;
  box-sizing: border-box;
}

.views-bar-track {
  margin: 0;
  min-width: 0;
  max-width: none;
  width: auto;
  height: 6px;
}

.views-pct {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink);
  text-align: right;
  white-space: nowrap;
}

.views-row::after {
  /* divider lives in column 4 — empty grid cell with a left border */
  content: "";
  width: 1px;
  height: 18px;
  background: var(--border);
  grid-column: 4;
  grid-row: 1;
  justify-self: center;
}

.views-count {
  font-size: 11px;
  font-weight: 800;
  color: var(--ink);
  text-align: right;
  white-space: nowrap;
}

.views-expand {
  margin-left: 0;
  text-align: right;
  font-size: 10px;
  color: var(--muted);
}

/* ── Drawer transition ──────────────────────────────────────────────────────── */
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.25s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
}
</style>
