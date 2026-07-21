<template>
  <div class="mr-root">
    <div class="mr-hero">
      <h2 class="mr-title">Model Registry</h2>
      <p class="mr-sub">The models offered in the insights/narrative dropdowns and the active transcription model — editable here, no deploy needed. Changes apply within a minute.</p>
    </div>

    <div v-if="msg" class="chip chip--primary" style="margin-bottom: 12px">{{ msg }}</div>

    <!-- Add -->
    <div class="tile">
      <div class="tile-head">
        <div class="tile-icon">&#43;</div>
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
        <div class="tile-icon">{{ grp.kind === 'transcription' ? '&#127908;' : '&#129504;' }}</div>
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
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { ApiPath } from "@/enums/api";

interface ModelRow {
  id: string; kind: "insights" | "transcription"; provider: string;
  modelId: string; label: string; active: boolean; isDefault: boolean; sortOrder: number;
}

const rows = ref<ModelRow[]>([]);
const loading = ref(false);
const msg = ref("");
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
</style>
