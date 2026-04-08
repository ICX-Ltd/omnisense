<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref, watch } from "vue";
import { ApiPath } from "@/enums/api";
import { toPrettyInsights } from "@/utils/insights-response";

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

// Drill-down
const expandedCategory = ref<string | null>(null);
const categoryRecords = ref<any[]>([]);
const loadingCategory = ref(false);

const expandedCompetitor = ref<string | null>(null);
const competitorRecords = ref<any[]>([]);
const loadingCompetitor = ref(false);
const competitorModels = ref<any[]>([]);

// Detail drawer
const detailId = ref<number | null>(null);
const detailData = ref<any>(null);
const loadingDetail = ref(false);

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return "n/a";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function pct(n: number, total: number) {
  if (!total) return "0";
  return Math.round(n / total * 100).toString();
}

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

async function loadAll() {
  loading.value = true;
  error.value = "";
  expandedCategory.value = null;
  expandedCompetitor.value = null;
  detailId.value = null;

  try {
    const p = sharedParams.value;
    const [ovRes, catRes, intRes, nprRes, compRes, drRes, dvRes, mpRes] = await Promise.all([
      axios.get(ApiPath.SurveyOverview, { params: p }),
      axios.get(ApiPath.SurveyCategories, { params: p }),
      axios.get(ApiPath.SurveyInterestFactors, { params: p }),
      axios.get(ApiPath.SurveyNotPurchaseReasons, { params: p }),
      axios.get(ApiPath.SurveyCompetitorPurchases, { params: p }),
      axios.get(ApiPath.SurveyDealershipRatings, { params: p }),
      axios.get(ApiPath.SurveyDealerVisits, { params: p }),
      axios.get(ApiPath.SurveyModelPerformance, { params: p }),
    ]);
    overview.value = ovRes.data;
    categories.value = catRes.data;
    interestFactors.value = intRes.data;
    notPurchaseReasons.value = nprRes.data;
    competitorPurchases.value = compRes.data;
    dealershipRatings.value = drRes.data;
    dealerVisits.value = dvRes.data;
    modelPerformance.value = mpRes.data;
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

async function openDetail(id: number) {
  detailId.value = id;
  detailData.value = null;
  loadingDetail.value = true;
  try {
    const res = await axios.get(`${ApiPath.SurveyRecordDetail}/${id}`);
    detailData.value = res.data;
  } catch { detailData.value = null; }
  finally { loadingDetail.value = false; }
}

function closeDetail() { detailId.value = null; detailData.value = null; }

// ── Narrative generation ─────────────────────────────────────────────────────
const narrativeProvider = ref("openai");
const loadingNarrative = ref(false);
const narrativeResult = ref("");
const narrativeError = ref("");

async function generateNarrative() {
  loadingNarrative.value = true;
  narrativeError.value = "";
  narrativeResult.value = "";
  try {
    const res = await axios.post(ApiPath.InsightsSummaryNarrative, null, {
      params: {
        from: from.value,
        to: to.value,
        filterKey: "all",
        provider: narrativeProvider.value,
        narrativeType: "survey_analytics",
        ...(campaign.value && { campaign: campaign.value }),
      },
    });
    narrativeResult.value = toPrettyInsights(res.data?.narrative ?? res.data);
  } catch (e: any) {
    narrativeError.value = e?.response?.data?.message || e?.message || "Failed to generate narrative";
  } finally {
    loadingNarrative.value = false;
  }
}

onMounted(async () => { await loadFilterOptions(); await loadAll(); });
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
      <!-- Overview strip -->
      <div class="stats-strip">
        <div class="stat"><div class="stat-label">Total Records</div><div class="stat-value">{{ overview.total }}</div></div>
        <div class="stat"><div class="stat-label">Survey Taken</div><div class="stat-value chip chip--success">{{ overview.survey_taken }}</div></div>
        <div class="stat"><div class="stat-label">Survey Not Taken</div><div class="stat-value chip chip--secondary">{{ overview.survey_not_taken }}</div></div>
        <div class="stat"><div class="stat-label">Positive</div><div class="stat-value chip chip--success">{{ overview.positive }}</div></div>
        <div class="stat"><div class="stat-label">Neutral</div><div class="stat-value chip chip--warning">{{ overview.neutral }}</div></div>
        <div class="stat"><div class="stat-label">Negative</div><div class="stat-value chip chip--danger">{{ overview.negative }}</div></div>
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
            <div v-for="c in categories" :key="c.category">
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
                <div v-else v-for="r in categoryRecords" :key="r.id_opportunity" class="drill-row" @click="openDetail(r.id_opportunity)">
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
            <div v-for="m in modelPerformance" :key="m.model" class="model-row">
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
            <div v-if="interestFactors" v-for="f in interestFactors.factors" :key="f.factor" class="bar-row">
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
            <div v-if="notPurchaseReasons" v-for="r in notPurchaseReasons.reasons" :key="r.reason" class="bar-row">
              <div class="bar-label">{{ r.reason }}</div>
              <div class="bar-track">
                <div class="bar-fill bar-fill--red" :style="{ width: pct(r.count, notPurchaseReasons.surveyed) + '%' }" />
              </div>
              <div class="bar-value">{{ r.count }} <span class="pct-label">{{ pct(r.count, notPurchaseReasons.surveyed) }}%</span></div>
            </div>
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
            <div v-for="c in competitorPurchases" :key="c.make">
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
                  <div v-else v-for="r in competitorRecords" :key="r.id_opportunity" class="drill-row" @click="openDetail(r.id_opportunity)">
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
                <div v-for="d in dealershipRatings.distribution" :key="d.rating" class="rating-block">
                  <div class="rating-star" :style="{ color: ratingColor(d.rating) }">{{ d.rating }}&#9733;</div>
                  <div class="rating-count">{{ d.count }}</div>
                </div>
              </div>
              <!-- By dealer -->
              <div v-if="dealershipRatings.by_dealer.length">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin-bottom: 6px">By Dealer (min 2 ratings)</div>
                <div v-for="d in dealershipRatings.by_dealer" :key="d.dealer" class="metric-row" style="margin-bottom: 4px">
                  <div class="metric-left" style="flex: 1; font-size: 12px">{{ d.dealer }}</div>
                  <div class="metric-right">
                    <span class="chip" :style="{ background: ratingColor(d.avg_rating), color: '#fff', fontSize: '11px' }">{{ d.avg_rating }}&#9733;</span>
                    <span class="count-pill">{{ d.count }}</span>
                  </div>
                </div>
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
            <div v-for="v in dealerVisits" :key="v.visit_type" class="visit-chip">
              <div class="visit-label">{{ v.visit_type }}</div>
              <div class="visit-count">{{ v.count }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Generate Narrative -->
    <div v-if="overview" class="tile" style="margin-top: 14px">
      <div class="tile-head">
        <div class="tile-icon">&#128221;</div>
        <div class="tile-text">
          <div class="tile-title">Generate Narrative</div>
          <div class="tile-desc">AI-generated briefing from survey data: competitor threats, conversion barriers, dealership issues and free-text themes</div>
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
        <div v-else-if="!loadingNarrative" class="hint">Click Generate to create an AI briefing. Analyses aggregated metrics and free-text comments from agent notes, feedback and improvement suggestions.</div>
      </div>
    </div>

    <!-- Detail drawer -->
    <Teleport to="body">
      <div v-if="detailId" class="drawer-backdrop" @click="closeDetail" />
      <Transition name="drawer">
        <div v-if="detailId" class="drawer">
          <div class="drawer-header">
            <div class="drawer-title">Survey Record Detail</div>
            <button class="drawer-close" @click="closeDetail">&times;</button>
          </div>
          <div class="drawer-body">
            <div v-if="loadingDetail" class="hint" style="padding: 24px">Loading...</div>
            <div v-else-if="!detailData" class="hint" style="padding: 24px">Could not load record.</div>
            <template v-else>
              <div class="drawer-columns">
                <div class="drawer-col drawer-col--left">
                  <!-- Context -->
                  <div class="drawer-section">
                    <div class="drawer-section-title">Context</div>
                    <div class="drawer-meta-grid">
                      <div><span class="drawer-label">ID</span><span>{{ detailData.id_opportunity }}</span></div>
                      <div><span class="drawer-label">Campaign</span><span>{{ detailData.campaign || "n/a" }}</span></div>
                      <div><span class="drawer-label">Manufacturer</span><span>{{ detailData.manufacture || "n/a" }}</span></div>
                      <div><span class="drawer-label">Model</span><span>{{ detailData.model || "n/a" }}</span></div>
                      <div><span class="drawer-label">Dealer</span><span>{{ detailData.dealer || "n/a" }}</span></div>
                      <div><span class="drawer-label">Date</span><span>{{ fmtDate(detailData.allocation_date) }}</span></div>
                      <div><span class="drawer-label">Category</span><span class="chip chip--secondary">{{ detailData.result_code_desc || "n/a" }}</span></div>
                      <div><span class="drawer-label">Survey Status</span><span class="chip chip--secondary">{{ detailData.survey_flow_status || "n/a" }}</span></div>
                    </div>
                  </div>

                  <!-- Purchase Status -->
                  <div class="drawer-section">
                    <div class="drawer-section-title">Purchase Status</div>
                    <div class="drawer-meta-grid">
                      <div><span class="drawer-label">Purchased Yet?</span><span>{{ detailData.p2_has_not_purchased_yet || "n/a" }}</span></div>
                      <div><span class="drawer-label">Still Considering?</span><span>{{ detailData.p2_still_considering || "n/a" }}</span></div>
                      <div><span class="drawer-label">Follow-up Interest?</span><span>{{ detailData.p3_interest_follow_up || "n/a" }}</span></div>
                      <div v-if="detailData.fpi_date"><span class="drawer-label">FPI Date</span><span>{{ fmtDate(detailData.fpi_date) }}</span></div>
                    </div>
                  </div>

                  <!-- Initial Interest -->
                  <div v-if="detailData.survey_flow_status === 'Survey Taken'" class="drawer-section">
                    <div class="drawer-section-title">Initial Interest</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px">
                      <span v-if="detailData.initial_interest_styling" class="chip chip--info" style="font-size: 11px">Styling</span>
                      <span v-if="detailData.initial_interest_brand" class="chip chip--info" style="font-size: 11px">Brand</span>
                      <span v-if="detailData.initial_interest_features" class="chip chip--info" style="font-size: 11px">Features</span>
                      <span v-if="detailData.initial_interest_size" class="chip chip--info" style="font-size: 11px">Size</span>
                      <span v-if="detailData.initial_interest_performance" class="chip chip--info" style="font-size: 11px">Performance</span>
                      <span v-if="detailData.initial_interest_price" class="chip chip--info" style="font-size: 11px">Price</span>
                      <span v-if="detailData.initial_interest_other" class="chip chip--secondary" style="font-size: 11px">{{ detailData.initial_interest_other }}</span>
                    </div>
                  </div>

                  <!-- Dealership Experience -->
                  <div v-if="detailData.dealer_visit || detailData.dealership_rating" class="drawer-section">
                    <div class="drawer-section-title">Dealership Experience</div>
                    <div class="drawer-meta-grid">
                      <div v-if="detailData.dealer_visit"><span class="drawer-label">Visit</span><span>{{ detailData.dealer_visit }}</span></div>
                      <div v-if="detailData.dealership_rating"><span class="drawer-label">Rating</span><span :style="{ color: ratingColor(detailData.dealership_rating), fontWeight: 700 }">{{ detailData.dealership_rating }}&#9733;</span></div>
                    </div>
                    <p v-if="detailData.vehicle_impression" style="margin: 8px 0 0; font-size: 13px; color: var(--ink)"><strong>Vehicle impression:</strong> {{ detailData.vehicle_impression }}</p>
                    <p v-if="detailData.why_no_test_drive" style="margin: 4px 0 0; font-size: 13px; color: var(--ink)"><strong>No test drive:</strong> {{ detailData.why_no_test_drive }}</p>
                    <p v-if="detailData.dealership_rating_feedback" style="margin: 4px 0 0; font-size: 13px; color: var(--ink)"><strong>Feedback:</strong> {{ detailData.dealership_rating_feedback }}</p>
                  </div>
                </div>

                <div class="drawer-col drawer-col--right">
                  <!-- Not Purchase Reasons -->
                  <div v-if="detailData.survey_flow_status === 'Survey Taken'" class="drawer-section">
                    <div class="drawer-section-title">Not-Purchase Reasons</div>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px">
                      <span v-if="detailData.not_purchased_price" class="chip chip--danger" style="font-size: 11px">Price</span>
                      <span v-if="detailData.not_purchased_expectations" class="chip chip--danger" style="font-size: 11px">Expectations</span>
                      <span v-if="detailData.not_purchased_different_brand" class="chip chip--danger" style="font-size: 11px">Different Brand</span>
                      <span v-if="detailData.not_purchased_different_model" class="chip chip--danger" style="font-size: 11px">Different Model</span>
                      <span v-if="detailData.not_purchased_financing" class="chip chip--danger" style="font-size: 11px">Financing</span>
                      <span v-if="detailData.not_purchased_dealership" class="chip chip--danger" style="font-size: 11px">Dealership</span>
                      <span v-if="detailData.not_purchased_other" class="chip chip--secondary" style="font-size: 11px">{{ detailData.not_purchased_other }}</span>
                    </div>
                    <p v-if="detailData.not_purchased_price_feedback" style="margin: 0; font-size: 13px; color: var(--ink)"><strong>Price feedback:</strong> {{ detailData.not_purchased_price_feedback }}</p>
                  </div>

                  <!-- Competitor Purchase -->
                  <div v-if="detailData.purchased_make" class="drawer-section">
                    <div class="drawer-section-title">Purchased Instead</div>
                    <div class="drawer-meta-grid">
                      <div><span class="drawer-label">Make</span><span class="chip chip--warning" style="font-size: 12px">{{ detailData.purchased_make }}</span></div>
                      <div><span class="drawer-label">Model</span><span>{{ detailData.purchased_model || detailData.purchased_other_model || "n/a" }}</span></div>
                      <div><span class="drawer-label">New/Used</span><span>{{ detailData.purchased_new_used || "n/a" }}</span></div>
                    </div>
                    <p v-if="detailData.purchase_influence" style="margin: 8px 0 0; font-size: 13px; color: var(--ink)"><strong>Influence:</strong> {{ detailData.purchase_influence }}</p>
                    <p v-if="detailData.purchase_reason" style="margin: 4px 0 0; font-size: 13px; color: var(--ink)"><strong>Reason:</strong> {{ detailData.purchase_reason }}</p>
                  </div>

                  <!-- Improvement -->
                  <div v-if="detailData.improve_anything || detailData.improve_follow_up" class="drawer-section">
                    <div class="drawer-section-title">What Could Be Improved</div>
                    <p v-if="detailData.improve_anything" style="margin: 0 0 4px; font-size: 13px; color: var(--ink)">{{ detailData.improve_anything }}</p>
                    <p v-if="detailData.improve_follow_up" style="margin: 0; font-size: 13px; color: var(--muted)"><strong>Follow-up:</strong> {{ detailData.improve_follow_up }}</p>
                  </div>

                  <!-- Agent Notes -->
                  <div v-if="detailData.agent_notes" class="drawer-section">
                    <div class="drawer-section-title">Agent Notes</div>
                    <p style="margin: 0; font-size: 13px; line-height: 1.6; color: var(--ink); white-space: pre-wrap">{{ detailData.agent_notes }}</p>
                  </div>

                  <!-- Audio -->
                  <div v-if="detailData.call_recording_url" class="drawer-section">
                    <div class="drawer-section-title">Recording</div>
                    <audio controls preload="none" :src="detailData.call_recording_url" style="width: 100%; height: 36px; border-radius: 6px">
                      Your browser does not support audio playback.
                    </audio>
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

/* ── Bar rows (interest factors, not-purchase reasons) ───────────────────── */
.bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.bar-label { font-size: 12px; min-width: 130px; color: var(--ink); }
.bar-track { flex: 1; background: var(--surface-2, #e0e0e0); border-radius: 3px; height: 7px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
.bar-fill--blue { background: linear-gradient(90deg, #bae6fd, #0284c7); }
.bar-fill--red { background: linear-gradient(90deg, #fecaca, #dc2626); }
.bar-value { font-size: 12px; min-width: 70px; text-align: right; font-weight: 700; color: var(--ink); }
.pct-label { font-size: 11px; color: var(--muted); font-weight: 400; margin-left: 4px; }

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

/* ── Drawer transition ───────────────────────────────────────────────────── */
.drawer-enter-active, .drawer-leave-active { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { transform: translateX(100%); }
</style>
