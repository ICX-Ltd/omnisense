<template>
  <div class="mr-root">
    <div class="mr-hero">
      <h2 class="mr-title">Model Registry</h2>
      <p class="mr-sub">The models offered in the insights/narrative dropdowns and the active transcription model — editable here, no deploy needed. Changes apply within a minute.</p>
    </div>

    <div v-if="msg" class="chip chip--primary" style="margin-bottom: 12px">{{ msg }}</div>

    <!-- Discover new / updated models -->
    <div class="tile">
      <div class="tile-head tile-head--toggle" @click="discOpen = !discOpen">
        <IconChip name="discover" />
        <div class="tile-text">
          <div class="tile-title">
            Check for new models
            <span v-if="discovery" class="mr-disc-badge">{{ discNewTotal ? `${discNewTotal} new` : "up to date" }}</span>
          </div>
          <div class="tile-desc">Asks each configured provider what models it currently offers and flags any that aren't in the registry yet — so new releases and upgrades don't get missed.</div>
        </div>
        <div class="spacer" />
        <button class="btn btn--primary btn--sm" :disabled="discovering" @click.stop="discover">{{ discovering ? "Checking…" : "Check now" }}</button>
        <svg class="mr-chev" :class="{ 'mr-chev--open': discOpen }" width="12" height="12" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div v-if="discOpen && discovery" class="tile-body">
        <div class="mr-ts">Checked {{ fmtTime(discovery.generatedAt) }}</div>
        <div v-for="p in discovery.providers" :key="p.provider" class="mr-disc">
          <div class="mr-disc-head">
            <span class="mr-prov-head" style="margin: 0">{{ p.provider }}</span>
            <span v-if="!p.ok" class="mr-disc-note mr-disc-note--warn">{{ p.error || "unavailable" }}</span>
            <span v-else-if="!p.newModels.length" class="mr-disc-note">up to date — {{ p.registeredCount }} registered, {{ p.totalOffered }} offered</span>
            <span v-else class="mr-disc-note mr-disc-note--new">{{ p.newModels.length }} new model{{ p.newModels.length === 1 ? "" : "s" }} available</span>
          </div>
          <div v-if="p.ok && p.newModels.length" class="mr-disc-list">
            <div v-for="id in p.newModels" :key="id" class="mr-disc-row">
              <span class="mr-model mono">{{ id }}</span>
              <button class="mr-mini" title="Add to insights registry" @click="addDiscovered(p.provider, id)">+ add</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Add -->
    <div class="tile">
      <div class="tile-head">
        <IconChip name="add" />
        <div class="tile-text">
          <div class="tile-title">Add a model</div>
          <div class="tile-desc">For insights, an empty model id means "the provider's own default".</div>
        </div>
      </div>
      <div class="tile-body">
        <div class="mr-add">
          <select v-model="add.kind" class="select"><option value="insights">insights</option><option value="transcription">transcription</option></select>
          <select v-model="add.provider" class="select">
            <option v-for="p in providersFor(add.kind)" :key="p" :value="p">{{ p }}</option>
          </select>
          <input v-model="add.modelId" class="select" :placeholder="add.kind === 'transcription' ? 'model id (e.g. nova-3)' : 'model id (blank = default)'" />
          <input v-model="add.label" class="select" placeholder="label shown in the dropdown" style="min-width: 200px" />
          <button class="btn btn--primary" :disabled="!add.provider || !add.label.trim() || (add.kind === 'transcription' && !add.modelId.trim())" @click="addModel">Add</button>
        </div>
      </div>
    </div>

    <!-- Groups -->
    <div v-for="grp in groups" :key="grp.kind" class="tile" style="margin-top: 14px">
      <div class="tile-head">
        <IconChip :name="grp.kind === 'transcription' ? 'transcription' : 'insights'" />
        <div class="tile-text">
          <div class="tile-title">{{ grp.kind === 'transcription' ? 'Transcription models' : 'Insights / narrative models' }}</div>
          <div class="tile-desc">{{ grp.kind === 'transcription' ? 'The starred Deepgram model is what transcription uses.' : 'The starred option per provider is pre-selected in the dropdown.' }}</div>
        </div>
        <div class="spacer" />
        <button class="btn btn--ghost btn--sm" :disabled="loading" @click="load">{{ loading ? "…" : "Refresh" }}</button>
      </div>
      <div class="tile-body">
        <div v-for="prov in grp.providers" :key="prov.provider" class="mr-prov">
          <div class="mr-prov-head">{{ prov.provider }}</div>
          <div v-for="r in prov.rows" :key="r.id" class="mr-row" :class="{ 'mr-row--off': !r.active }">
            <button class="mr-star" :class="{ 'mr-star--on': r.isDefault }" :title="r.isDefault ? 'Default' : 'Make default'" @click="makeDefault(r)">{{ r.isDefault ? "★" : "☆" }}</button>
            <span class="mr-label">{{ r.label }}</span>
            <span class="mr-model mono">{{ r.modelId || "(provider default)" }}</span>
            <div class="mr-actions">
              <button class="mr-mini" :title="r.active ? 'Disable' : 'Enable'" @click="toggleActive(r)">{{ r.active ? "on" : "off" }}</button>
              <button class="mr-mini mr-mini--del" title="Delete" @click="removeRow(r)">&times;</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import IconChip from "./IconChip.vue";
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { ApiPath } from "@/enums/api";

interface ModelRow {
  id: string; kind: "insights" | "transcription"; provider: string;
  modelId: string; label: string; active: boolean; isDefault: boolean; sortOrder: number;
}

interface DiscoverProvider {
  provider: string; ok: boolean; error?: string;
  newModels: string[]; registeredCount: number; totalOffered: number;
}
interface DiscoverResult { generatedAt: string; providers: DiscoverProvider[] }

const rows = ref<ModelRow[]>([]);
const loading = ref(false);
const msg = ref("");
const discovery = ref<DiscoverResult | null>(null);
const discovering = ref(false);
const discOpen = ref(true);
const discNewTotal = computed(() =>
  (discovery.value?.providers ?? []).reduce((n, p) => n + (p.ok ? p.newModels.length : 0), 0),
);

function fmtTime(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}
const add = ref<{ kind: "insights" | "transcription"; provider: string; modelId: string; label: string }>({
  kind: "insights",
  provider: "openai",
  modelId: "",
  label: "",
});

const INSIGHTS_PROVIDERS = ["openai", "anthropic", "grok", "gemini"];
const TRANSCRIPTION_PROVIDERS = ["deepgram", "openai"];
function providersFor(kind: string) {
  return kind === "transcription" ? TRANSCRIPTION_PROVIDERS : INSIGHTS_PROVIDERS;
}

const groups = computed(() => {
  const byKind: Record<string, ModelRow[]> = {};
  for (const r of rows.value) (byKind[r.kind] ??= []).push(r);
  return (["insights", "transcription"] as const)
    .filter((k) => byKind[k]?.length)
    .map((kind) => {
      const byProv: Record<string, ModelRow[]> = {};
      for (const r of byKind[kind] ?? []) (byProv[r.provider] ??= []).push(r);
      return {
        kind,
        providers: Object.keys(byProv)
          .sort()
          .map((provider) => ({ provider, rows: (byProv[provider] ?? []).sort((a, b) => a.sortOrder - b.sortOrder) })),
      };
    });
});

async function load() {
  loading.value = true;
  try {
    rows.value = (await axios.get(ApiPath.Models)).data ?? [];
  } catch (e: any) {
    msg.value = e?.response?.data?.message || "Failed to load models";
  } finally {
    loading.value = false;
  }
}
async function addModel() {
  try {
    await axios.post(ApiPath.Models, { ...add.value });
    add.value.modelId = "";
    add.value.label = "";
    msg.value = "Model added.";
    await load();
  } catch (e: any) {
    msg.value = e?.response?.data?.message || "Add failed";
  }
}
async function toggleActive(r: ModelRow) {
  await axios.patch(`${ApiPath.Models}/${r.id}`, { active: !r.active });
  await load();
}
async function makeDefault(r: ModelRow) {
  await axios.patch(`${ApiPath.Models}/${r.id}/default`);
  msg.value = `Default set: ${r.provider} → ${r.label}.`;
  await load();
}
async function removeRow(r: ModelRow) {
  if (!window.confirm(`Delete "${r.label}" (${r.provider})?`)) return;
  await axios.delete(`${ApiPath.Models}/${r.id}`);
  await load();
}

async function discover() {
  discovering.value = true;
  discOpen.value = true;
  msg.value = "";
  try {
    discovery.value = (await axios.get(ApiPath.ModelsDiscover)).data;
  } catch (e: any) {
    msg.value = e?.response?.data?.message || "Discovery failed";
  } finally {
    discovering.value = false;
  }
}
async function addDiscovered(provider: string, modelId: string) {
  try {
    await axios.post(ApiPath.Models, { kind: "insights", provider, modelId, label: modelId });
    msg.value = `Added ${modelId} (${provider}).`;
    await Promise.all([load(), discover()]);
  } catch (e: any) {
    msg.value = e?.response?.data?.message || "Add failed";
  }
}

onMounted(load);
</script>

<style scoped>
.mr-root { padding: 4px 0; }
.mr-hero { margin-bottom: 14px; }
.mr-title { font-size: 20px; font-weight: 800; color: var(--ink); margin: 0; }
.mr-sub { font-size: 13px; color: var(--muted); margin: 4px 0 0; max-width: 720px; }
.mr-add { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.mr-prov { margin-bottom: 14px; }
.mr-prov-head { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--brand, #6366f1); margin-bottom: 6px; }
.mr-row { display: flex; align-items: center; gap: 10px; padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 3px; font-size: 13px; }
.mr-row--off { opacity: 0.5; }
.mr-star { border: none; background: transparent; cursor: pointer; font-size: 15px; color: var(--muted); line-height: 1; }
.mr-star--on { color: #f59e0b; }
.mr-label { flex: 1; color: var(--ink); }
.mr-model { font-size: 11px; color: var(--muted); }
.mr-actions { display: flex; gap: 4px; flex-shrink: 0; }
.mr-mini { border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 5px; cursor: pointer; }
.mr-mini--del { color: #dc2626; }

.tile-head--toggle { cursor: pointer; }
.mr-chev { color: var(--muted); flex-shrink: 0; transition: transform 0.15s; margin-left: 4px; }
.mr-chev--open { transform: rotate(180deg); }
.mr-disc-badge {
  font-size: 11px; font-weight: 700; margin-left: 8px; padding: 1px 8px; border-radius: 999px;
  background: color-mix(in srgb, var(--brand, #6366f1) 14%, transparent); color: var(--brand, #6366f1);
  vertical-align: middle;
}
.mr-ts { font-size: 11px; color: var(--muted); margin-bottom: 10px; }
.mr-disc { margin-bottom: 12px; }
.mr-disc-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.mr-disc-note { font-size: 12px; color: var(--muted); }
.mr-disc-note--new { color: #059669; font-weight: 700; }
.mr-disc-note--warn { color: #b45309; font-style: italic; }
.mr-disc-list { display: flex; flex-direction: column; gap: 3px; padding-left: 4px; }
.mr-disc-row { display: flex; align-items: center; gap: 10px; padding: 3px 0; }
.mr-disc-row .mr-model { flex: 1; }
</style>
