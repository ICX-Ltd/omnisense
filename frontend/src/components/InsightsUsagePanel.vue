<script setup lang="ts">
import axios from "axios";
import { computed, ref } from "vue";
import { ApiPath } from "@/enums/api";

type ModelRow = {
  provider: string | null;
  model: string | null;
  records: number;
  measured_records: number;
  retried_records: number;
  input_tokens: number;
  output_tokens: number;
  failed_input_tokens: number;
  failed_output_tokens: number;
  total_tokens: number;
  wasted_tokens: number;
  priced: boolean;
  est_cost: number | null;
  est_wasted_cost: number | null;
};
type UsageData = {
  currency: string;
  totals: {
    records: number;
    measured_records: number;
    retried_records: number;
    retry_rate: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    wasted_tokens: number;
    est_cost: number;
    est_wasted_cost: number;
  };
  by_model: ModelRow[];
  all_attempts: {
    records: number;
    attempt_count: number;
    failed_attempts: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    est_cost: number;
  } | null;
  transcription: {
    transcriptions: number;
    successes: number;
    audio_seconds: number;
    audio_minutes: number;
    est_cost: number;
    by_model: Array<{
      provider: string | null;
      model: string | null;
      transcriptions: number;
      successes: number;
      measured: number;
      audio_seconds: number;
      audio_minutes: number;
      priced: boolean;
      est_cost: number | null;
    }>;
    unpriced_models: string[];
  } | null;
  unpriced_models: string[];
};

// Default to the last 30 days.
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const from = ref(isoDaysAgo(30));
const to = ref(today());
const filterKey = ref<"calls" | "chats" | "all">("all");

const open = ref(false);
const loading = ref(false);
const error = ref("");
const data = ref<UsageData | null>(null);

// Collapsed by default (it's at the top but not always needed); lazy-load on
// first expand so it doesn't fetch when unused.
function toggleOpen() {
  open.value = !open.value;
  if (open.value && !data.value) load();
}

const currency = computed(() => data.value?.currency ?? "USD");

function fmtInt(n: number | null | undefined): string {
  if (typeof n !== "number") return "—";
  return n.toLocaleString();
}
function fmtMoney(n: number | null | undefined): string {
  if (typeof n !== "number") return "—";
  return `${currency.value} ${n.toFixed(2)}`;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const res = await axios.get(ApiPath.InsightsUsage, {
      params: { from: from.value, to: to.value, filterKey: filterKey.value },
    });
    data.value = res.data;
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load usage";
  } finally {
    loading.value = false;
  }
}

</script>

<template>
  <div class="tile">
    <div class="tile-head" style="cursor: pointer" @click="toggleOpen">
      <div class="tile-icon">&#163;</div>
      <div class="tile-text">
        <div class="tile-title">Insights Usage &amp; Cost</div>
        <div class="tile-desc">Token spend and retry overhead from your own data — no provider console needed.</div>
      </div>
      <div style="flex: 1"></div>
      <span style="font-size: 13px; color: var(--muted); padding: 0 4px">{{ open ? "▾" : "▸" }}</span>
    </div>
    <div v-show="open" class="tile-body">
      <!-- Controls -->
      <div class="usage-controls">
        <label class="usage-field">
          <span class="label">From</span>
          <input type="date" v-model="from" class="input input--date" />
        </label>
        <label class="usage-field">
          <span class="label">To</span>
          <input type="date" v-model="to" class="input input--date" />
        </label>
        <label class="usage-field">
          <span class="label">Channel</span>
          <select v-model="filterKey" class="select select--sm">
            <option value="all">All</option>
            <option value="calls">Calls</option>
            <option value="chats">Chats</option>
          </select>
        </label>
        <button class="btn btn--primary btn--sm" :disabled="loading" @click="load">
          {{ loading ? "Loading…" : "Refresh" }}
        </button>
      </div>

      <div v-if="error" class="error-tile" style="margin-top: 10px">{{ error }}</div>

      <template v-if="data">
        <!-- Headline stats -->
        <div class="stats-strip" style="margin-top: 12px">
          <div class="stat">
            <div class="stat-label">Est. cost</div>
            <div class="stat-value">{{ fmtMoney(data.totals.est_cost) }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Records (measured)</div>
            <div class="stat-value">{{ fmtInt(data.totals.measured_records) }}<span v-if="data.totals.records !== data.totals.measured_records" style="font-size: 12px; color: var(--muted)"> / {{ fmtInt(data.totals.records) }}</span></div>
          </div>
          <div class="stat">
            <div class="stat-label">Total tokens</div>
            <div class="stat-value">{{ fmtInt(data.totals.total_tokens) }}</div>
          </div>
          <div class="stat stat--wide">
            <div class="stat-label">Retry overhead</div>
            <div class="stat-value chip" :class="data.totals.wasted_tokens > 0 ? 'chip--warning' : 'chip--success'">{{ data.totals.retry_rate }}%</div>
            <div class="usage-subnote">
              {{ fmtInt(data.totals.retried_records) }} record(s) retried ·
              {{ fmtInt(data.totals.wasted_tokens) }} wasted tokens · {{ fmtMoney(data.totals.est_wasted_cost) }}
            </div>
          </div>
        </div>

        <!-- Complete spend incl. failed records (from the per-attempt log) -->
        <div v-if="data.all_attempts" class="usage-allattempts">
          <strong>All attempts (incl. retries &amp; failed records):</strong>
          {{ fmtMoney(data.all_attempts.est_cost) }} ·
          {{ fmtInt(data.all_attempts.total_tokens) }} tokens ·
          {{ fmtInt(data.all_attempts.attempt_count) }} attempts across {{ fmtInt(data.all_attempts.records) }} records
          <span v-if="data.all_attempts.failed_attempts" style="color: var(--danger, #ef4444)">({{ fmtInt(data.all_attempts.failed_attempts) }} failed)</span>
        </div>

        <div v-if="data.unpriced_models.length" class="hint" style="margin-top: 8px">
          No price set for: <strong>{{ data.unpriced_models.join(", ") }}</strong> — tokens counted, cost excluded.
          Add prices via <code>INSIGHTS_PRICES_JSON</code>.
        </div>

        <!-- Per-model breakdown -->
        <table v-if="data.by_model.length" class="usage-table">
          <thead>
            <tr>
              <th>Provider / model</th>
              <th class="num">Records</th>
              <th class="num">Input</th>
              <th class="num">Output</th>
              <th class="num">Wasted</th>
              <th class="num">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(m, i) in data.by_model" :key="i">
              <td>
                <span class="chip chip--secondary" style="font-size: 11px">{{ m.provider || "?" }}</span>
                <span class="mono" style="font-size: 11px; margin-left: 6px">{{ m.model || "unknown" }}</span>
              </td>
              <td class="num">{{ fmtInt(m.records) }}</td>
              <td class="num">{{ fmtInt(m.input_tokens) }}</td>
              <td class="num">{{ fmtInt(m.output_tokens) }}</td>
              <td class="num" :style="{ color: m.wasted_tokens > 0 ? 'var(--danger, #ef4444)' : 'inherit' }">{{ fmtInt(m.wasted_tokens) }}</td>
              <td class="num">{{ m.priced ? fmtMoney(m.est_cost) : "—" }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="hint" style="margin-top: 10px">No insights with usage data in this window. (Older records pre-date usage tracking.)</div>

        <!-- Transcription -->
        <template v-if="data.transcription">
          <div class="usage-subhead">Transcription (Deepgram + OpenAI)</div>
          <div class="stats-strip" style="margin-top: 8px">
            <div class="stat">
              <div class="stat-label">Est. cost</div>
              <div class="stat-value">{{ fmtMoney(data.transcription.est_cost) }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Transcriptions</div>
              <div class="stat-value">{{ fmtInt(data.transcription.transcriptions) }}</div>
            </div>
            <div class="stat">
              <div class="stat-label">Audio minutes</div>
              <div class="stat-value">{{ data.transcription.audio_minutes.toLocaleString() }}</div>
            </div>
          </div>
          <div class="hint" style="margin-top: 6px">
            OpenAI gpt-4o-transcribe doesn't report audio length, so its minutes &amp; cost aren't included (logged as events only).
          </div>
          <table v-if="data.transcription.by_model.length" class="usage-table">
            <thead>
              <tr><th>Provider / model</th><th class="num">Attempts</th><th class="num">Succeeded</th><th class="num">Minutes</th><th class="num">Est. cost</th></tr>
            </thead>
            <tbody>
              <tr v-for="(t, i) in data.transcription.by_model" :key="'tx' + i">
                <td>
                  <span class="chip chip--secondary" style="font-size: 11px">{{ t.provider || "?" }}</span>
                  <span class="mono" style="font-size: 11px; margin-left: 6px">{{ t.model || "unknown" }}</span>
                </td>
                <td class="num">{{ fmtInt(t.transcriptions) }}</td>
                <td class="num" :style="t.successes < t.transcriptions ? 'color: var(--danger, #dc2626); font-weight: 700' : ''">
                  {{ fmtInt(t.successes) }}<span v-if="t.successes < t.transcriptions" style="font-weight: 400; opacity: 0.8"> ({{ t.transcriptions - t.successes }} failed)</span>
                </td>
                <td class="num">{{ t.audio_seconds ? t.audio_minutes.toLocaleString() : "—" }}</td>
                <td class="num">{{ t.priced && t.audio_seconds ? fmtMoney(t.est_cost) : "—" }}</td>
              </tr>
            </tbody>
          </table>
        </template>

        <!-- Combined -->
        <div v-if="data.all_attempts && data.transcription" class="usage-allattempts" style="border-style: solid; margin-top: 14px">
          <strong>Combined est. cost (insights + transcription):</strong>
          {{ fmtMoney(data.all_attempts.est_cost + data.transcription.est_cost) }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.usage-controls {
  display: flex;
  gap: 12px;
  align-items: flex-end;
  flex-wrap: wrap;
}
.usage-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.usage-subnote {
  margin-top: 4px;
  font-size: 11px;
  color: var(--muted);
}
.usage-allattempts {
  margin-top: 10px;
  padding: 8px 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  font-size: 12px;
  color: var(--ink);
}
.usage-subhead {
  margin-top: 18px;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.usage-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 14px;
  font-size: 13px;
}
.usage-table th,
.usage-table td {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
}
.usage-table th.num,
.usage-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.usage-table th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
</style>
