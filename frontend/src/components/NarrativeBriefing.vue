<script setup lang="ts">
import { computed } from "vue";
import {
  Target, ShieldAlert, Scale, TrendingDown, TrendingUp, CircleCheck,
  TriangleAlert, Lightbulb,
} from "lucide-vue-next";

// Reusable rich "executive briefing" renderer for a survey-analytics narrative
// object. The markup, styles and helpers below were extracted verbatim from the
// inline `nb-*` block in SurveyDashboard.vue's "Generate Narrative" view so that
// saved narratives on the Narratives page render identically to the live view.
//
// TODO: SurveyDashboard.vue still has its own inline copy of this markup/styles.
// It should be refactored to import and use <NarrativeBriefing> instead of
// duplicating the render — left as a follow-up (that file was locked in this pass).

const props = defineProps<{ narrative: any }>();

const narrative = computed(() => props.narrative);

// ── Narrative render helpers (copied from SurveyDashboard.vue) ──

// Width as a share of a max value (for bars where the denominator is the
// largest bar rather than a total).
function barPct(n: number, max: number) {
  if (!max) return "0";
  return Math.round((n / max) * 100).toString();
}

// Pull the first number out of strings like "22% of defections" / "12".
function pctNum(v: any): number {
  const m = String(v ?? "").match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

const maxLosses = computed(() => {
  const list = narrative.value?.competitive_landscape?.top_competitors ?? [];
  return Math.max(1, ...list.map((c: any) => pctNum(c.losses)));
});

function trajLabel(t?: string): string {
  return t === "accelerating"
    ? "▲ Accelerating"
    : t === "declining"
    ? "▼ Declining"
    : t === "stable"
    ? "▬ Stable"
    : "Insufficient data";
}

function dirArrow(d?: string): string {
  return d === "increasing" ? "▲" : d === "decreasing" ? "▼" : "▬";
}
</script>

<template>
  <!-- Rich executive briefing -->
  <div v-if="narrative" class="nb">
    <div class="nb-hero">
      <div class="nb-hero-eyebrow">Executive Briefing &middot; Nissan Competitive Intelligence</div>
      <div class="nb-hero-headline">{{ narrative.headline }}</div>
      <div v-if="narrative.period_summary" class="nb-hero-sub">{{ narrative.period_summary }}</div>
    </div>

    <div v-if="narrative.headline_metrics?.length" class="nb-kpis">
      <div v-for="(k, i) in narrative.headline_metrics" :key="i" class="nb-kpi">
        <div class="nb-kpi-value">{{ k.value }}</div>
        <div class="nb-kpi-label">{{ k.label }}</div>
      </div>
    </div>

    <div v-if="narrative.executive_summary" class="nb-callout">
      <div class="nb-section-eyebrow">Executive Summary</div>
      <p class="nb-callout-text">{{ narrative.executive_summary }}</p>
    </div>

    <div class="nb-grid">
      <div v-if="narrative.competitive_landscape" class="nb-card">
        <div class="nb-card-title"><Target :size="16" class="nb-ico" style="color:#e11d48" /> Who we're losing to</div>
        <p class="nb-muted">{{ narrative.competitive_landscape.summary }}</p>
        <div v-for="(c, i) in narrative.competitive_landscape.top_competitors" :key="i" class="nb-lb-row">
          <div class="nb-lb-rank">{{ Number(i) + 1 }}</div>
          <div class="nb-lb-brand">
            {{ c.brand }}
            <span v-if="c.is_chinese" class="nb-badge nb-badge--cn">CN</span>
            <div v-if="c.note" class="nb-lb-note">{{ c.note }}</div>
          </div>
          <div class="nb-lb-bar"><div class="nb-lb-fill" :class="c.is_chinese ? 'nb-fill--cn' : 'nb-fill--grey'" :style="{ width: barPct(pctNum(c.losses), maxLosses) + '%' }" /></div>
          <div class="nb-lb-val">{{ c.losses }}</div>
        </div>
      </div>

      <div v-if="narrative.chinese_oem_threat" class="nb-card nb-card--threat">
        <div class="nb-card-title"><ShieldAlert :size="16" class="nb-ico" style="color:#e11d48" /> Emerging Chinese-OEM threat</div>
        <div class="nb-threat-top">
          <div class="nb-threat-share">
            <div class="nb-threat-share-val">{{ narrative.chinese_oem_threat.current_share }}</div>
            <div class="nb-threat-share-lbl">current share</div>
          </div>
          <span class="nb-traj" :class="'nb-traj--' + (narrative.chinese_oem_threat.trajectory || 'insufficient_data')">{{ trajLabel(narrative.chinese_oem_threat.trajectory) }}</span>
        </div>
        <p class="nb-muted">{{ narrative.chinese_oem_threat.summary }}</p>
        <div v-if="narrative.chinese_oem_threat.quarter_on_quarter?.length" class="nb-qoq">
          <div v-for="(q, i) in narrative.chinese_oem_threat.quarter_on_quarter" :key="i" class="nb-qoq-col">
            <div class="nb-qoq-bar-wrap"><div class="nb-qoq-bar" :style="{ height: Math.max(pctNum(q.chinese_share), 4) + '%' }" /></div>
            <div class="nb-qoq-val">{{ q.chinese_share }}</div>
            <div class="nb-qoq-lbl">{{ q.quarter }}</div>
          </div>
        </div>
        <div v-if="narrative.chinese_oem_threat.models_most_affected?.length" style="margin-top: 10px">
          <span class="nb-eyebrow-inline">Models most affected</span>
          <span v-for="(m, i) in narrative.chinese_oem_threat.models_most_affected" :key="i" class="nb-chip">{{ m }}</span>
        </div>
      </div>
    </div>

    <div v-if="narrative.why_customers_choose_competitors" class="nb-card">
      <div class="nb-card-title"><Scale :size="16" class="nb-ico" style="color:#64748b" /> Why customers choose competitors</div>
      <div class="nb-2col">
        <div>
          <div class="nb-eyebrow-inline">All competitors</div>
          <div v-for="(r, i) in narrative.why_customers_choose_competitors.overall_reasons" :key="i" class="nb-reason">
            <div class="nb-reason-title">{{ r.reason }}</div>
            <div class="nb-reason-ev">{{ r.evidence }}</div>
          </div>
        </div>
        <div>
          <div class="nb-eyebrow-inline nb-eyebrow--cn">Chinese-OEM specific</div>
          <div v-for="(r, i) in narrative.why_customers_choose_competitors.chinese_specific_reasons" :key="i" class="nb-reason nb-reason--cn">
            <div class="nb-reason-title">{{ r.reason }}</div>
            <div class="nb-reason-ev">{{ r.evidence }}</div>
          </div>
        </div>
      </div>
      <div v-if="narrative.why_customers_choose_competitors.comparison" class="nb-compare">{{ narrative.why_customers_choose_competitors.comparison }}</div>
    </div>

    <div v-if="narrative.model_risk?.length" class="nb-card">
      <div class="nb-card-title"><TrendingDown :size="16" class="nb-ico" style="color:#e11d48" /> Model risk</div>
      <div class="nb-model-grid">
        <div v-for="(m, i) in narrative.model_risk" :key="i" class="nb-model">
          <div class="nb-model-head"><span class="nb-dot" :class="'nb-dot--' + (m.risk || 'low')" /> {{ m.model }} <span class="nb-model-risk">{{ m.risk }}</span></div>
          <div class="nb-reason-ev">{{ m.evidence }}</div>
          <div v-if="m.top_competitor" class="nb-muted" style="font-size: 11px; margin-top: 4px">Top competitor: {{ m.top_competitor }}</div>
        </div>
      </div>
    </div>

    <div v-if="narrative.emerging_themes?.length" class="nb-card">
      <div class="nb-card-title"><TrendingUp :size="16" class="nb-ico" style="color:#2b6cb0" /> Emerging themes</div>
      <div v-for="(t, i) in narrative.emerging_themes" :key="i" class="nb-theme">
        <div class="nb-theme-head">
          <span class="nb-dir" :class="'nb-dir--' + (t.direction || 'stable')">{{ dirArrow(t.direction) }}</span>
          <strong>{{ t.theme }}</strong>
        </div>
        <div class="nb-reason-ev">{{ t.evidence }}</div>
        <div v-if="t.sample_quotes?.length" class="nb-quotes">
          <div v-for="(q, qi) in t.sample_quotes" :key="qi" class="nb-quote">&ldquo;{{ q }}&rdquo;</div>
        </div>
      </div>
    </div>

    <div class="nb-grid">
      <div v-if="narrative.what_nissan_does_well?.length" class="nb-card nb-card--good">
        <div class="nb-card-title"><CircleCheck :size="16" class="nb-ico" style="color:#059669" /> What Nissan does well</div>
        <div v-for="(s, i) in narrative.what_nissan_does_well" :key="i" class="nb-item">
          <div class="nb-item-title">{{ s.strength }}</div>
          <div class="nb-reason-ev">{{ s.evidence }}</div>
        </div>
      </div>
      <div v-if="narrative.key_risks?.length" class="nb-card nb-card--risk">
        <div class="nb-card-title"><TriangleAlert :size="16" class="nb-ico" style="color:#d97706" /> Key risks</div>
        <div v-for="(r, i) in narrative.key_risks" :key="i" class="nb-item">
          <div class="nb-item-title">{{ r.risk }}</div>
          <div class="nb-reason-ev">{{ r.commercial_implication }}</div>
        </div>
      </div>
    </div>

    <div v-if="narrative.recommendations?.length" class="nb-card nb-card--reco">
      <div class="nb-card-title"><Lightbulb :size="16" class="nb-ico" style="color:#7c3aed" /> Recommendations</div>
      <div v-for="(r, i) in narrative.recommendations" :key="i" class="nb-reco">
        <div class="nb-reco-num">{{ Number(i) + 1 }}</div>
        <div class="nb-reco-body">
          <div class="nb-reco-action">{{ r.action }}</div>
          <div class="nb-reason-ev">{{ r.rationale }}</div>
          <div class="nb-reco-tags">
            <span v-if="r.priority" class="nb-tag" :class="'nb-tag--' + r.priority">{{ r.priority }} priority</span>
            <span v-if="r.owner" class="nb-tag nb-tag--owner">{{ r.owner }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="narrative.notes_on_data_quality?.length" class="nb-notes">
      <strong>Data quality notes:</strong>
      <span v-for="(n, i) in narrative.notes_on_data_quality" :key="i">{{ n }}<span v-if="Number(i) < narrative.notes_on_data_quality.length - 1"> &middot; </span></span>
    </div>
  </div>
</template>

<style scoped>
.nb { display: flex; flex-direction: column; gap: 16px; }

/* Hero */
.nb-hero {
  padding: 20px 22px; border-radius: 12px;
  color: var(--ink, #121a32);
  background: color-mix(in srgb, var(--brand, #2b6cb0) 5%, var(--surface, #fff));
  border: 1px solid var(--border, #e5e7eb);
  border-left: 4px solid var(--brand, #2b6cb0);
}
.nb-hero-eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--brand, #2b6cb0); font-weight: 700; }
.nb-hero-headline { font-size: 24px; font-weight: 800; line-height: 1.2; margin-top: 8px; max-width: 46ch; color: var(--ink, #121a32); }
.nb-hero-sub { font-size: 13px; color: var(--muted, #64748b); margin-top: 10px; }

/* KPI row */
.nb-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
.nb-kpi {
  padding: 16px 18px; border-radius: 12px; background: var(--surface, #fff);
  border: 1px solid var(--border, #e5e7eb); border-left: 4px solid #6366f1;
  box-shadow: 0 4px 14px -8px rgba(0,0,0,0.25);
}
.nb-kpi-value { font-size: 26px; font-weight: 800; color: var(--ink, #0f172a); line-height: 1; letter-spacing: -0.01em; }
.nb-kpi-label { font-size: 11px; color: var(--muted, #64748b); margin-top: 6px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

/* Callout */
.nb-callout { padding: 18px 20px; border-radius: 12px; background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.25); }
.nb-section-eyebrow { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #6366f1; margin-bottom: 6px; }
.nb-callout-text { margin: 0; font-size: 14px; line-height: 1.6; color: var(--ink, #1e293b); }

/* Cards */
.nb-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.nb-card { padding: 18px 20px; border-radius: 12px; background: var(--surface, #fff); border: 1px solid var(--border, #e5e7eb); box-shadow: 0 4px 14px -10px rgba(0,0,0,0.2); }
.nb-card--threat { border-color: rgba(234,88,12,0.4); background: linear-gradient(180deg, rgba(234,88,12,0.05), transparent 60%); }
.nb-card--good { border-left: 4px solid #059669; }
.nb-card--risk { border-left: 4px solid #dc2626; }
.nb-card--reco { border-left: 4px solid #6366f1; }
.nb-card-title { font-size: 15px; font-weight: 800; color: var(--ink, #0f172a); margin-bottom: 10px; }
.nb-ico {
  box-sizing: content-box;
  padding: 5px;
  border-radius: 7px;
  background: color-mix(in srgb, currentColor 15%, transparent);
  vertical-align: -9px;
  margin-right: 8px;
}
.nb-muted { font-size: 12.5px; color: var(--muted, #64748b); line-height: 1.5; margin: 0 0 12px; }

/* Competitor leaderboard */
.nb-lb-row { display: grid; grid-template-columns: 26px 1fr 90px auto; gap: 10px; align-items: center; padding: 6px 0; }
.nb-lb-rank { width: 24px; height: 24px; border-radius: 50%; background: #eef2ff; color: #4338ca; font-weight: 800; font-size: 12px; display: flex; align-items: center; justify-content: center; }
.nb-lb-brand { font-size: 13px; font-weight: 600; color: var(--ink, #1e293b); }
.nb-lb-note { font-size: 11px; color: var(--muted, #94a3b8); font-weight: 400; }
.nb-lb-bar { height: 8px; background: var(--surface-2, #eef2f7); border-radius: 6px; overflow: hidden; }
.nb-lb-fill { height: 100%; border-radius: 6px; }
.nb-fill--cn { background: linear-gradient(90deg, #fca5a5, #dc2626); }
.nb-fill--grey { background: linear-gradient(90deg, #cbd5e1, #64748b); }
.nb-lb-val { font-size: 13px; font-weight: 700; color: var(--ink, #334155); text-align: right; }

/* Chinese-OEM threat */
.nb-threat-top { display: flex; align-items: center; gap: 16px; margin-bottom: 10px; }
.nb-threat-share-val { font-size: 30px; font-weight: 800; color: #ea580c; line-height: 1; }
.nb-threat-share-lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.nb-traj { padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; }
.nb-traj--accelerating { background: #fee2e2; color: #b91c1c; }
.nb-traj--stable { background: #fef3c7; color: #b45309; }
.nb-traj--declining { background: #dcfce7; color: #15803d; }
.nb-traj--insufficient_data { background: #f1f5f9; color: #64748b; }
.nb-qoq { display: flex; gap: 10px; align-items: flex-end; height: 110px; margin-top: 12px; }
.nb-qoq-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
.nb-qoq-bar-wrap { width: 100%; flex: 1; display: flex; align-items: flex-end; }
.nb-qoq-bar { width: 100%; background: linear-gradient(180deg, #fb923c, #ea580c); border-radius: 5px 5px 0 0; min-height: 4px; transition: height 0.4s; }
.nb-qoq-val { font-size: 11px; font-weight: 700; color: #ea580c; }
.nb-qoq-lbl { font-size: 10px; color: var(--muted); }

/* Chips / badges */
.nb-chip { display: inline-block; margin: 2px 4px 2px 0; padding: 3px 9px; border-radius: 20px; background: #eef2ff; color: #4338ca; font-size: 11px; font-weight: 600; }
.nb-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: 800; vertical-align: middle; }
.nb-badge--cn { background: #dc2626; color: #fff; }
.nb-eyebrow-inline { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 8px; }
.nb-eyebrow--cn { color: #dc2626; }

/* Reasons */
.nb-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.nb-reason { padding: 8px 10px; border-radius: 8px; background: var(--surface-2, #f8fafc); margin-bottom: 6px; border-left: 3px solid #94a3b8; }
.nb-reason--cn { border-left-color: #dc2626; background: rgba(220,38,38,0.04); }
.nb-reason-title { font-size: 13px; font-weight: 700; color: var(--ink, #1e293b); }
.nb-reason-ev { font-size: 12px; color: var(--muted, #64748b); line-height: 1.5; margin-top: 2px; }
.nb-compare { margin-top: 12px; padding: 12px 14px; border-radius: 8px; background: rgba(99,102,241,0.07); font-size: 13px; line-height: 1.55; color: var(--ink, #334155); font-style: italic; }

/* Model risk */
.nb-model-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.nb-model { padding: 12px 14px; border-radius: 10px; background: var(--surface-2, #f8fafc); border: 1px solid var(--border, #eef2f7); }
.nb-model-head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--ink, #1e293b); }
.nb-model-risk { margin-left: auto; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.nb-dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.nb-dot--high { background: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.18); }
.nb-dot--medium { background: #ea580c; box-shadow: 0 0 0 3px rgba(234,88,12,0.18); }
.nb-dot--low { background: #059669; box-shadow: 0 0 0 3px rgba(5,150,105,0.18); }

/* Themes */
.nb-theme { padding: 10px 0; border-bottom: 1px solid var(--border, #eef2f7); }
.nb-theme:last-child { border-bottom: none; }
.nb-theme-head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--ink, #1e293b); }
.nb-dir { font-size: 12px; font-weight: 800; }
.nb-dir--increasing { color: #dc2626; }
.nb-dir--decreasing { color: #059669; }
.nb-dir--stable { color: #94a3b8; }
.nb-quotes { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.nb-quote { font-size: 12px; font-style: italic; color: var(--ink, #475569); padding-left: 12px; border-left: 3px solid #c7d2fe; }

/* Strengths / risks items */
.nb-item { padding: 8px 0; border-bottom: 1px dashed var(--border, #eef2f7); }
.nb-item:last-child { border-bottom: none; }
.nb-item-title { font-size: 13px; font-weight: 700; color: var(--ink, #1e293b); }

/* Recommendations */
.nb-reco { display: flex; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--border, #eef2f7); }
.nb-reco:last-child { border-bottom: none; }
.nb-reco-num { width: 30px; height: 30px; flex: none; border-radius: 50%; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; }
.nb-reco-body { flex: 1; }
.nb-reco-action { font-size: 14px; font-weight: 700; color: var(--ink, #0f172a); }
.nb-reco-tags { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.nb-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 9px; border-radius: 20px; }
.nb-tag--high { background: #fee2e2; color: #b91c1c; }
.nb-tag--medium { background: #fef3c7; color: #b45309; }
.nb-tag--low { background: #f1f5f9; color: #475569; }
.nb-tag--owner { background: #eef2ff; color: #4338ca; }

.nb-notes { font-size: 11px; color: var(--muted, #94a3b8); padding-top: 4px; line-height: 1.5; }

@media (max-width: 640px) {
  .nb-2col { grid-template-columns: 1fr; }
  .nb-hero-headline { font-size: 21px; }
}
</style>
