<template>
  <div class="sh-root">
    <div class="sh-header">
      <div>
        <h2 class="sh-title">System Health</h2>
        <p class="sh-sub">Live checks on the pieces the pipeline depends on. Green = OK, amber = attention, red = broken.</p>
      </div>
      <div class="sh-actions">
        <span v-if="report" class="sh-overall" :class="'sh-pill--' + report.status">{{ statusLabel(report.status) }}</span>
        <button class="sh-btn" :disabled="loading" @click="load">{{ loading ? "Checking…" : "Refresh" }}</button>
      </div>
    </div>

    <div v-if="error" class="sh-error">{{ error }}</div>

    <!-- Core checks -->
    <div v-if="loading && !report" class="sh-hint">Running checks…</div>
    <div v-else-if="report" class="sh-grid">
      <div v-for="c in report.checks" :key="c.key" class="sh-card" :class="'sh-card--' + c.status">
        <div class="sh-card-head">
          <span class="sh-dot" :class="'sh-dot--' + c.status" />
          <span class="sh-card-label">{{ c.label }}</span>
          <span class="sh-card-status" :class="'sh-pill--' + c.status">{{ statusLabel(c.status) }}</span>
        </div>
        <div class="sh-card-detail">{{ c.detail }}</div>
        <div v-if="c.items && c.items.length" class="sh-items">
          <div v-for="(it, i) in c.items" :key="i" class="sh-item" :class="{ 'sh-item--bad': !it.ok }">
            <span class="sh-item-mark">{{ it.ok ? "✓" : "✗" }}</span>
            <span class="sh-item-name">{{ it.name }}</span>
            <span v-if="it.note" class="sh-item-note">{{ it.note }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="report" class="sh-ts">Checked {{ fmtTime(report.generatedAt) }}</div>

    <!-- Connectivity (on demand) -->
    <div class="sh-conn-head">
      <div>
        <h3 class="sh-subtitle">Outbound connectivity</h3>
        <p class="sh-sub">Probes Deepgram and the recording host from this server. Runs on demand — it makes real network calls.</p>
      </div>
      <button class="sh-btn sh-btn--ghost" :disabled="connLoading" @click="runConnectivity">
        {{ connLoading ? "Testing…" : "Run connectivity tests" }}
      </button>
    </div>
    <div v-if="connError" class="sh-error">{{ connError }}</div>
    <div v-if="conn" class="sh-grid">
      <div v-for="c in conn.checks" :key="c.key" class="sh-card" :class="'sh-card--' + c.status">
        <div class="sh-card-head">
          <span class="sh-dot" :class="'sh-dot--' + c.status" />
          <span class="sh-card-label">{{ c.label }}</span>
          <span class="sh-card-status" :class="'sh-pill--' + c.status">{{ statusLabel(c.status) }}</span>
        </div>
        <div class="sh-card-detail">{{ c.detail }}</div>
      </div>
    </div>
    <div v-if="conn" class="sh-ts">Tested {{ fmtTime(conn.generatedAt) }}</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import api from "@/services/api";

type CheckStatus = "ok" | "warn" | "error";
interface HealthCheck {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
  items?: Array<{ name: string; ok: boolean; note?: string }>;
}
interface HealthReport {
  status: CheckStatus;
  generatedAt: string;
  checks: HealthCheck[];
}

const report = ref<HealthReport | null>(null);
const loading = ref(false);
const error = ref("");

const conn = ref<HealthReport | null>(null);
const connLoading = ref(false);
const connError = ref("");

function statusLabel(s: CheckStatus) {
  return s === "ok" ? "OK" : s === "warn" ? "Attention" : "Error";
}
function fmtTime(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    report.value = (await api.get<HealthReport>("/uiapi/health")).data;
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.message || "Failed to load health checks";
  } finally {
    loading.value = false;
  }
}

async function runConnectivity() {
  connLoading.value = true;
  connError.value = "";
  try {
    conn.value = (await api.get<HealthReport>("/uiapi/health/connectivity")).data;
  } catch (e: any) {
    connError.value = e?.response?.data?.message || e?.message || "Failed to run connectivity tests";
  } finally {
    connLoading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.sh-root { padding: 20px 24px; max-width: 1100px; }
.sh-header, .sh-conn-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.sh-conn-head { margin-top: 28px; padding-top: 20px; border-top: 1px solid var(--border); }
.sh-title { font-size: 20px; font-weight: 800; color: var(--ink); margin: 0; }
.sh-subtitle { font-size: 15px; font-weight: 800; color: var(--ink); margin: 0; }
.sh-sub { font-size: 13px; color: var(--muted); margin: 4px 0 0; max-width: 640px; }
.sh-actions { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.sh-btn {
  border: 1px solid var(--brand, #6366f1); background: var(--brand, #6366f1); color: #fff;
  font-size: 13px; font-weight: 700; padding: 7px 14px; border-radius: 8px; cursor: pointer; white-space: nowrap;
}
.sh-btn--ghost { background: transparent; color: var(--brand, #6366f1); }
.sh-btn:disabled { opacity: 0.55; cursor: default; }
.sh-hint { color: var(--muted); font-size: 14px; padding: 20px 0; }
.sh-error { color: #dc2626; font-size: 13px; margin: 12px 0; }

.sh-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px; margin-top: 16px;
}
.sh-card {
  border: 1px solid var(--border); border-left-width: 4px; border-radius: 10px;
  padding: 14px 16px; background: var(--surface, #fff);
}
.sh-card--ok { border-left-color: #059669; }
.sh-card--warn { border-left-color: #d97706; }
.sh-card--error { border-left-color: #dc2626; }
.sh-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.sh-card-label { font-size: 14px; font-weight: 700; color: var(--ink); flex: 1; }
.sh-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.sh-dot--ok { background: #059669; }
.sh-dot--warn { background: #d97706; }
.sh-dot--error { background: #dc2626; }
.sh-card-detail { font-size: 13px; line-height: 1.5; color: var(--ink); }
.sh-card-status, .sh-overall {
  font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 2px 8px; border-radius: 999px;
}
.sh-pill--ok { background: color-mix(in srgb, #10b981 15%, transparent); color: #059669; }
.sh-pill--warn { background: color-mix(in srgb, #f59e0b 18%, transparent); color: #b45309; }
.sh-pill--error { background: color-mix(in srgb, #ef4444 15%, transparent); color: #dc2626; }

.sh-items { margin-top: 10px; display: flex; flex-direction: column; gap: 3px; }
.sh-item {
  display: flex; align-items: baseline; gap: 8px; font-size: 12px; color: var(--ink);
  padding: 2px 0; border-bottom: 1px dotted var(--border);
}
.sh-item-mark { color: #059669; font-weight: 800; width: 12px; flex-shrink: 0; }
.sh-item--bad .sh-item-mark { color: #dc2626; }
.sh-item-name { flex: 1; }
.sh-item-note { color: var(--muted); font-size: 11px; font-style: italic; }
.sh-ts { font-size: 11px; color: var(--muted); margin-top: 10px; }
</style>
