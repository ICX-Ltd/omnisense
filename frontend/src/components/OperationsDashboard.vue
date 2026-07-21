<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref, watch } from "vue";
import { ApiPath } from "@/enums/api";
import { toPrettyInsights } from "@/utils/insights-response";
import InteractionDetailDrawer from "./InteractionDetailDrawer.vue";
import Sparkline from "@/components/Sparkline.vue";

// ── Filters ──────────────────────────────────────────────────────────────────
const campaignOptions = ref<string[]>([]);
const agentOptions = ref<string[]>([]);
const outcomeOptions = ref<string[]>([]);
const excludeOutcomes = ref<string[]>([]);

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
const excludePartial = ref(false);

const sharedParams = computed(() => ({
  from: from.value,
  to: to.value,
  filterKey: interactionFilter.value,
  ...(campaign.value && { campaign: campaign.value }),
  ...(agent.value && { agent: agent.value }),
  ...(excludeOutcomes.value.length && { excludeOutcomes: excludeOutcomes.value.join(',') }),
}));

// Ops metrics endpoint is the only one that uses excludePartial today.
// Keep it separate so it doesn't accidentally flow into the other endpoints.
const opsMetricsParams = computed(() => ({
  ...sharedParams.value,
  ...(excludePartial.value && { excludePartial: "true" }),
}));

const flagCounts = computed(() => ({
  opsPartial: opsData.value?.scoring_flags?.ops_partial_count ?? 0,
  opsLowScore: opsData.value?.scoring_flags?.ops_low_score_count ?? 0,
  qaPartial: opsData.value?.scoring_flags?.qa_partial_count ?? 0,
  qaLowScore: opsData.value?.scoring_flags?.qa_low_score_count ?? 0,
}));

// ── Monthly headline trends (rolling 12-month sparklines) ─────────────────────
const opsTrends = ref<any>(null);

// Builds a sparkline series from an aggregate array. `betterWhenHigher` colours
// the trend arrow green/red appropriately (QC score up = good; alert rate up =
// bad). `asRateOf` turns a count into a % of another per-month array.
function opsTrend(
  values: Array<number | null> | undefined,
  betterWhenHigher: boolean,
  asRateOf?: Array<number | null>,
) {
  const t = opsTrends.value;
  if (!t?.months?.length || !values) return null;
  const pts = t.months.map((_: string, i: number) => {
    const raw = values[i];
    if (asRateOf) {
      const den = asRateOf[i] ?? 0;
      return den ? Math.round(((Number(raw) || 0) / den) * 1000) / 10 : 0;
    }
    return raw == null ? 0 : Math.round(Number(raw) * 10) / 10;
  });
  if (pts.length < 2) return null;
  const first = pts[0] ?? 0;
  const latest = pts[pts.length - 1] ?? 0;
  const improving = betterWhenHigher ? latest >= first : latest <= first;
  return { points: pts, first, latest, months: pts.length, betterWhenHigher, improving };
}

const avgScoreTrend = computed(() => opsTrend(opsTrends.value?.avg_score, true));
const avgQaScoreTrend = computed(() => opsTrend(opsTrends.value?.avg_qa_score, true));
const lowScoreAlertTrend = computed(() =>
  opsTrend(opsTrends.value?.low_score_alerts, false, opsTrends.value?.total),
);
const volumeTrend = computed(() => opsTrend(opsTrends.value?.total, true));
const hasOpsTrends = computed(
  () => !!(avgScoreTrend.value || avgQaScoreTrend.value || lowScoreAlertTrend.value || volumeTrend.value),
);
function trendArrow(t: { improving: boolean; first: number; latest: number } | null) {
  if (!t) return "";
  if (t.latest > t.first) return "▲";
  if (t.latest < t.first) return "▼";
  return "▶";
}

// ── Agent trajectory (per-agent QC-score trend over rolling months) ───────────
type AgentTraj = {
  agent: string;
  points: Array<number | null>;
  scoredMonths: number;
  total: number;
  first: number | null;
  latest: number | null;
  avg: number | null;
  delta: number | null;
};
const agentTrajectory = ref<{ months: string[]; agents: AgentTraj[] } | null>(null);
const trajSort = ref<"latest" | "improved" | "declined">("latest");
const trajShowAll = ref(false);

// Sparkline needs a clean numeric series; drop the null (no-work) months so the
// line reflects only the agent's scored months in order.
function trajPoints(a: AgentTraj): number[] {
  return a.points.filter((p): p is number => p != null);
}
const sortedTrajectory = computed<AgentTraj[]>(() => {
  const list = [...(agentTrajectory.value?.agents ?? [])];
  if (trajSort.value === "improved") {
    list.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
  } else if (trajSort.value === "declined") {
    list.sort((a, b) => (a.delta ?? Infinity) - (b.delta ?? Infinity));
  } else {
    list.sort((a, b) => (b.latest ?? -1) - (a.latest ?? -1));
  }
  return list;
});
const visibleTrajectory = computed<AgentTraj[]>(() =>
  trajShowAll.value ? sortedTrajectory.value : sortedTrajectory.value.slice(0, 12),
);
function deltaClass(d: number | null) {
  if (d == null || d === 0) return "traj-flat";
  return d > 0 ? "traj-up" : "traj-down";
}
function deltaLabel(d: number | null) {
  if (d == null) return "—";
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "▶";
  return `${d > 0 ? "+" : ""}${d} ${arrow}`;
}

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

const expandedOutcome = ref<string | null>(null);
const outcomeInteractions = ref<any[]>([]);
const loadingOutcome = ref(false);

type FlagLayer = "ops" | "qa";
const partialLayer = ref<FlagLayer>("ops");
const expandedPartialOutcome = ref<string | null>(null);
const partialOutcomeInteractions = ref<any[]>([]);
const loadingPartialOutcome = ref(false);

const lowScoreLayer = ref<FlagLayer>("ops");
const expandedLowScoreAgent = ref<string | null>(null);
const lowScoreAgentInteractions = ref<any[]>([]);
const loadingLowScoreAgent = ref(false);

const partialByOutcomeRows = computed(() => {
  if (!opsData.value) return [];
  return partialLayer.value === "qa"
    ? opsData.value.partial_by_outcome_qa ?? []
    : opsData.value.partial_by_outcome_ops ?? [];
});

const lowScoreByAgentRows = computed(() => {
  if (!opsData.value) return [];
  return lowScoreLayer.value === "qa"
    ? opsData.value.low_score_by_agent_qa ?? []
    : opsData.value.low_score_by_agent_ops ?? [];
});

function setPartialLayer(layer: FlagLayer) {
  if (partialLayer.value === layer) return;
  partialLayer.value = layer;
  expandedPartialOutcome.value = null;
  partialOutcomeInteractions.value = [];
}

function setLowScoreLayer(layer: FlagLayer) {
  if (lowScoreLayer.value === layer) return;
  lowScoreLayer.value = layer;
  expandedLowScoreAgent.value = null;
  lowScoreAgentInteractions.value = [];
}

// Objection assessment state
const objectionAssessData = ref<any>(null);
const expandedObjectionCat = ref<string | null>(null);
const objectionCatInteractions = ref<any[]>([]);
const loadingObjectionCat = ref(false);
const objectionOppsOnly = ref(false);

// Chat response-time state (chats / all only)
const chatResponseData = ref<any>(null);
const showChatResponse = computed(() => interactionFilter.value !== "calls");

// Returned by the backend only when an agent filter is in effect. Holds the
// all-agents baseline summary the UI overlays as comparison figures.
const chatResponseComparison = computed(
  () => chatResponseData.value?.comparison?.summary ?? null,
);

// Opportunity state
const opportunityData = ref<any>(null);
const expandedOpportunityReason = ref<string | null>(null);
const opportunityInteractions = ref<any[]>([]);
const loadingOpportunityReason = ref(false);

// Detail drawer
const detailId = ref<string | null>(null);

// Vulnerable customers (Consumer Duty — QA Q13)
const vulnData = ref<any>(null);
const vulnList = ref<any[]>([]);
const vulnAnswer = ref<"yes" | "no" | null>(null);
const loadingVuln = ref(false);
async function loadVulnList(answer: "yes" | "no") {
  if (vulnAnswer.value === answer) { vulnAnswer.value = null; vulnList.value = []; return; }
  vulnAnswer.value = answer;
  loadingVuln.value = true;
  try {
    const res = await axios.get(ApiPath.OpsVulnerabilityInteractions, {
      params: { ...sharedParams.value, answer, limit: 200 },
    });
    vulnList.value = res.data ?? [];
  } catch {
    vulnList.value = [];
  } finally {
    loadingVuln.value = false;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtScore(v: number | null | undefined) {
  if (typeof v !== "number" || v === null) return "n/a";
  return v.toFixed(1);
}

// Consistent four-band scoring: red (<5), orange (5-7), blue (7-9), green (9+)
const SCORE_RED = "#dc2626";
const SCORE_ORANGE = "#ea580c";
const SCORE_BLUE = "#0284c7";
const SCORE_GREEN = "#059669";

// Solid colour for chips
function scoreColorSolid(v: number | null) {
  if (typeof v !== "number") return "#ccc";
  if (v >= 9) return SCORE_GREEN;
  if (v >= 7) return SCORE_BLUE;
  if (v >= 5) return SCORE_ORANGE;
  return SCORE_RED;
}

// Gradient for bars — softens from a lighter tint to the full band colour
function scoreColor(v: number | null) {
  if (typeof v !== "number") return "#ccc";
  let light: string, full: string;
  if (v >= 9) { light = "#a7f3d0"; full = SCORE_GREEN; }
  else if (v >= 7) { light = "#bae6fd"; full = SCORE_BLUE; }
  else if (v >= 5) { light = "#fed7aa"; full = SCORE_ORANGE; }
  else { light = "#fecaca"; full = SCORE_RED; }
  return `linear-gradient(90deg, ${light}, ${full})`;
}

function scoreChip(_v: number | null) {
  if (typeof _v !== "number") return "chip chip--secondary";
  if (_v >= 9) return "chip bucket-chip--9plus";
  if (_v >= 7) return "chip bucket-chip--7to9";
  if (_v >= 5) return "chip bucket-chip--5to7";
  return "chip bucket-chip--below5";
}

// Format a duration in seconds as e.g. "1m 23s" / "45s" / "n/a"
function fmtSeconds(v: number | null | undefined) {
  if (typeof v !== "number" || !isFinite(v)) return "n/a";
  const rounded = Math.round(v);
  if (rounded < 60) return `${rounded}s`;
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// Colour chip for response-time scalars — under 60s green, under SLA (180) orange, breach red.
function responseTimeChip(v: number | null | undefined) {
  if (typeof v !== "number") return "chip chip--secondary";
  if (v > 180) return "chip bucket-chip--below5";
  if (v > 60) return "chip bucket-chip--5to7";
  return "chip bucket-chip--9plus";
}

// Signed delta for "agent vs all-agents" — negative is good (faster).
function chatRtDelta(agentVal: number | null | undefined, allVal: number | null | undefined) {
  if (typeof agentVal !== "number" || typeof allVal !== "number") return "";
  const delta = Math.round(agentVal - allVal);
  if (delta === 0) return "0s";
  const abs = Math.abs(delta);
  const fmt = abs < 60 ? `${abs}s` : `${Math.round(abs / 60)}m`;
  return `${delta > 0 ? "+" : "−"}${fmt}`;
}

function chatRtDeltaClass(agentVal: number | null | undefined, allVal: number | null | undefined) {
  if (typeof agentVal !== "number" || typeof allVal !== "number") return "";
  // For response time, lower is better — green when agent is faster than baseline.
  if (agentVal < allVal) return "dim-delta--positive";
  if (agentVal > allVal) return "dim-delta--negative";
  return "";
}

function fmtDate(iso: string | null) {
  if (!iso) return "n/a";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function opportunityReasonLabel(r: string) {
  const labels: Record<string, string> = {
    __unclassified: "Unable to Classify",
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

// RAC QA dimension definitions grouped by section
const qaQuestionLabels: Record<string, string> = {
  q1_polite_friendly: "Q1 Polite & Friendly",
  q2_clear_understandable: "Q2 Clear & Understandable",
  q3_accurate_info: "Q3 Accurate Info",
  q4_next_steps_clear: "Q4 Next Steps Clear",
  q5_polite_friendly: "Q5 Polite & Friendly",
  q6_services_clear: "Q6 Services Clear",
  q7_next_steps_clear: "Q7 Next Steps Clear",
  q8_accurate_info: "Q8 Accurate Info",
  q9_id_verification: "Q9 ID Verification",
  q10_fair_not_misleading: "Q10 Fair & Not Misleading",
  q11_needs_established: "Q11 Needs Established",
  q12_best_interest: "Q12 Best Interest",
  q13_vulnerability: "Q13 Vulnerability",
  q14_brand_representation: "Q14 Brand Representation",
  q15_eligible_products: "Q15 Eligible Products",
};

const qaSections = [
  { key: "correct_process", label: "Correct Process", scoreKey: "correct_process_score", questions: ["q1_polite_friendly", "q2_clear_understandable", "q3_accurate_info", "q4_next_steps_clear"] },
  { key: "service_standard", label: "Service Standard", scoreKey: "service_standard_score", questions: ["q5_polite_friendly", "q6_services_clear", "q7_next_steps_clear", "q8_accurate_info"] },
  { key: "right_outcome", label: "Right Outcome", scoreKey: "right_outcome_score", questions: ["q9_id_verification", "q10_fair_not_misleading", "q11_needs_established", "q12_best_interest", "q13_vulnerability", "q14_brand_representation", "q15_eligible_products"] },
];

const hasQaData = computed(() => {
  const qa = dimData.value?.qa_overall;
  return qa && typeof qa.correct_process_score === "number";
});

// Format QA scores (0-10 with 2dp)
function fmtQaScore(v: number | null | undefined) {
  if (typeof v !== "number" || v === null) return "n/a";
  return v.toFixed(2);
}

// Objection rate colour helpers
function rateColorSolid(rate: number | null | undefined): string {
  if (typeof rate !== "number") return "#ccc";
  if (rate >= 0.7) return "#059669";
  if (rate >= 0.4) return "#ea580c";
  return "#dc2626";
}

function agentObjCat(category: string) {
  return objectionAssessData.value?.agent?.categories?.find((c: any) => c.category === category) ?? null;
}

function agentChecklist(itemName: string) {
  return objectionAssessData.value?.agent?.checklist?.find((c: any) => c.item === itemName) ?? null;
}

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
  if (b === "below_5") return "chip bucket-chip--below5";
  if (b === "5_to_7") return "chip bucket-chip--5to7";
  if (b === "7_to_9") return "chip bucket-chip--7to9";
  return "chip bucket-chip--9plus";
}

// Slate gradient for overall bars when comparing
function overallCompareColor(v: number | null) {
  if (typeof v !== "number") return "#ccc";
  const lightness = 75 - (v / 10) * 30;
  const light = `hsl(215, 15%, ${lightness + 15}%)`;
  const full = `hsl(215, 18%, ${lightness}%)`;
  return `linear-gradient(90deg, ${light}, ${full})`;
}

// Solid slate for chips in compare mode
function overallCompareColorSolid(v: number | null) {
  if (typeof v !== "number") return "#ccc";
  const lightness = 75 - (v / 10) * 30;
  return `hsl(215, 18%, ${lightness}%)`;
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
const qaOverallScore = computed(() => dimData.value?.qa_overall?.qa_overall_score ?? null);
const qaAgentScore = computed(() => dimData.value?.qa_agent?.qa_overall_score ?? null);
const overallCount = computed(() => dimData.value?.overall?.count ?? 0);
const agentCount = computed(() => dimData.value?.agent?.count ?? 0);
const agentsInData = computed(() =>
  [...(dimData.value?.agents_in_data ?? [])].sort(
    (a: any, b: any) => (b.avg_score ?? 0) - (a.avg_score ?? 0),
  ),
);

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
    const res = await axios.get(ApiPath.InsightsSummaryFilters, {
      params: { filterKey: interactionFilter.value },
    });
    campaignOptions.value = res.data.campaigns ?? [];
    agentOptions.value = res.data.agents ?? [];
    outcomeOptions.value = res.data.outcomes ?? [];
    // Clear selections that are no longer valid for this channel
    if (campaign.value && !campaignOptions.value.includes(campaign.value)) campaign.value = "";
    if (agent.value && !agentOptions.value.includes(agent.value)) agent.value = "";
    excludeOutcomes.value = excludeOutcomes.value.filter((o) => outcomeOptions.value.includes(o));
  } catch { /* non-critical */ }
}

watch(interactionFilter, () => { loadFilterOptions(); });

async function loadAll() {
  loading.value = true;
  error.value = "";
  expandedBucket.value = null;
  expandedNeed.value = null;
  expandedOutcome.value = null;
  expandedOpportunityReason.value = null;
  expandedObjectionCat.value = null;
  expandedPartialOutcome.value = null;
  expandedLowScoreAgent.value = null;
  detailId.value = null;

  try {
    const [opsRes, dimRes, oppRes, chatRtRes, vulnRes, trendRes, trajRes] = await Promise.all([
      axios.get(ApiPath.InsightsSummaryOperations, { params: opsMetricsParams.value }),
      axios.get(ApiPath.OpsDimensions, { params: opsMetricsParams.value }),
      axios.get(ApiPath.OpsOpportunity, { params: sharedParams.value }).catch(() => ({ data: null })),
      showChatResponse.value
        ? axios.get(ApiPath.OpsChatResponseTime, { params: sharedParams.value }).catch(() => ({ data: null }))
        : Promise.resolve({ data: null }),
      axios.get(ApiPath.OpsVulnerability, { params: sharedParams.value }).catch(() => ({ data: null })),
      axios.get(ApiPath.InsightsSummaryOperationsTrends, { params: sharedParams.value }).catch(() => ({ data: null })),
      axios.get(ApiPath.InsightsSummaryAgentTrajectory, { params: sharedParams.value }).catch(() => ({ data: null })),
    ]);
    opsData.value = opsRes.data;
    dimData.value = dimRes.data;
    opportunityData.value = oppRes.data;
    chatResponseData.value = chatRtRes.data;
    vulnData.value = vulnRes.data;
    opsTrends.value = trendRes.data;
    agentTrajectory.value = trajRes.data;
    trajShowAll.value = false;
    vulnList.value = [];
    vulnAnswer.value = null;
    await fetchObjectionAssessments();
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load";
  } finally {
    loading.value = false;
  }
}

async function fetchObjectionAssessments() {
  expandedObjectionCat.value = null;
  try {
    const res = await axios.get(ApiPath.InsightsSummaryObjectionAssessments, {
      params: { ...sharedParams.value, opportunitiesOnly: objectionOppsOnly.value || undefined },
    });
    objectionAssessData.value = res.data;
  } catch { objectionAssessData.value = null; }
}

watch(objectionOppsOnly, () => { fetchObjectionAssessments(); });

async function toggleBucket(bucket: string) {
  if (expandedBucket.value === bucket) {
    expandedBucket.value = null;
    return;
  }
  expandedBucket.value = bucket;
  loadingBucket.value = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByBucket, {
      params: { ...sharedParams.value, bucket, limit: 200 },
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
      params: { ...sharedParams.value, need, limit: 200 },
    });
    needInteractions.value = res.data;
  } catch { needInteractions.value = []; }
  finally { loadingNeed.value = false; }
}

async function toggleOutcome(outcome: string) {
  if (expandedOutcome.value === outcome) {
    expandedOutcome.value = null;
    return;
  }
  expandedOutcome.value = outcome;
  loadingOutcome.value = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByOutcome, {
      params: { ...sharedParams.value, outcome, limit: 200 },
    });
    outcomeInteractions.value = res.data;
  } catch { outcomeInteractions.value = []; }
  finally { loadingOutcome.value = false; }
}

async function togglePartialOutcome(outcome: string) {
  if (expandedPartialOutcome.value === outcome) {
    expandedPartialOutcome.value = null;
    return;
  }
  expandedPartialOutcome.value = outcome;
  loadingPartialOutcome.value = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByPartialOutcome, {
      params: { ...sharedParams.value, outcome, layer: partialLayer.value, limit: 200 },
    });
    partialOutcomeInteractions.value = res.data;
  } catch { partialOutcomeInteractions.value = []; }
  finally { loadingPartialOutcome.value = false; }
}

async function toggleLowScoreAgent(agentName: string) {
  if (expandedLowScoreAgent.value === agentName) {
    expandedLowScoreAgent.value = null;
    return;
  }
  expandedLowScoreAgent.value = agentName;
  loadingLowScoreAgent.value = true;
  try {
    const { agent: _filterAgent, ...rest } = sharedParams.value as Record<string, any>;
    const res = await axios.get(ApiPath.OpsInteractionsByLowScoreAgent, {
      params: {
        ...rest,
        agent: agentName,
        ...(agent.value ? { filterAgent: agent.value } : {}),
        layer: lowScoreLayer.value,
        limit: 200,
      },
    });
    lowScoreAgentInteractions.value = res.data;
  } catch { lowScoreAgentInteractions.value = []; }
  finally { loadingLowScoreAgent.value = false; }
}

async function toggleOpportunityReason(reason: string) {
  if (expandedOpportunityReason.value === reason) {
    expandedOpportunityReason.value = null;
    return;
  }
  expandedOpportunityReason.value = reason;
  loadingOpportunityReason.value = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByOpportunityReason, {
      params: { ...sharedParams.value, reason, limit: 200 },
    });
    opportunityInteractions.value = res.data;
  } catch { opportunityInteractions.value = []; }
  finally { loadingOpportunityReason.value = false; }
}

async function toggleObjectionCategory(category: string) {
  if (expandedObjectionCat.value === category) {
    expandedObjectionCat.value = null;
    return;
  }
  expandedObjectionCat.value = category;
  loadingObjectionCat.value = true;
  try {
    const res = await axios.get(ApiPath.OpsInteractionsByObjectionCategory, {
      params: { ...sharedParams.value, category, limit: 200, opportunitiesOnly: objectionOppsOnly.value || undefined },
    });
    objectionCatInteractions.value = res.data;
  } catch { objectionCatInteractions.value = []; }
  finally { loadingObjectionCat.value = false; }
}

function openDetail(recordingId: string) {
  detailId.value = recordingId;
}

function closeDetail() {
  detailId.value = null;
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
  const narrativeType = interactionFilter.value === "chats" ? "chats_operations" : "calls_operations";
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
  <div class="ops-root">
    <!-- Hero -->
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <h1 class="hero-title">Operations (QC)</h1>
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
          <div v-if="outcomeOptions.length" class="filter-group">
            <label class="label">Exclude Outcomes</label>
            <div class="exclude-outcomes-wrap">
              <button
                v-if="commonExclusionsAvailable.length"
                class="btn-quick-exclude"
                :class="{ 'btn-quick-exclude--active': allCommonExcluded }"
                @click="toggleCommonExclusions"
              >
                {{ allCommonExcluded ? "&#10003; Common excluded" : "Exclude test/abandoned" }}
              </button>
              <select v-model="excludeOutcomes" multiple class="select select--sm select--multi">
                <optgroup v-if="commonExclusionsAvailable.length" label="Commonly excluded">
                  <option v-for="o in commonExclusionsAvailable" :key="'c-' + o" :value="o">{{ o }}</option>
                </optgroup>
                <optgroup label="All outcomes">
                  <option v-for="o in outcomeOptions" :key="o" :value="o">{{ o }}</option>
                </optgroup>
              </select>
            </div>
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
      <!-- Rolling 12-month headline trends (sparklines) -->
      <div v-if="hasOpsTrends" class="spark-strip">
        <div v-if="avgScoreTrend" class="spark-card">
          <div class="spark-head">
            <span class="spark-title">Avg QC score</span>
            <span class="spark-latest">{{ avgScoreTrend.latest }} <span :class="avgScoreTrend.improving ? 'spark-good' : 'spark-bad'">{{ trendArrow(avgScoreTrend) }}</span></span>
          </div>
          <Sparkline :points="avgScoreTrend.points" :color="avgScoreTrend.improving ? '#059669' : '#dc2626'" :width="150" :height="30" />
          <div class="spark-sub">{{ avgScoreTrend.first }} → {{ avgScoreTrend.latest }} over {{ avgScoreTrend.months }} months</div>
        </div>
        <div v-if="avgQaScoreTrend" class="spark-card">
          <div class="spark-head">
            <span class="spark-title">Avg QA score</span>
            <span class="spark-latest">{{ avgQaScoreTrend.latest }} <span :class="avgQaScoreTrend.improving ? 'spark-good' : 'spark-bad'">{{ trendArrow(avgQaScoreTrend) }}</span></span>
          </div>
          <Sparkline :points="avgQaScoreTrend.points" :color="avgQaScoreTrend.improving ? '#059669' : '#dc2626'" :width="150" :height="30" />
          <div class="spark-sub">{{ avgQaScoreTrend.first }} → {{ avgQaScoreTrend.latest }} over {{ avgQaScoreTrend.months }} months</div>
        </div>
        <div v-if="lowScoreAlertTrend" class="spark-card">
          <div class="spark-head">
            <span class="spark-title">Low-score alert rate</span>
            <span class="spark-latest">{{ lowScoreAlertTrend.latest }}% <span :class="lowScoreAlertTrend.improving ? 'spark-good' : 'spark-bad'">{{ trendArrow(lowScoreAlertTrend) }}</span></span>
          </div>
          <Sparkline :points="lowScoreAlertTrend.points" :color="lowScoreAlertTrend.improving ? '#059669' : '#dc2626'" :width="150" :height="30" />
          <div class="spark-sub">{{ lowScoreAlertTrend.first }}% → {{ lowScoreAlertTrend.latest }}% over {{ lowScoreAlertTrend.months }} months</div>
        </div>
        <div v-if="volumeTrend" class="spark-card">
          <div class="spark-head">
            <span class="spark-title">Volume</span>
            <span class="spark-latest">{{ volumeTrend.latest }} <span class="spark-neutral">{{ trendArrow(volumeTrend) }}</span></span>
          </div>
          <Sparkline :points="volumeTrend.points" color="#6366f1" :width="150" :height="30" />
          <div class="spark-sub">{{ volumeTrend.first }} → {{ volumeTrend.latest }} interactions/month</div>
        </div>
      </div>

      <!-- Score overview: interactions + grouped ops/qa panels + flag tiles -->
      <div class="summary-grid">
        <div class="summary-hero">
          <div class="summary-hero-label">Interactions</div>
          <div class="summary-hero-value">{{ overallCount }}</div>
          <div v-if="agent" class="summary-hero-sub">{{ agentCount }} for {{ agent }}</div>
        </div>

        <!-- Operations panel: scores + ops flags -->
        <div class="score-panel score-panel--ops">
          <div class="score-panel-head">
            <span class="score-panel-title">Operations</span>
            <span class="score-panel-hint">{{ opsData.score_stats.scored_count }} scored</span>
          </div>
          <div class="score-panel-body">
            <template v-if="agent && agentScore !== null">
              <div class="mini-stat">
                <div class="mini-stat-label">Overall</div>
                <div class="mini-stat-value" :class="scoreChip(overallScore)">{{ fmtScore(overallScore) }}</div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">{{ agent }}</div>
                <div class="mini-stat-value" :class="scoreChip(agentScore)">{{ fmtScore(agentScore) }}</div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">Delta</div>
                <div class="mini-stat-value" :class="agentScore >= overallScore ? 'chip chip--success' : 'chip chip--danger'">
                  {{ agentScore >= overallScore ? '+' : '' }}{{ fmtScore(agentScore - overallScore) }}
                </div>
              </div>
            </template>
            <template v-else>
              <div class="mini-stat">
                <div class="mini-stat-label">Avg</div>
                <div class="mini-stat-value" :class="scoreChip(overallScore)">{{ fmtScore(overallScore) }}</div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">Min</div>
                <div class="mini-stat-value">{{ fmtScore(opsData.score_stats.min_score) }}</div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">Max</div>
                <div class="mini-stat-value">{{ fmtScore(opsData.score_stats.max_score) }}</div>
              </div>
            </template>
          </div>
          <div class="score-panel-flags">
            <div class="panel-flag panel-flag--ops" :class="{ 'panel-flag--active': flagCounts.opsPartial > 0 }" title="Records where at least one operations dimension could not be fairly scored (customer disengagement, limited conversation, etc.)">
              <div class="panel-flag-label">Partial</div>
              <div class="panel-flag-value">{{ flagCounts.opsPartial }}</div>
            </div>
            <div class="panel-flag panel-flag--ops" :class="{ 'panel-flag--active': flagCounts.opsLowScore > 0 }" title="Records where at least one operations dimension scored ≤4, regardless of overall average">
              <div class="panel-flag-label">Low score</div>
              <div class="panel-flag-value">{{ flagCounts.opsLowScore }}</div>
            </div>
          </div>
        </div>

        <!-- QA panel: scores + qa flags -->
        <div class="score-panel score-panel--qa">
          <div class="score-panel-head">
            <span class="score-panel-title">QA</span>
            <span class="score-panel-hint">{{ opsData.qa_score_stats?.scored_count ?? 0 }} scored</span>
          </div>
          <div class="score-panel-body" v-if="(opsData.qa_score_stats?.scored_count ?? 0) > 0">
            <template v-if="agent && qaAgentScore !== null">
              <div class="mini-stat">
                <div class="mini-stat-label">Overall</div>
                <div class="mini-stat-value" :class="scoreChip(qaOverallScore)">{{ fmtScore(qaOverallScore) }}</div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">{{ agent }}</div>
                <div class="mini-stat-value" :class="scoreChip(qaAgentScore)">{{ fmtScore(qaAgentScore) }}</div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">Delta</div>
                <div class="mini-stat-value" :class="(qaAgentScore ?? 0) >= (qaOverallScore ?? 0) ? 'chip chip--success' : 'chip chip--danger'">
                  {{ (qaAgentScore ?? 0) >= (qaOverallScore ?? 0) ? '+' : '' }}{{ fmtScore((qaAgentScore ?? 0) - (qaOverallScore ?? 0)) }}
                </div>
              </div>
            </template>
            <template v-else>
              <div class="mini-stat">
                <div class="mini-stat-label">Avg</div>
                <div class="mini-stat-value" :class="scoreChip(opsData.qa_score_stats?.avg_score)">{{ fmtScore(opsData.qa_score_stats?.avg_score) }}</div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">Min</div>
                <div class="mini-stat-value">{{ fmtScore(opsData.qa_score_stats?.min_score) }}</div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-label">Max</div>
                <div class="mini-stat-value">{{ fmtScore(opsData.qa_score_stats?.max_score) }}</div>
              </div>
            </template>
          </div>
          <div v-else class="score-panel-empty">No QA-scored records in this window.</div>
          <div class="score-panel-flags">
            <div class="panel-flag panel-flag--qa" :class="{ 'panel-flag--active': flagCounts.qaPartial > 0 }" title="Records where one or more QA questions were answered n/a (vulnerability not present, agent had no chance to act, etc.)">
              <div class="panel-flag-label">Partial</div>
              <div class="panel-flag-value">{{ flagCounts.qaPartial }}</div>
            </div>
            <div class="panel-flag panel-flag--qa" :class="{ 'panel-flag--active': flagCounts.qaLowScore > 0 }" title="Records where one or more QA questions were answered 'no', even when section averages look acceptable">
              <div class="panel-flag-label">Low score</div>
              <div class="panel-flag-value">{{ flagCounts.qaLowScore }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Agents in dataset (positioned before Chat Response Time so users
           can pick an agent first, then see their comparison numbers below) -->
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
              v-for="(a, idx) in agentsInData"
              :key="a.agent"
              class="agent-card"
              @click="selectAgent(a.agent)"
            >
              <div class="agent-card-name"><span class="agent-rank">#{{ idx + 1 }}</span> {{ a.agent }}</div>
              <div class="agent-card-stats">
                <span :class="scoreChip(a.avg_score)" style="font-size: 11px">{{ fmtScore(a.avg_score) }}</span>
                <span class="agent-card-count">{{ a.count }} interactions</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Agent Trajectory — per-agent QC score trend over a rolling 12 months -->
      <div v-if="agentTrajectory?.agents?.length" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128200;</div>
          <div class="tile-text">
            <div class="tile-title">Agent Trajectory</div>
            <div class="tile-desc">Rolling 12-month average QC score per agent — the trend, not just a snapshot. Click an agent to filter the dashboard.</div>
          </div>
          <div class="traj-sort">
            <button class="btn btn--sm" :class="{ 'btn--primary': trajSort === 'latest' }" @click="trajSort = 'latest'">Latest score</button>
            <button class="btn btn--sm" :class="{ 'btn--primary': trajSort === 'improved' }" @click="trajSort = 'improved'">Most improved</button>
            <button class="btn btn--sm" :class="{ 'btn--primary': trajSort === 'declined' }" @click="trajSort = 'declined'">Biggest decline</button>
          </div>
        </div>
        <div class="tile-body">
          <div class="traj-list">
            <div
              v-for="a in visibleTrajectory"
              :key="a.agent"
              class="traj-row"
              @click="selectAgent(a.agent)"
              title="Filter the dashboard to this agent"
            >
              <div class="traj-name">{{ a.agent }}</div>
              <Sparkline :points="trajPoints(a)" :color="(a.delta ?? 0) >= 0 ? '#059669' : '#dc2626'" :width="140" :height="28" />
              <span class="traj-latest" :class="scoreChip(a.latest)">{{ fmtScore(a.latest) }}</span>
              <span class="traj-delta" :class="deltaClass(a.delta)">{{ deltaLabel(a.delta) }}</span>
              <span class="traj-total">{{ a.total }} · {{ a.scoredMonths }}mo</span>
            </div>
          </div>
          <button
            v-if="sortedTrajectory.length > 12"
            class="btn btn--sm"
            style="margin-top: 10px"
            @click="trajShowAll = !trajShowAll"
          >
            {{ trajShowAll ? "Show top 12" : `Show all ${sortedTrajectory.length}` }}
          </button>
        </div>
      </div>

      <!-- Agent comparison banner — sits above the chat response section -->
      <div v-if="agent" class="agent-banner" style="margin-top: 14px">
        <div class="agent-banner-text">
          Comparing <strong>{{ agent }}</strong> ({{ agentCount }} interactions) against overall average ({{ overallCount }} interactions)
        </div>
        <button class="btn btn--sm" @click="clearAgent">Clear agent filter</button>
      </div>

      <!-- Chat response time (chats / all filters only). Shown whenever chat data
           was loaded — even if the current selection has no measured chats — so
           picking an agent never makes the whole section vanish. -->
      <div
        v-if="showChatResponse && chatResponseData"
        class="tile"
        style="margin-top: 14px"
      >
        <div class="tile-head">
          <div class="tile-icon">&#9201;</div>
          <div class="tile-text">
            <div class="tile-title">Chat Response Time</div>
            <div class="tile-desc">
              <template v-if="chatResponseComparison">
                Agent reply speed for <strong>{{ agent }}</strong> across {{ chatResponseData.summary.chats_measured }} chat{{ chatResponseData.summary.chats_measured === 1 ? '' : 's' }}
                &middot; compared against {{ chatResponseComparison.chats_measured }} all-agent chat{{ chatResponseComparison.chats_measured === 1 ? '' : 's' }}
              </template>
              <template v-else>
                Agent reply speed across {{ chatResponseData.summary.chats_measured }} chat{{ chatResponseData.summary.chats_measured === 1 ? '' : 's' }}
              </template>
              &middot; SLA threshold {{ Math.round((chatResponseData.sla_threshold_seconds ?? 180) / 60) }} min
              &middot; auto-messages excluded
            </div>
          </div>
        </div>
        <div class="tile-body">
          <template v-if="(chatResponseData.summary?.chats_measured ?? 0) > 0">
          <div v-if="chatResponseComparison" class="dim-legend" style="margin-bottom: 12px">
            <span class="dim-legend-item"><span class="dim-swatch dim-swatch--agent" /> {{ agent }}</span>
            <span class="dim-legend-item"><span class="dim-swatch dim-swatch--overall" /> All agents</span>
          </div>

          <div class="summary-grid" style="grid-template-columns: repeat(4, minmax(140px, 1fr));">
            <div class="score-panel">
              <div class="score-panel-head"><span class="score-panel-title">Avg Response</span></div>
              <div class="score-panel-body">
                <div class="mini-stat">
                  <div class="mini-stat-value" :class="responseTimeChip(chatResponseData.summary.avg_response_seconds)">
                    {{ fmtSeconds(chatResponseData.summary.avg_response_seconds) }}
                  </div>
                  <div class="mini-stat-label">
                    <template v-if="chatResponseComparison">
                      vs <span class="chat-rt-compare">{{ fmtSeconds(chatResponseComparison.avg_response_seconds) }}</span>
                      <span class="chat-rt-delta" :class="chatRtDeltaClass(chatResponseData.summary.avg_response_seconds, chatResponseComparison.avg_response_seconds)">{{ chatRtDelta(chatResponseData.summary.avg_response_seconds, chatResponseComparison.avg_response_seconds) }}</span>
                    </template>
                    <template v-else>across all turns</template>
                  </div>
                </div>
              </div>
            </div>

            <div class="score-panel">
              <div class="score-panel-head"><span class="score-panel-title">Longest Response</span></div>
              <div class="score-panel-body">
                <div class="mini-stat">
                  <div class="mini-stat-value" :class="responseTimeChip(chatResponseData.summary.max_longest_seconds)">
                    {{ fmtSeconds(chatResponseData.summary.max_longest_seconds) }}
                  </div>
                  <div class="mini-stat-label">
                    <template v-if="chatResponseComparison">
                      vs <span class="chat-rt-compare">{{ fmtSeconds(chatResponseComparison.max_longest_seconds) }}</span>
                      <span class="chat-rt-delta" :class="chatRtDeltaClass(chatResponseData.summary.max_longest_seconds, chatResponseComparison.max_longest_seconds)">{{ chatRtDelta(chatResponseData.summary.max_longest_seconds, chatResponseComparison.max_longest_seconds) }}</span>
                    </template>
                    <template v-else>worst single gap</template>
                  </div>
                </div>
              </div>
            </div>

            <div class="score-panel">
              <div class="score-panel-head"><span class="score-panel-title">Last-Response Avg</span></div>
              <div class="score-panel-body">
                <div class="mini-stat">
                  <div class="mini-stat-value" :class="responseTimeChip(chatResponseData.summary.avg_last_response_seconds)">
                    {{ fmtSeconds(chatResponseData.summary.avg_last_response_seconds) }}
                  </div>
                  <div class="mini-stat-label">
                    <template v-if="chatResponseComparison">
                      vs <span class="chat-rt-compare">{{ fmtSeconds(chatResponseComparison.avg_last_response_seconds) }}</span>
                      <span class="chat-rt-delta" :class="chatRtDeltaClass(chatResponseData.summary.avg_last_response_seconds, chatResponseComparison.avg_last_response_seconds)">{{ chatRtDelta(chatResponseData.summary.avg_last_response_seconds, chatResponseComparison.avg_last_response_seconds) }}</span>
                    </template>
                    <template v-else>final customer → agent</template>
                  </div>
                </div>
              </div>
            </div>

            <div class="score-panel">
              <div class="score-panel-head"><span class="score-panel-title">SLA Breaches</span></div>
              <div class="score-panel-body">
                <div class="mini-stat">
                  <div
                    class="mini-stat-value"
                    :class="(chatResponseData.summary.sla_breach_total ?? 0) > 0 ? 'chip bucket-chip--below5' : 'chip bucket-chip--9plus'"
                  >
                    {{ chatResponseData.summary.sla_breach_total ?? 0 }}
                  </div>
                  <div class="mini-stat-label">
                    {{ chatResponseData.summary.chats_with_breach ?? 0 }} chats &middot;
                    {{
                      chatResponseData.summary.sla_breach_rate !== null
                        ? (chatResponseData.summary.sla_breach_rate * 100).toFixed(1) + '% of turns'
                        : 'no turns'
                    }}
                    <template v-if="chatResponseComparison">
                      <br />
                      vs <span class="chat-rt-compare">{{ chatResponseComparison.sla_breach_total }}</span> breach{{ chatResponseComparison.sla_breach_total === 1 ? '' : 'es' }}
                      ({{ chatResponseComparison.sla_breach_rate !== null ? (chatResponseComparison.sla_breach_rate * 100).toFixed(1) + '%' : '—' }} all agents)
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </template>
          <div v-else class="hint" style="padding: 4px 0">
            No measured chat responses for {{ agent ? agent : 'this selection' }} in this window
            (auto-messages are excluded, and a chat needs at least one customer&rarr;agent reply gap to measure).
          </div>

          <div
            v-if="chatResponseData.worst_by_agent?.length || chatResponseData.slowest_chats?.length"
            class="slowest-row"
            style="margin-top: 14px"
          >
            <!-- Slowest Agents — full cross-agent leaderboard, never filtered to the
                 selected agent so you can still see the ranking (and where they sit). -->
            <div v-if="chatResponseData.worst_by_agent?.length" class="slowest-col">
              <div class="tile-title" style="font-size: 13px; margin-bottom: 6px">Slowest Agents</div>
              <table class="slowest-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th class="num">Chats</th>
                    <th class="num">SLA</th>
                    <th class="num">Avg</th>
                    <th class="num">Longest</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in chatResponseData.worst_by_agent"
                    :key="row.agent"
                    :class="{ 'slowest-me': agent && row.agent === agent }"
                  >
                    <td class="slowest-name" :title="row.agent">{{ row.agent }}</td>
                    <td class="num">{{ row.chats }}</td>
                    <td class="num">
                      <span v-if="row.sla_breach_count > 0" class="chip bucket-chip--below5">{{ row.sla_breach_count }}</span>
                      <span v-else class="muted">0</span>
                    </td>
                    <td class="num"><span :class="responseTimeChip(row.avg_response_seconds)">{{ fmtSeconds(row.avg_response_seconds) }}</span></td>
                    <td class="num"><span :class="responseTimeChip(row.max_longest_seconds)">{{ fmtSeconds(row.max_longest_seconds) }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Slowest Chats -->
            <div v-if="chatResponseData.slowest_chats?.length" class="slowest-col">
              <div class="tile-title" style="font-size: 13px; margin-bottom: 6px">Slowest Chats<template v-if="agent"> — {{ agent }}</template></div>
              <table class="slowest-table">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th class="num">Longest</th>
                    <th class="num">Avg</th>
                    <th class="num">Last</th>
                    <th class="num">SLA</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in chatResponseData.slowest_chats"
                    :key="row.recordingId"
                    class="slowest-clickable"
                    :title="row.summary_short || '(no summary)'"
                    @click="detailId = row.recordingId"
                  >
                    <td class="slowest-name" :title="row.agent || 'unknown'">{{ row.agent || 'unknown' }}</td>
                    <td class="num"><span :class="responseTimeChip(row.longest_seconds)">{{ fmtSeconds(row.longest_seconds) }}</span></td>
                    <td class="num">{{ fmtSeconds(row.avg_seconds) }}</td>
                    <td class="num">{{ fmtSeconds(row.last_seconds) }}</td>
                    <td class="num">
                      <span v-if="(row.sla_breach_count ?? 0) > 0" class="chip bucket-chip--below5">{{ row.sla_breach_count }}</span>
                      <span v-else class="muted">0</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Dimension Averages + QA Assessment Averages, side by side -->
      <div class="dim-averages-row" style="margin-top: 14px">
      <!-- Dimension Averages -->
      <div class="tile dim-averages-tile">
        <div class="tile-head">
          <div class="tile-icon">&#128202;</div>
          <div class="tile-text">
            <div class="tile-title">Dimension Averages</div>
            <div class="tile-desc">
              {{ agent ? `Comparing ${agent} against overall average` : "Overall dimension scores across all agents" }}
            </div>
          </div>
          <label class="tile-toggle" title="Exclude records where one or more dimensions were scored as n/a (partial scoring) from the dimension averages.">
            <input type="checkbox" v-model="excludePartial" @change="loadAll" />
            <span>Exclude partial scores</span>
          </label>
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
                    background: agent ? overallCompareColor(d.overall) : scoreColor(d.overall),
                  }"
                />
              </div>
              <!-- Agent bar (distinct colour) -->
              <div v-if="agent && d.agent !== null" class="dim-bar-track dim-bar-track--agent">
                <div
                  class="dim-bar"
                  :style="{ width: (d.agent / 10 * 100) + '%', background: scoreColor(d.agent) }"
                />
              </div>
            </div>
            <div class="dim-scores">
              <span
                class="dim-chip"
                :style="{ background: agent ? overallCompareColorSolid(d.overall) : scoreColorSolid(d.overall), color: '#fff', fontSize: '11px', minWidth: '36px', textAlign: 'center' }"
              >{{ fmtScore(d.overall) }}</span>
              <template v-if="agent && d.agent !== null">
                <span
                  class="dim-chip"
                  :style="{ background: scoreColorSolid(d.agent), color: '#fff', fontSize: '11px', minWidth: '36px', textAlign: 'center' }"
                >{{ fmtScore(d.agent) }}</span>
                <span
                  class="dim-delta"
                  :class="d.agent >= (d.overall ?? 0) ? 'dim-delta--positive' : 'dim-delta--negative'"
                >
                  {{ d.agent >= (d.overall ?? 0) ? "+" : "" }}{{ fmtScore(d.agent - (d.overall ?? 0)) }}
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- QA Dimension Averages (RAC-style campaigns) -->
      <div v-if="hasQaData" class="tile dim-averages-tile">
        <div class="tile-head">
          <div class="tile-icon">&#9989;</div>
          <div class="tile-text">
            <div class="tile-title">QA Assessment Averages</div>
            <div class="tile-desc">
              {{ agent ? `Comparing ${agent} against overall average` : "Percentage of 'yes' answers across all assessed interactions" }}
            </div>
          </div>
        </div>
        <div class="tile-body">
          <div v-if="agent" class="dim-legend" style="margin-bottom: 14px">
            <span class="dim-legend-item"><span class="dim-swatch dim-swatch--overall" /> Overall average</span>
            <span class="dim-legend-item"><span class="dim-swatch dim-swatch--agent" /> {{ agent }}</span>
          </div>

          <template v-for="section in qaSections" :key="section.key">
            <!-- Section header with section_score -->
            <div class="qa-dim-section-header">
              <span class="qa-dim-section-title">{{ section.label }}</span>
              <div style="display: flex; gap: 4px; align-items: center">
                <span
                  class="dim-chip"
                  :style="{ background: agent ? overallCompareColorSolid(dimData.qa_overall?.[section.scoreKey]) : scoreColorSolid(dimData.qa_overall?.[section.scoreKey]), color: '#fff', fontSize: '11px', minWidth: '42px', textAlign: 'center' }"
                >{{ fmtQaScore(dimData.qa_overall?.[section.scoreKey]) }}</span>
                <template v-if="agent && dimData.qa_agent?.[section.scoreKey] != null">
                  <span
                    class="dim-chip"
                    :style="{ background: scoreColorSolid(dimData.qa_agent[section.scoreKey]), color: '#fff', fontSize: '11px', minWidth: '42px', textAlign: 'center' }"
                  >{{ fmtQaScore(dimData.qa_agent[section.scoreKey]) }}</span>
                </template>
              </div>
            </div>

            <!-- Individual questions -->
            <div v-for="qKey in section.questions" :key="qKey" class="dim-row" style="margin-bottom: 6px">
              <div class="dim-label">{{ qaQuestionLabels[qKey] || qKey }}</div>
              <div class="dim-bars">
                <div class="dim-bar-track">
                  <div
                    class="dim-bar"
                    :style="{
                      width: ((dimData.qa_overall?.[qKey] ?? 0) / 10 * 100) + '%',
                      background: agent ? overallCompareColor(dimData.qa_overall?.[qKey]) : scoreColor(dimData.qa_overall?.[qKey]),
                    }"
                  />
                </div>
                <div v-if="agent && dimData.qa_agent?.[qKey] != null" class="dim-bar-track dim-bar-track--agent">
                  <div
                    class="dim-bar"
                    :style="{ width: (dimData.qa_agent[qKey] / 10 * 100) + '%', background: scoreColor(dimData.qa_agent[qKey]) }"
                  />
                </div>
              </div>
              <div class="dim-scores">
                <span
                  class="dim-chip"
                  :style="{ background: agent ? overallCompareColorSolid(dimData.qa_overall?.[qKey]) : scoreColorSolid(dimData.qa_overall?.[qKey]), color: '#fff', fontSize: '11px', minWidth: '42px', textAlign: 'center' }"
                >{{ fmtQaScore(dimData.qa_overall?.[qKey]) }}</span>
                <template v-if="agent && dimData.qa_agent?.[qKey] != null">
                  <span
                    class="dim-chip"
                    :style="{ background: scoreColorSolid(dimData.qa_agent[qKey]), color: '#fff', fontSize: '11px', minWidth: '42px', textAlign: 'center' }"
                  >{{ fmtQaScore(dimData.qa_agent[qKey]) }}</span>
                  <span
                    class="dim-delta"
                    :class="dimData.qa_agent[qKey] >= (dimData.qa_overall?.[qKey] ?? 0) ? 'dim-delta--positive' : 'dim-delta--negative'"
                  >
                    {{ dimData.qa_agent[qKey] >= (dimData.qa_overall?.[qKey] ?? 0) ? "+" : "" }}{{ fmtQaScore(dimData.qa_agent[qKey] - (dimData.qa_overall?.[qKey] ?? 0)) }}
                  </span>
                </template>
              </div>
            </div>
          </template>
        </div>
      </div>
      </div>

      <!-- Objection Handling + Sales Opportunity — two-visual row -->
      <div class="tile-pair" style="margin-top: 14px">
      <!-- Objection Handling Assessment Summary -->
      <div v-if="objectionAssessData?.categories?.some((c: any) => c.raised_count > 0)" class="tile">
        <div class="tile-head" style="flex-wrap: wrap">
          <div class="tile-icon">&#128172;</div>
          <div class="tile-text" style="flex: 1">
            <div class="tile-title">Objection Handling Assessment</div>
            <div class="tile-desc">
              {{ agent ? `Comparing ${agent} against overall average` : 'Click a category to see individual interactions' }}
            </div>
          </div>
          <label class="tile-toggle" title="Limit the objection-handling breakdown to interactions classified as genuine RAC sales opportunities.">
            <input type="checkbox" v-model="objectionOppsOnly" />
            <span>Opportunities only</span>
          </label>
        </div>
        <div class="tile-body">
          <!-- Legend when comparing -->
          <div v-if="agent && objectionAssessData.agent" class="dim-legend" style="margin-bottom: 14px">
            <span class="dim-legend-item"><span class="dim-swatch dim-swatch--overall" /> Overall average</span>
            <span class="dim-legend-item"><span class="dim-swatch dim-swatch--agent" /> {{ agent }}</span>
          </div>

          <!-- Totals summary — same boxed strip style as Sales Opportunity -->
          <div class="opp-summary-strip">
            <div class="opp-stat">
              <div class="opp-stat-value">{{ objectionAssessData.totals.assessed }}</div>
              <div class="opp-stat-label">Assessed</div>
              <template v-if="agent && objectionAssessData.agent">
                <div class="objection-stat-agent">{{ objectionAssessData.agent.totals.assessed }}</div>
                <div class="opp-stat-label">{{ agent }}</div>
              </template>
            </div>
            <div class="opp-stat">
              <div class="opp-stat-value">{{ objectionAssessData.totals.with_objections }}</div>
              <div class="opp-stat-label">With Objections</div>
              <template v-if="agent && objectionAssessData.agent">
                <div class="objection-stat-agent">{{ objectionAssessData.agent.totals.with_objections }}</div>
                <div class="opp-stat-label">{{ agent }}</div>
              </template>
            </div>
            <div class="opp-stat">
              <div class="opp-stat-value">{{ objectionAssessData.totals.total_objections_raised }}</div>
              <div class="opp-stat-label">Total Objections</div>
              <template v-if="agent && objectionAssessData.agent">
                <div class="objection-stat-agent">{{ objectionAssessData.agent.totals.total_objections_raised }}</div>
                <div class="opp-stat-label">{{ agent }}</div>
              </template>
            </div>
            <div class="opp-stat">
              <div class="opp-stat-value" :style="{ color: rateColorSolid(objectionAssessData.totals.avg_checklist_score) }">
                {{ objectionAssessData.totals.avg_checklist_score != null ? (objectionAssessData.totals.avg_checklist_score * 100).toFixed(0) + '%' : 'n/a' }}
              </div>
              <div class="opp-stat-label">Avg Checklist Score</div>
              <template v-if="agent && objectionAssessData.agent">
                <div class="objection-stat-agent" :style="{ color: rateColorSolid(objectionAssessData.agent.totals.avg_checklist_score) }">
                  {{ objectionAssessData.agent.totals.avg_checklist_score != null ? (objectionAssessData.agent.totals.avg_checklist_score * 100).toFixed(0) + '%' : 'n/a' }}
                </div>
                <div class="opp-stat-label">{{ agent }}</div>
              </template>
            </div>
          </div>
          <!-- Category breakdown with drill-down -->
          <div>
            <template v-for="cat in objectionAssessData.categories" :key="cat.category">
              <div v-if="cat.raised_count > 0">
                <div class="metric-row metric-row--clickable" @click="toggleObjectionCategory(cat.category)">
                  <div class="metric-left" style="flex-wrap: wrap; gap: 4px 8px">
                    <span style="font-size: 13px; font-weight: 600; text-transform: capitalize">{{ cat.category.replace(/_/g, ' ') }}</span>
                    <!-- Overall BP chip -->
                    <span
                      class="dim-chip"
                      :style="{ background: agent ? overallCompareColorSolid(cat.best_practice_rate != null ? cat.best_practice_rate * 10 : null) : rateColorSolid(cat.best_practice_rate), color: '#fff', fontSize: '10px', minWidth: '50px', textAlign: 'center' }"
                    >BP {{ cat.best_practice_rate != null ? (cat.best_practice_rate * 100).toFixed(0) + '%' : 'n/a' }}</span>
                    <!-- Agent BP chip -->
                    <template v-if="agent && agentObjCat(cat.category)?.best_practice_rate != null">
                      <span
                        class="dim-chip"
                        :style="{ background: rateColorSolid(agentObjCat(cat.category).best_practice_rate), color: '#fff', fontSize: '10px', minWidth: '50px', textAlign: 'center' }"
                      >BP {{ (agentObjCat(cat.category).best_practice_rate * 100).toFixed(0) }}%</span>
                    </template>
                    <span v-if="cat.could_do_more_count > 0" style="font-size: 11px; color: #ea580c">+{{ cat.could_do_more_count }} could do more</span>
                  </div>
                  <div class="metric-right">
                    <span class="count-pill">{{ cat.raised_count }}</span>
                    <template v-if="agent && agentObjCat(cat.category)?.raised_count > 0">
                      <span class="count-pill" style="background: var(--accent, #3b82f6); color: #fff">{{ agentObjCat(cat.category).raised_count }}</span>
                    </template>
                    <span class="expand-icon">{{ expandedObjectionCat === cat.category ? '&#9650;' : '&#9660;' }}</span>
                  </div>
                </div>

                <!-- Expanded interaction list -->
                <div v-if="expandedObjectionCat === cat.category" class="drill-panel">
                  <div v-if="loadingObjectionCat" class="hint">Loading interactions...</div>
                  <div v-else-if="!objectionCatInteractions.length" class="hint">No interactions found.</div>
                  <div
                    v-else
                    v-for="ix in objectionCatInteractions"
                    :key="ix.recordingId"
                    class="drill-row"
                    @click="openDetail(ix.recordingId)"
                  >
                    <div class="drill-row-top">
                      <span class="mono" style="font-size: 11px; font-weight: 600; color: var(--ink); min-width: 60px">{{ ix.interactionId || ix.recordingId?.slice(0, 8) }}</span>
                      <span :class="scoreChip(ix.overall_score)" style="font-size: 11px">{{ fmtScore(ix.overall_score) }}</span>
                      <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                      <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                      <span v-if="ix.objection_detail?.best_practice_followed === true" class="chip chip--success" style="font-size: 10px">Best practice</span>
                      <span v-if="ix.objection_detail?.best_practice_followed === false" class="chip chip--danger" style="font-size: 10px">Missed</span>
                      <span v-if="ix.objection_detail?.could_do_more" class="chip chip--warning" style="font-size: 10px">Could do more</span>
                      <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span>
                    </div>
                    <div class="drill-row-summary">{{ ix.objection_detail?.comment || ix.summary_short || "(no summary)" }}</div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Generic checklist summary -->
          <div v-if="objectionAssessData.checklist?.length" style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border)">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--ink); margin-bottom: 8px">Generic Handling Checklist Rates</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px 16px">
              <div v-for="item in objectionAssessData.checklist" :key="item.item" style="display: flex; align-items: center; gap: 6px">
                <div style="flex: 1; font-size: 11px; text-transform: capitalize; color: var(--ink)">{{ item.item.replace(/_/g, ' ') }}</div>
                <span
                  class="dim-chip"
                  :style="{
                    background: agent ? overallCompareColorSolid(item.rate != null ? item.rate * 10 : null) : rateColorSolid(item.rate),
                    color: '#fff', fontSize: '11px', minWidth: '42px', textAlign: 'center'
                  }"
                >{{ item.rate != null ? (item.rate * 100).toFixed(0) + '%' : 'n/a' }}</span>
                <!-- Agent checklist chip -->
                <template v-if="agent && agentChecklist(item.item)?.rate != null">
                  <span
                    class="dim-chip"
                    :style="{
                      background: rateColorSolid(agentChecklist(item.item).rate),
                      color: '#fff', fontSize: '11px', minWidth: '42px', textAlign: 'center'
                    }"
                  >{{ (agentChecklist(item.item).rate * 100).toFixed(0) }}%</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sales Opportunity Classification (paired with Objection Handling) -->
      <div
        v-if="opportunityData && (opportunityData.classified > 0 || opportunityData.unclassified > 0)"
        class="tile"
      >
        <div class="tile-head">
          <div class="tile-icon">&#128176;</div>
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
            <div class="opp-stat opp-stat--unclassified">
              <div class="opp-stat-value">{{ opportunityData.unclassified || 0 }}</div>
              <div class="opp-stat-label">Unable to Classify</div>
            </div>
            <div class="opp-stat">
              <div class="opp-stat-value">{{ opportunityData.classified > 0 ? Math.round(opportunityData.opportunities / opportunityData.classified * 100) : 0 }}%</div>
              <div class="opp-stat-label">Opportunity Rate</div>
            </div>
          </div>

          <!-- Opportunity row (clickable) -->
          <div v-if="opportunityData.opportunities > 0">
            <div class="metric-row metric-row--clickable" @click="toggleOpportunityReason('__opportunity')">
              <div class="metric-left">
                <span class="chip chip--success" style="font-size: 12px">Opportunity to Sell</span>
              </div>
              <div class="metric-right">
                <span class="count-pill">{{ opportunityData.opportunities }}</span>
                <span class="expand-icon">{{ expandedOpportunityReason === '__opportunity' ? '&#9650;' : '&#9660;' }}</span>
              </div>
            </div>
            <div v-if="expandedOpportunityReason === '__opportunity'" class="drill-panel">
              <div v-if="loadingOpportunityReason" class="hint">Loading interactions...</div>
              <div v-else-if="!opportunityInteractions.length" class="hint">No interactions found.</div>
              <div
                v-else
                v-for="ix in opportunityInteractions"
                :key="ix.recordingId"
                class="drill-row"
                @click="openDetail(ix.recordingId)"
              >
                <div class="drill-row-top">
                  <span class="chip chip--success" style="font-size: 11px">Opportunity</span>
                  <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                  <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span>
                </div>
                <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
              </div>
            </div>
          </div>

          <!-- Reason breakdown (not opportunities) -->
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
                <span class="expand-icon">{{ expandedOpportunityReason === r.reason ? '&#9650;' : '&#9660;' }}</span>
              </div>
            </div>

            <div v-if="expandedOpportunityReason === r.reason" class="drill-panel">
              <div v-if="loadingOpportunityReason" class="hint">Loading interactions...</div>
              <div v-else-if="!opportunityInteractions.length" class="hint">No interactions found.</div>
              <div
                v-else
                v-for="ix in opportunityInteractions"
                :key="ix.recordingId"
                class="drill-row"
                @click="openDetail(ix.recordingId)"
              >
                <div class="drill-row-top">
                  <span class="chip chip--danger" style="font-size: 11px">{{ opportunityReasonLabel(ix.not_opportunity_reason || r.reason) }}</span>
                  <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                  <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span>
                </div>
                <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
              </div>
            </div>
          </div>

          <!-- Unable to classify (attempted but ambiguous) -->
          <div v-if="opportunityData.unclassified > 0">
            <div class="metric-row metric-row--clickable" @click="toggleOpportunityReason('__unclassified')">
              <div class="metric-left">
                <span class="chip chip--secondary" style="font-size: 12px">{{ opportunityReasonLabel('__unclassified') }}</span>
                <span class="hint" style="font-size: 11px; margin-left: 8px">Classification attempted but intent could not be determined</span>
              </div>
              <div class="metric-right">
                <span class="count-pill">{{ opportunityData.unclassified }}</span>
                <span class="expand-icon">{{ expandedOpportunityReason === '__unclassified' ? '&#9650;' : '&#9660;' }}</span>
              </div>
            </div>
            <div v-if="expandedOpportunityReason === '__unclassified'" class="drill-panel">
              <div v-if="loadingOpportunityReason" class="hint">Loading interactions...</div>
              <div v-else-if="!opportunityInteractions.length" class="hint">No interactions found.</div>
              <div
                v-else
                v-for="ix in opportunityInteractions"
                :key="ix.recordingId"
                class="drill-row"
                @click="openDetail(ix.recordingId)"
              >
                <div class="drill-row-top">
                  <span class="chip chip--secondary" style="font-size: 11px">Unable to Classify</span>
                  <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                  <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                  <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span>
                </div>
                <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      <!-- Vulnerable Customers (Consumer Duty — QA Q13) -->
      <div v-if="vulnData" class="tile" style="margin-top: 14px">
        <div class="tile-head">
          <div class="tile-icon">&#128735;</div>
          <div class="tile-text">
            <div class="tile-title">Vulnerable Customers (Consumer Duty)</div>
            <div class="tile-desc">From QA Q13 — where a vulnerable customer was identified and whether they were handled appropriately. {{ vulnData.total_qa }} QA-scored interactions in range.</div>
          </div>
        </div>
        <div class="tile-body">
          <div style="display: flex; gap: 24px; flex-wrap: wrap; padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg)">
            <div><div class="opp-stat-label">Identified vulnerable</div><div class="opp-stat-value">{{ vulnData.identified }}</div></div>
            <div><div class="opp-stat-label">Handled &#10003;</div><div class="opp-stat-value" style="color: #059669">{{ vulnData.handled }}</div></div>
            <div><div class="opp-stat-label">NOT handled &#10007;</div><div class="opp-stat-value" style="color: #dc2626">{{ vulnData.not_handled }}</div></div>
          </div>

          <div v-if="!vulnData.identified" class="hint" style="margin-top: 10px">No vulnerable customers identified in the QA-scored interactions for this range / filter.</div>

          <div v-if="vulnData.identified" style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap">
            <button
              class="btn btn--secondary btn--sm"
              :style="vulnAnswer === 'no' ? 'outline: 2px solid #dc2626' : ''"
              @click="loadVulnList('no')"
            >Review not-handled ({{ vulnData.not_handled }})</button>
            <button
              class="btn btn--ghost btn--sm"
              :style="vulnAnswer === 'yes' ? 'outline: 2px solid #059669' : ''"
              @click="loadVulnList('yes')"
            >View handled ({{ vulnData.handled }})</button>
          </div>

          <div v-if="vulnAnswer" class="drill-panel" style="margin-top: 10px">
            <div v-if="loadingVuln" class="hint">Loading…</div>
            <div v-else-if="!vulnList.length" class="hint">None found.</div>
            <div v-else v-for="ix in vulnList" :key="ix.recordingId" class="drill-row" @click="openDetail(ix.recordingId)">
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
                <span class="chip" :class="ix.vuln_answer === 'no' ? 'chip--danger' : 'chip--success'" style="font-size: 10px">{{ ix.vuln_answer === 'no' ? 'Not handled' : 'Handled' }}</span>
                <span v-if="ix.campaign" class="chip chip--secondary" style="font-size: 10px">{{ ix.campaign }}</span>
                <span v-if="ix.agent" style="font-size: 12px">{{ ix.agent }}</span>
                <span v-if="ix.interactionTpsId" class="mono" style="font-size: 11px; opacity: 0.6">TPS {{ ix.interactionTpsId }}</span>
                <span class="mono" style="font-size: 11px; opacity: 0.6; margin-left: auto">{{ fmtDate(ix.interactionDateTime) }}</span>
              </div>
              <div v-if="ix.vuln_rationale" class="drill-row-summary" style="font-style: italic">{{ ix.vuln_rationale }}</div>
              <div v-else class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-3" style="margin-top: 14px">
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
                    <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                    <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span>
                  </div>
                  <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Partial Scores by Outcome -->
        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#9888;&#65039;</div>
            <div class="tile-text">
              <div class="tile-title">{{ partialLayer === 'qa' ? 'QA Partial Scores' : 'Ops Partial Scores' }} by Outcome</div>
              <div class="tile-desc">Records where the {{ partialLayer === 'qa' ? 'QA' : 'operations' }} scoring was partial (n/a on one or more dimensions), grouped by outcome — click to drill</div>
            </div>
            <div class="layer-toggle" role="tablist" aria-label="Choose layer">
              <button
                type="button"
                class="layer-toggle-btn"
                :class="{ 'layer-toggle-btn--active': partialLayer === 'ops' }"
                @click="setPartialLayer('ops')"
              >Ops</button>
              <button
                type="button"
                class="layer-toggle-btn"
                :class="{ 'layer-toggle-btn--active': partialLayer === 'qa' }"
                @click="setPartialLayer('qa')"
              >QA</button>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!partialByOutcomeRows.length">No {{ partialLayer === 'qa' ? 'QA' : 'ops' }} partial-scored records in this window.</div>
            <div
              v-for="o in partialByOutcomeRows"
              :key="o.outcome"
            >
              <div class="metric-row metric-row--clickable" @click="togglePartialOutcome(o.outcome)">
                <div class="metric-left">
                  <span class="chip chip--warning" style="font-size: 11px">{{ o.outcome }}</span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ o.count }}</span>
                  <span class="expand-icon">{{ expandedPartialOutcome === o.outcome ? '&#9650;' : '&#9660;' }}</span>
                </div>
              </div>

              <div v-if="expandedPartialOutcome === o.outcome" class="drill-panel">
                <div v-if="loadingPartialOutcome" class="hint">Loading interactions...</div>
                <div v-else-if="!partialOutcomeInteractions.length" class="hint">No interactions found.</div>
                <div
                  v-else
                  v-for="ix in partialOutcomeInteractions"
                  :key="ix.recordingId"
                  class="drill-row"
                  @click="openDetail(ix.recordingId)"
                >
                  <div class="drill-row-top">
                    <span :class="scoreChip(ix.overall_score)" style="font-size: 11px">{{ fmtScore(ix.overall_score) }}</span>
                    <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                    <span v-if="ix.campaign_detected" class="chip chip--secondary" style="font-size: 11px">{{ ix.campaign_detected }}</span>
                    <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                    <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span>
                  </div>
                  <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Low Score Alerts by Agent -->
        <div class="tile">
          <div class="tile-head">
            <div class="tile-icon">&#128680;</div>
            <div class="tile-text">
              <div class="tile-title">{{ lowScoreLayer === 'qa' ? 'QA Low Score Alerts' : 'Ops Low Score Alerts' }} by Agent</div>
              <div class="tile-desc">Records where {{ lowScoreLayer === 'qa' ? 'a QA question was answered “no”' : 'an operations dimension scored ≤ 4' }}, grouped by agent — click to drill</div>
            </div>
            <div class="layer-toggle" role="tablist" aria-label="Choose layer">
              <button
                type="button"
                class="layer-toggle-btn"
                :class="{ 'layer-toggle-btn--active': lowScoreLayer === 'ops' }"
                @click="setLowScoreLayer('ops')"
              >Ops</button>
              <button
                type="button"
                class="layer-toggle-btn"
                :class="{ 'layer-toggle-btn--active': lowScoreLayer === 'qa' }"
                @click="setLowScoreLayer('qa')"
              >QA</button>
            </div>
          </div>
          <div class="tile-body">
            <div class="hint" v-if="!lowScoreByAgentRows.length">No {{ lowScoreLayer === 'qa' ? 'QA' : 'ops' }} low-score alerts in this window.</div>
            <div
              v-for="a in lowScoreByAgentRows"
              :key="a.agent"
            >
              <div class="metric-row metric-row--clickable" @click="toggleLowScoreAgent(a.agent)">
                <div class="metric-left">
                  <span class="chip chip--danger" style="font-size: 11px">{{ a.agent }}</span>
                  <span v-if="a.avg_score != null" :class="scoreChip(a.avg_score)" style="font-size: 11px; margin-left: 6px">avg {{ fmtScore(a.avg_score) }}</span>
                </div>
                <div class="metric-right">
                  <span class="count-pill">{{ a.count }}</span>
                  <span class="expand-icon">{{ expandedLowScoreAgent === a.agent ? '&#9650;' : '&#9660;' }}</span>
                </div>
              </div>

              <div v-if="expandedLowScoreAgent === a.agent" class="drill-panel">
                <div v-if="loadingLowScoreAgent" class="hint">Loading interactions...</div>
                <div v-else-if="!lowScoreAgentInteractions.length" class="hint">No interactions found.</div>
                <div
                  v-else
                  v-for="ix in lowScoreAgentInteractions"
                  :key="ix.recordingId"
                  class="drill-row"
                  @click="openDetail(ix.recordingId)"
                >
                  <div class="drill-row-top">
                    <span :class="scoreChip(ix.overall_score)" style="font-size: 11px">{{ fmtScore(ix.overall_score) }}</span>
                    <span v-if="ix.agent" class="chip chip--secondary" style="font-size: 11px">{{ ix.agent }}</span>
                    <span v-if="ix.campaign_detected" class="chip chip--secondary" style="font-size: 11px">{{ ix.campaign_detected }}</span>
                    <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
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
                    <span v-if="ix.outcome" class="chip chip--secondary" style="font-size: 11px">{{ ix.outcome }}</span>
                    <span class="mono" style="font-size: 11px; opacity: 0.6">{{ fmtDate(ix.interactionDateTime) }}</span>
                  </div>
                  <div class="drill-row-summary">{{ ix.summary_short || "(no summary)" }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Outcome Distribution -->
        <div class="tile" v-if="opsData.outcome_distribution?.length">
          <div class="tile-head">
            <div class="tile-icon">&#128203;</div>
            <div class="tile-text">
              <div class="tile-title">Outcome Distribution</div>
              <div class="tile-desc">Click an outcome to see individual interactions</div>
            </div>
          </div>
          <div class="tile-body">
            <div
              v-for="o in opsData.outcome_distribution"
              :key="o.outcome"
            >
              <div class="metric-row metric-row--clickable" @click="toggleOutcome(o.outcome)">
                <div class="metric-left">
                  <span class="chip chip--secondary">{{ o.outcome }}</span>
                </div>
                <div class="metric-right">
                  <span v-if="o.avg_score !== null" :class="scoreChip(o.avg_score)" style="font-size: 10px; margin-right: 6px">avg {{ fmtScore(o.avg_score) }}</span>
                  <span class="count-pill">{{ o.count }}</span>
                  <span class="expand-icon">{{ expandedOutcome === o.outcome ? '&#9650;' : '&#9660;' }}</span>
                </div>
              </div>

              <!-- Expanded interaction list -->
              <div v-if="expandedOutcome === o.outcome" class="drill-panel">
                <div v-if="loadingOutcome" class="hint">Loading interactions...</div>
                <div v-else-if="!outcomeInteractions.length" class="hint">No interactions found.</div>
                <div
                  v-else
                  v-for="ix in outcomeInteractions"
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

        <!-- Lowest Scored — 3rd column of the Outcome Distribution row -->
        <div
          v-if="opsData.lowest_scored.length"
          class="tile"
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
      </div>
    </template>

    <!-- Generate Narrative -->
    <div v-if="opsData" class="tile" style="margin-top: 14px">
      <div class="tile-head">
        <div class="tile-icon">&#128221;</div>
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
        <div v-else-if="!loadingNarrative" class="hint">Click Generate to create an AI briefing from the current operations data.</div>
      </div>
    </div>

    <InteractionDetailDrawer :recording-id="detailId" @close="closeDetail" />
  </div>
</template>

<style scoped>
.ops-root {
  position: relative;
  --overall-bar: #94a3b8;
  --agent-bar: #6366f1;
}

/* ── Summary grid ────────────────────────────────────────────────────────── */
.summary-grid {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 12px;
  margin-top: 14px;
  align-items: stretch;
}

@media (max-width: 1000px) {
  .summary-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.summary-hero {
  background: var(--surface, #fff);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 140px;
}
.summary-hero-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  margin-bottom: 4px;
}
.summary-hero-value {
  font-size: 28px;
  font-weight: 800;
  color: var(--ink);
  line-height: 1;
}
.summary-hero-sub {
  font-size: 11px;
  color: var(--muted);
  margin-top: 6px;
}

/* ── Ops / QA score panels ───────────────────────────────────────────────── */
.score-panel {
  background: var(--surface, #fff);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 3px solid transparent;
}
.score-panel--ops {
  border-top-color: #2b6cb0;
}
.score-panel--qa {
  border-top-color: #6d28d9;
}

.score-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.score-panel-title {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink);
}
.score-panel--ops .score-panel-title {
  color: #1a3a5c;
}
.score-panel--qa .score-panel-title {
  color: #4c1d95;
}
.score-panel-hint {
  font-size: 10px;
  color: var(--muted);
  font-weight: 600;
}

.score-panel-body {
  display: flex;
  gap: 16px;
  align-items: center;
}

.score-panel-empty {
  font-size: 12px;
  color: var(--muted);
  font-style: italic;
  padding: 4px 0;
}

.mini-stat {
  flex: 1;
  min-width: 0;
}
.mini-stat-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini-stat-value {
  font-size: 16px;
  font-weight: 800;
  color: var(--ink);
}
.mini-stat-value.chip {
  padding: 2px 8px;
  font-size: 13px;
}

/* ── In-panel flag row ──────────────────────────────────────────────────── */
.score-panel-flags {
  display: flex;
  gap: 10px;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.panel-flag {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--surface-soft, #f1f5f9);
  cursor: help;
  opacity: 0.8;
  transition: opacity 0.12s;
}
.panel-flag--active {
  opacity: 1;
}
.panel-flag-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.panel-flag-value {
  font-size: 14px;
  font-weight: 800;
  color: var(--ink);
}
.panel-flag--ops.panel-flag--active {
  background: color-mix(in srgb, #b45309 14%, transparent);
}
.panel-flag--ops.panel-flag--active .panel-flag-value {
  color: #b45309;
}
.panel-flag--qa.panel-flag--active {
  background: color-mix(in srgb, #6d28d9 14%, transparent);
}
.panel-flag--qa.panel-flag--active .panel-flag-value {
  color: #6d28d9;
}

/* ── Layer toggle (Ops / QA segmented) ───────────────────────────────────── */
.layer-toggle {
  display: inline-flex;
  margin-left: auto;
  background: var(--surface-soft, #f1f5f9);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
  user-select: none;
}
.layer-toggle-btn {
  border: none;
  background: transparent;
  color: var(--muted, #64748b);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.layer-toggle-btn:hover {
  color: var(--ink);
}
.layer-toggle-btn--active {
  background: #fff;
  color: var(--brand, #2b6cb0);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

/* ── Tile toggle (Exclude partial scores) ────────────────────────────────── */
.tile-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--surface-soft, #f1f5f9);
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s, border-color 0.12s;
}
.tile-toggle:hover {
  background: var(--surface-soft-2, #e8edf3);
}
.tile-toggle input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
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

.agent-rank {
  font-size: 11px;
  font-weight: 800;
  color: var(--muted);
  margin-right: 4px;
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

/* ── Headline trend sparklines ─────────────────────────────────────────────── */
.spark-strip { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
.spark-card {
  flex: 1; min-width: 200px;
  padding: 12px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
}
.spark-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.spark-title { font-size: 12px; font-weight: 700; color: var(--ink); }
.spark-latest { font-size: 13px; font-weight: 800; color: var(--ink); }
.spark-good { color: #059669; font-size: 11px; }
.spark-bad { color: #dc2626; font-size: 11px; }
.spark-neutral { color: var(--muted); font-size: 11px; }
.spark-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }

/* ── Agent trajectory ─────────────────────────────────────────────────────── */
.traj-sort { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.traj-list { display: flex; flex-direction: column; }
.traj-row {
  display: grid;
  grid-template-columns: minmax(120px, 1.4fr) 140px auto auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 8px 6px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  border-radius: 6px;
}
.traj-row:last-child { border-bottom: none; }
.traj-row:hover { background: color-mix(in srgb, var(--brand, #6366f1) 7%, transparent); }
.traj-name { font-size: 13px; font-weight: 600; color: var(--ink); word-break: break-word; }
.traj-latest { font-size: 11px; justify-self: start; }
.traj-delta { font-size: 12px; font-weight: 700; justify-self: start; }
.traj-up { color: #059669; }
.traj-down { color: #dc2626; }
.traj-flat { color: var(--muted); }
.traj-total { font-size: 11px; color: var(--muted); justify-self: end; }
@media (max-width: 640px) {
  .traj-row { grid-template-columns: 1fr auto; row-gap: 4px; }
  .traj-row .spark { grid-column: 1 / -1; }
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

/* Chat response time — agent vs all-agents comparison overlay */
.chat-rt-compare {
  font-weight: 600;
  color: var(--ink, #1f2937);
}

.chat-rt-delta {
  margin-left: 4px;
  font-weight: 600;
  font-size: 11px;
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

/* ── Score bucket chips ─────────────────────────────────────────────────────── */
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
  background: hsl(215, 20%, 55%);
}

.dim-swatch--agent {
  background: linear-gradient(90deg, hsl(0, 65%, 42%), hsl(60, 65%, 42%), hsl(120, 65%, 42%));
  border-radius: 2px;
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

/* On narrow screens, stack vertically */
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
  background: var(--surface-soft, #f8f8f8);
  padding: 12px;
  border-radius: var(--radius-md, 6px);
  line-height: 1.6;
}

/* ── QA dimension section headers (main dashboard) ────────────────────────── */
.qa-dim-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  margin-top: 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
}

.qa-dim-section-title {
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--brand, #6366f1);
}

/* ── Opportunity summary strip ─────────────────────────────────────────────── */
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

.opp-stat--unclassified .opp-stat-value {
  color: var(--muted, #6b7280);
}

/* ── RAC QA scoring in detail drawer ──────────────────────────────────────── */
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

/* ── Objection Assessment ─────────────────────────────────────────────────── */
.objection-cat-row {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: var(--surface-soft, #f8f8f8);
  border-radius: var(--radius-sm, 4px);
  border-left: 3px solid var(--border);
}

.objection-cat-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: capitalize;
  color: var(--ink);
  margin-bottom: 4px;
}

.objection-cat-flags {
  display: flex;
  gap: 6px;
  margin-bottom: 4px;
}

.objection-cat-comment {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}

.checklist-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
}

.checklist-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Objection-handling totals reuse the Sales Opportunity strip styles
   (.opp-summary-strip / .opp-stat*); only the agent comparison sub-value is
   bespoke. */
.objection-stat-agent {
  font-size: 16px;
  font-weight: 700;
  color: var(--brand);
  line-height: 1.2;
  margin-top: 4px;
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

/* ── Drawer transition ─────────────────────────────────────────────────────── */
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.25s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
}

/* ── Slowest Agents / Slowest Chats — compact side-by-side tables ──────────── */
.slowest-row {
  display: flex;
  flex-wrap: wrap;
  gap: 18px 24px;
}
.slowest-col {
  flex: 1 1 340px;
  min-width: 0;
}
.slowest-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.slowest-table th {
  text-align: left;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  font-weight: 700;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.slowest-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.slowest-table th.num,
.slowest-table td.num {
  text-align: right;
}
.slowest-table .chip {
  font-size: 11px;
}
.slowest-name {
  font-weight: 600;
  color: var(--ink);
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slowest-clickable {
  cursor: pointer;
}
.slowest-clickable:hover {
  background: rgba(0, 0, 0, 0.04);
}
/* Highlight the currently-selected agent's row in the leaderboard. */
.slowest-me {
  background: color-mix(in srgb, var(--brand, #6366f1) 12%, transparent);
}
.slowest-me .slowest-name {
  color: var(--brand, #6366f1);
}

/* Dimension Averages + QA Assessment Averages side by side; each stretches to
   full width when the other is absent, and they stack on narrow screens. */
.dim-averages-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-start;
}
.dim-averages-tile {
  flex: 1 1 440px;
  min-width: 0;
  margin-top: 0;
}

/* Generic two-visual row (Objection Handling + Sales Opportunity); each tile
   stretches full width when the other is hidden, and they stack when narrow. */
.tile-pair {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: flex-start;
}
.tile-pair > .tile {
  flex: 1 1 440px;
  min-width: 0;
  margin-top: 0;
}
</style>
