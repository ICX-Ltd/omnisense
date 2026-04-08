<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { ApiPath } from "@/enums/api";

const filterKey = ref<string>("");
const narrativeType = ref<string>("");
const provider = ref<string>("");
const _today = new Date();
const _thirtyDaysAgo = new Date(_today.getTime() - 30 * 24 * 60 * 60 * 1000);
const createdFrom = ref(_thirtyDaysAgo.toISOString().slice(0, 10));
const createdTo = ref(_today.toISOString().slice(0, 10));
const loading = ref(false);
const error = ref("");
const narratives = ref<Array<any>>([]);
const selectedId = ref<string | null>(null);

const selected = computed(
  () => narratives.value.find((n) => n.id === selectedId.value) ?? null
);

const narrative = computed(() => selected.value?.narrative ?? null);

function labelForEntry(entry: any): string {
  const parts: string[] = [];

  const headline = entry?.narrative?.headline;
  if (headline) {
    parts.push(headline);
  } else {
    const from = entry.from ? fmtDate(entry.from) : "?";
    const to = entry.to ? fmtDate(entry.to) : "?";
    parts.push(`${from} → ${to}`);
  }

  const tags: string[] = [];
  if (entry.filterKey) tags.push(entry.filterKey);
  if (entry.narrativeType && entry.narrativeType !== "generic") tags.push(entry.narrativeType.replace(/_/g, " "));
  if (entry.campaign) tags.push(`campaign: ${entry.campaign}`);
  if (entry.agent) tags.push(`agent: ${entry.agent}`);
  if (tags.length) parts.push(`[${tags.join(" | ")}]`);

  return parts.join(" ");
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isStringArray(val: any): val is string[] {
  return Array.isArray(val) && val.every((v) => typeof v === "string");
}

function isObjectArray(val: any): val is Record<string, any>[] {
  return (
    Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && val[0] !== null
  );
}

function riskClass(level: string) {
  const l = (level ?? "").toLowerCase();
  if (l === "high") return "chip chip--danger";
  if (l === "medium") return "chip chip--warning";
  if (l === "low") return "chip chip--success";
  return "chip chip--secondary";
}

function priorityClass(p: string) {
  return riskClass(p);
}

function providerChip(p: string | null | undefined) {
  const v = (p || "").toLowerCase();
  if (v === "openai") return "chip chip--ins-openai";
  if (v === "anthropic") return "chip chip--ins-anthropic";
  if (v === "gemini") return "chip chip--ins-gemini";
  if (v === "grok" || v === "xai") return "chip chip--ins-grok";
  return "chip chip--secondary";
}

function channelChip(k: string | null | undefined) {
  const v = (k || "").toLowerCase();
  if (v === "calls") return "chip chip--tr-deepgram";
  if (v === "chats") return "chip chip--info";
  return "chip chip--secondary";
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const res = await axios.get(ApiPath.InsightsSummaryNarratives, {
      params: {
        limit: 100,
        ...(filterKey.value && { filterKey: filterKey.value }),
        ...(provider.value && { provider: provider.value }),
        ...(narrativeType.value && { narrativeType: narrativeType.value }),
        ...(createdFrom.value && { createdFrom: createdFrom.value }),
        ...(createdTo.value && { createdTo: createdTo.value }),
      },
    });
    narratives.value = Array.isArray(res.data) ? res.data : [];
    selectedId.value = narratives.value.length ? narratives.value[0].id : null;
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to load narratives";
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <!-- Hero -->
      <div class="hero">
        <div class="hero-row">
          <div>
            <h1 class="hero-title">Narratives</h1>
            <div class="hero-subtitle">Browse historical AI-generated narrative summaries.</div>
          </div>
        </div>
      </div>

      <!-- Controls -->
      <div class="tile tile--accent" style="margin-bottom: 14px">
        <div class="tile-head">
          <div class="tile-icon">⚙</div>
          <div class="tile-text">
            <div class="tile-title">Filters</div>
            <div class="tile-desc">Filter narratives by channel, type and provider</div>
          </div>
        </div>
        <div class="tile-body">
          <div class="controls-row">
            <div class="control-group">
              <label class="control-label">Channel</label>
              <select v-model="filterKey" class="select">
                <option value="">Any</option>
                <option value="calls">Calls</option>
                <option value="chats">Chats</option>
                <option value="all">All</option>
              </select>
            </div>

            <div class="control-group">
              <label class="control-label">Narrative Type</label>
              <select v-model="narrativeType" class="select">
                <option value="">Any</option>
                <option value="generic">Generic</option>
                <option value="calls_operations">Calls — Operations</option>
                <option value="calls_client_services">Calls — Client Services</option>
                <option value="chats_operations">Chats — Operations</option>
                <option value="chats_client_services">Chats — Client Services</option>
                <option value="survey_analytics">Survey Analytics</option>
              </select>
            </div>

            <div class="control-group">
              <label class="control-label">Provider</label>
              <select v-model="provider" class="select">
                <option value="">Any</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
                <option value="grok">Grok</option>
              </select>
            </div>

            <div class="control-group">
              <label class="control-label">Created From</label>
              <input type="date" v-model="createdFrom" class="input input--date" />
            </div>

            <div class="control-group">
              <label class="control-label">Created To</label>
              <input type="date" v-model="createdTo" class="input input--date" />
            </div>

            <button class="btn btn--primary" :disabled="loading" @click="load" style="margin-top: 18px">
              {{ loading ? "Loading…" : "Load" }}
            </button>
          </div>

          <!-- Narrative selector -->
          <div v-if="narratives.length" class="control-group" style="margin-top: 10px">
            <label class="control-label">Narrative</label>
            <select v-model="selectedId" class="select select--wide">
              <option v-for="n in narratives" :key="n.id" :value="n.id">
                {{ labelForEntry(n) }} &mdash; {{ fmtDateTime(n.createdAt) }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-if="error" class="error-bar">{{ error }}</div>

      <!-- Empty state -->
      <div v-else-if="!loading && !narratives.length" class="empty-state">
        No narratives found for the selected filters.
      </div>

      <!-- Narrative viewer -->
      <template v-else-if="selected && narrative">
        <!-- Meta strip -->
        <div class="meta-strip">
          <span :class="channelChip(selected.filterKey)">{{ selected.filterKey || "any" }}</span>
          <span class="chip chip--primary">{{ selected.narrativeType || "generic" }}</span>
          <span :class="providerChip(selected.providerUsed)">{{ selected.providerUsed }}</span>
          <span v-if="selected.model" class="chip chip--secondary">{{ selected.model }}</span>
          <span v-if="selected.campaign" class="chip chip--secondary">Campaign: {{ selected.campaign }}</span>
          <span v-if="selected.agent" class="chip chip--secondary">Agent: {{ selected.agent }}</span>
          <span class="chip chip--info">{{ fmtDate(selected.from) }} → {{ fmtDate(selected.to) }}</span>
          <span class="chip chip--secondary">Generated {{ fmtDateTime(selected.createdAt) }}</span>
        </div>

        <!-- Headline -->
        <div v-if="narrative.headline" class="narr-headline">
          {{ narrative.headline }}
        </div>

        <!-- Generic field renderer -->
        <div class="narr-body">
          <template v-for="(value, key) in narrative" :key="key">
            <!-- Skip headline — already shown above -->
            <template v-if="key !== 'headline'">

              <!-- String values -->
              <div v-if="typeof value === 'string'" class="narr-section">
                <div class="narr-section-title">{{ toLabel(String(key)) }}</div>
                <p class="narr-text">{{ value }}</p>
              </div>

              <!-- Number values -->
              <div v-else-if="typeof value === 'number'" class="narr-section">
                <div class="narr-section-title">{{ toLabel(String(key)) }}</div>
                <p class="narr-text">{{ value }}</p>
              </div>

              <!-- Array of strings -->
              <div v-else-if="isStringArray(value)" class="narr-section">
                <div class="narr-section-title">{{ toLabel(String(key)) }}</div>
                <ul class="narr-list">
                  <li v-for="(item, i) in value" :key="i">{{ item }}</li>
                </ul>
              </div>

              <!-- Array of objects -->
              <div v-else-if="isObjectArray(value)" class="narr-section">
                <div class="narr-section-title">{{ toLabel(String(key)) }}</div>
                <div class="narr-cards">
                  <div v-for="(item, i) in value" :key="i" class="narr-card">
                    <div
                      v-for="(fieldVal, fieldKey) in item"
                      :key="fieldKey"
                      class="narr-card-row"
                    >
                      <span class="narr-card-label">{{ toLabel(String(fieldKey)) }}</span>
                      <span
                        v-if="fieldKey === 'risk_level' || fieldKey === 'priority'"
                        :class="fieldKey === 'risk_level' ? riskClass(String(fieldVal)) : priorityClass(String(fieldVal))"
                      >
                        {{ fieldVal }}
                      </span>
                      <span v-else class="narr-card-value">{{ fieldVal }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Fallback: any other type -->
              <div v-else class="narr-section">
                <div class="narr-section-title">{{ toLabel(String(key)) }}</div>
                <pre class="narr-pre">{{ JSON.stringify(value, null, 2) }}</pre>
              </div>

            </template>
          </template>
        </div>
      </template>
  </div>
</template>

<style scoped>
.controls-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.control-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}

.select--wide {
  min-width: 320px;
  max-width: 100%;
}

.error-bar {
  background: var(--danger-soft);
  color: var(--danger);
  border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
  border-radius: var(--radius-lg);
  padding: 12px 16px;
  margin-bottom: 14px;
}

.empty-state {
  text-align: center;
  padding: 48px 16px;
  color: var(--muted);
  font-size: 14px;
}

.meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.narr-headline {
  font-size: 22px;
  font-weight: 900;
  color: var(--ink);
  line-height: 1.2;
  margin-bottom: 16px;
  padding: 16px 18px;
  background: linear-gradient(135deg, var(--brand-soft), var(--surface-soft-2));
  border: 1px solid color-mix(in srgb, var(--brand) 20%, transparent);
  border-radius: var(--radius-lg);
}

.narr-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.narr-section {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 16px;
}

.narr-section-title {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--brand);
  margin-bottom: 8px;
}

.narr-text {
  margin: 0;
  line-height: 1.6;
  color: var(--ink);
}

.narr-list {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--ink);
  line-height: 1.5;
}

.narr-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.narr-card {
  background: var(--surface-soft);
  border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.narr-card-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.narr-card-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
}

.narr-card-value {
  font-size: 13px;
  color: var(--ink);
  line-height: 1.4;
}

.narr-pre {
  margin: 0;
  font-size: 12px;
  font-family: ui-monospace, "Courier New", monospace;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
