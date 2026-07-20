<template>
  <div class="grs-wrap" ref="rootRef">
    <button
      class="grs-trigger"
      :class="{ 'grs-trigger--active': popoverOpen || !!detailId }"
      @click="togglePopover"
      title="Find a record"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="7"/>
        <path d="M20 20l-4.35-4.35"/>
      </svg>
      <span class="grs-trigger-label">Find record</span>
    </button>

    <div v-if="popoverOpen" class="grs-popover" @click.stop>
      <div class="grs-mode">
        <button class="grs-mode-btn" :class="{ 'grs-mode-btn--active': mode === 'id' }" @click="mode = 'id'">ID / TPS</button>
        <button class="grs-mode-btn" :class="{ 'grs-mode-btn--active': mode === 'semantic' }" @click="mode = 'semantic'">Meaning</button>
      </div>
      <div class="grs-popover-head">
        <input
          ref="inputRef"
          v-model="query"
          class="grs-input"
          :placeholder="mode === 'semantic' ? 'Describe what was said, e.g. “customer mentioned moving abroad”' : 'Interaction ID or TPS ID...'"
          @keydown.esc="closePopover"
          @keydown.enter="runSearch"
        />
        <button class="grs-btn" @click="runSearch" :disabled="!canSearch || searching">
          {{ searching ? "..." : "Search" }}
        </button>
      </div>

      <div v-if="mode === 'semantic'" class="grs-filters">
        <select v-model="semCampaign" class="grs-filter">
          <option value="">All campaigns</option>
          <option v-for="c in campaignOptions" :key="c" :value="c">{{ c }}</option>
        </select>
        <select v-model="semType" class="grs-filter">
          <option value="">All types</option>
          <option value="call">Call</option>
          <option value="chat">Chat</option>
        </select>
        <input v-model="semFrom" type="date" class="grs-filter" title="From date" />
        <input v-model="semTo" type="date" class="grs-filter" title="To date" />
      </div>

      <div class="grs-popover-body">
        <div v-if="!searched" class="grs-hint">
          <template v-if="mode === 'semantic'">Search transcripts by meaning (3+ chars). Only embedded transcripts are searched.</template>
          <template v-else>Paste a full or partial ID and hit Search (3+ chars).</template>
        </div>
        <div v-else-if="searching" class="grs-hint">Searching...</div>
        <div v-else-if="error" class="grs-hint grs-hint--error">{{ error }}</div>

        <!-- Semantic results -->
        <template v-else-if="mode === 'semantic'">
          <div v-if="semResults.length === 0" class="grs-hint">No transcripts matched “{{ lastQuery }}”.</div>
          <ul v-else class="grs-results">
            <li v-for="r in semResults" :key="r.id" class="grs-result" @click="openDetailId(r.id)">
              <div class="grs-result-head">
                <span class="grs-chip" :class="typeChipClass(r.interactionType)">{{ r.interactionType || "?" }}</span>
                <span v-if="r.campaign" class="grs-chip grs-chip--campaign">{{ r.campaign }}</span>
                <span class="grs-score">{{ Math.round(r.score * 100) }}% match</span>
                <span class="grs-result-date">{{ formatDate(r.date) }}</span>
              </div>
              <div class="grs-result-ids mono">
                <span v-if="r.interactionId"><strong>ID</strong> {{ r.interactionId }}</span>
                <span v-if="r.interactionTpsId"><strong>TPS</strong> {{ r.interactionTpsId }}</span>
              </div>
              <div v-if="r.snippet" class="grs-result-summary">{{ r.snippet }}</div>
            </li>
          </ul>
        </template>

        <div v-else-if="results.length === 0" class="grs-hint">
          No interactions matched “{{ lastQuery }}”.
        </div>
        <ul v-else class="grs-results">
          <li
            v-for="r in results"
            :key="r.id"
            class="grs-result"
            @click="openDetail(r)"
          >
            <div class="grs-result-head">
              <span class="grs-chip" :class="typeChipClass(r.interactionType)">
                {{ r.interactionType || "?" }}
              </span>
              <span v-if="r.campaign" class="grs-chip grs-chip--campaign">{{ r.campaign }}</span>
              <span class="grs-result-date">{{ formatDate(r.interactionDateTime) }}</span>
            </div>
            <div class="grs-result-ids mono">
              <span v-if="r.interactionId"><strong>ID</strong> {{ r.interactionId }}</span>
              <span v-if="r.interactionTpsId"><strong>TPS</strong> {{ r.interactionTpsId }}</span>
            </div>
            <div class="grs-result-meta">
              <span v-if="r.agent">{{ r.agent }}</span>
              <span v-if="r.outcome" class="grs-muted">· {{ r.outcome }}</span>
            </div>
            <div v-if="r.summaryShort" class="grs-result-summary">{{ r.summaryShort }}</div>
          </li>
        </ul>
      </div>
    </div>

    <InteractionDetailDrawer :recording-id="detailId" @close="closeDetail" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import {
  searchInteractions,
  semanticSearchTranscripts,
  type InteractionSearchResult,
  type SemanticSearchResult,
} from "@/services/interaction-search.service";
import api from "@/services/api";
import { ApiPath } from "@/enums/api";
import InteractionDetailDrawer from "./InteractionDetailDrawer.vue";

const rootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

const popoverOpen = ref(false);
const mode = ref<"id" | "semantic">("id");
const query = ref("");
const lastQuery = ref("");
const results = ref<InteractionSearchResult[]>([]);
const semResults = ref<SemanticSearchResult[]>([]);
const searching = ref(false);
const searched = ref(false);
const error = ref("");

// Semantic-mode filters (scope the candidate set like the dashboards).
const semCampaign = ref("");
const semType = ref("");
const semFrom = ref("");
const semTo = ref("");
const campaignOptions = ref<string[]>([]);
async function loadCampaignOptions() {
  try {
    const { data } = await api.get(ApiPath.InsightsSummaryFilters);
    campaignOptions.value = data?.campaigns ?? [];
  } catch {
    /* non-fatal — campaign filter just shows "All" */
  }
}

const detailId = ref<string | null>(null);

const canSearch = computed(() => query.value.trim().length >= 3);

function togglePopover() {
  if (popoverOpen.value) {
    closePopover();
    return;
  }
  popoverOpen.value = true;
  nextTick(() => inputRef.value?.focus());
}

function closePopover() {
  popoverOpen.value = false;
}

async function runSearch() {
  if (!canSearch.value) return;
  searching.value = true;
  error.value = "";
  searched.value = true;
  lastQuery.value = query.value.trim();
  try {
    if (mode.value === "semantic") {
      const res = await semanticSearchTranscripts(lastQuery.value, 20, {
        campaign: semCampaign.value || undefined,
        interactionType: semType.value || undefined,
        from: semFrom.value || undefined,
        to: semTo.value || undefined,
      });
      semResults.value = res.results;
    } else {
      results.value = await searchInteractions(lastQuery.value);
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? "Search failed";
    results.value = [];
    semResults.value = [];
  } finally {
    searching.value = false;
  }
}

function openDetail(r: InteractionSearchResult) {
  closePopover();
  detailId.value = r.id;
}

function openDetailId(id: string) {
  closePopover();
  detailId.value = id;
}

function closeDetail() {
  detailId.value = null;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function typeChipClass(t: string | null | undefined) {
  if (t === "chat") return "grs-chip--chat";
  if (t === "call") return "grs-chip--call";
  return "grs-chip--muted";
}

function onDocClick(e: MouseEvent) {
  if (!popoverOpen.value) return;
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) {
    closePopover();
  }
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  loadCampaignOptions();
});
onUnmounted(() => document.removeEventListener("click", onDocClick));
</script>

<style scoped>
.grs-wrap {
  position: relative;
}

.grs-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.85);
  padding: 7px 12px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.grs-trigger:hover {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
  border-color: rgba(255, 255, 255, 0.4);
}
.grs-trigger--active {
  background: #fff;
  color: #1a3a5c;
  border-color: #fff;
}
.grs-trigger-label {
  letter-spacing: 0.02em;
}

.grs-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  width: 440px;
  max-width: 90vw;
  background: #fff;
  border: 1px solid #d0d7de;
  border-radius: 12px;
  box-shadow: 0 16px 42px rgba(15, 23, 42, 0.18);
  z-index: 250;
  overflow: hidden;
  color: #1f2937;
}

.grs-mode {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  background: #f8fafc;
}
.grs-mode-btn {
  flex: 1;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #475569;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 5px 8px;
  border-radius: 7px;
  cursor: pointer;
}
.grs-mode-btn--active {
  background: linear-gradient(135deg, #1a3a5c, #2b6cb0);
  color: #fff;
  border-color: transparent;
}

.grs-popover-head {
  display: flex;
  gap: 6px;
  padding: 10px;
  border-bottom: 1px solid #eef1f6;
  background: #f8fafc;
}

.grs-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid #eef1f6;
  background: #f8fafc;
}
.grs-filter {
  flex: 1;
  min-width: 90px;
  border: 1px solid #cbd5e1;
  border-radius: 7px;
  padding: 5px 7px;
  font-size: 0.78rem;
  background: #fff;
  color: #1f2937;
  font-family: inherit;
}

.grs-score {
  font-size: 0.72rem;
  font-weight: 800;
  color: #059669;
}

.grs-input {
  flex: 1;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 0.9rem;
  outline: none;
  font-family: inherit;
}
.grs-input:focus {
  border-color: #2b6cb0;
  box-shadow: 0 0 0 3px rgba(43, 108, 176, 0.15);
}

.grs-btn {
  border: 1px solid transparent;
  border-radius: 8px;
  background: linear-gradient(135deg, #1a3a5c, #2b6cb0);
  color: #fff;
  padding: 8px 12px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}
.grs-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.grs-popover-body {
  max-height: 60vh;
  overflow-y: auto;
}

.grs-hint {
  padding: 16px;
  text-align: center;
  color: #64748b;
  font-size: 0.85rem;
}
.grs-hint--error {
  color: #b91c1c;
}

.grs-results {
  list-style: none;
  margin: 0;
  padding: 0;
}
.grs-result {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  transition: background 0.1s;
}
.grs-result:hover {
  background: #f1f5f9;
}
.grs-result:last-child {
  border-bottom: none;
}
.grs-result-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.grs-result-date {
  margin-left: auto;
  color: #64748b;
  font-size: 0.78rem;
}
.grs-result-ids {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 0.76rem;
  color: #334155;
}
.grs-result-ids strong {
  color: #64748b;
  font-weight: 600;
  margin-right: 3px;
}
.grs-result-meta {
  font-size: 0.82rem;
  color: #334155;
  margin-top: 3px;
}
.grs-muted {
  color: #64748b;
}
.grs-result-summary {
  margin-top: 4px;
  font-size: 0.8rem;
  color: #475569;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.grs-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  color: #fff;
}
.grs-chip--chat { background: #7c3aed; }
.grs-chip--call { background: #0284c7; }
.grs-chip--campaign { background: #f59e0b; text-transform: none; }
.grs-chip--muted { background: #94a3b8; }

.mono {
  font-family: "SF Mono", Menlo, Consolas, monospace;
}
</style>
