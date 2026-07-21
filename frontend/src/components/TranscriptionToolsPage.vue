<template>
  <div class="tt-root">
    <div class="tt-hero">
      <h2 class="tt-title">Transcription Tools</h2>
      <p class="tt-sub">Tune and monitor speech-to-text: edit the vehicle vocabulary, embed transcripts for semantic search, and review low-confidence calls.</p>
    </div>

    <!-- Vehicle vocabulary editor -->
    <div class="tile">
      <div class="tile-head">
        <div class="tile-icon">&#128663;</div>
        <div class="tile-text">
          <div class="tile-title">Vehicle Vocabulary</div>
          <div class="tile-desc">Bias transcription toward makes/models (keyterms) and auto-correct known mishears (replacements). Edited live — no software update needed.</div>
        </div>
        <div class="spacer" />
        <button class="btn btn--ghost btn--sm" :disabled="loadingVocab" @click="loadVocab">{{ loadingVocab ? "…" : "Refresh" }}</button>
      </div>
      <div class="tile-body">
        <div v-if="vocabMsg" class="chip chip--primary" style="margin-bottom: 10px">{{ vocabMsg }}</div>
        <div class="tt-vocab-cols">
          <!-- Keyterms -->
          <div class="tt-vocab-col">
            <div class="tt-vocab-head">Keyterms <span class="hint">({{ keyterms.length }})</span></div>
            <div class="tt-add-row">
              <input v-model="newKeyterm" class="select" placeholder="e.g. Qashqai" @keydown.enter="addKeyterm" />
              <button class="btn btn--primary btn--sm" :disabled="!newKeyterm.trim()" @click="addKeyterm">Add</button>
            </div>
            <div class="tt-vocab-list">
              <div v-for="r in keyterms" :key="r.id" class="tt-vocab-item" :class="{ 'tt-vocab-item--off': !r.active }">
                <span class="tt-vocab-term">{{ r.term }}</span>
                <div class="tt-vocab-actions">
                  <button class="tt-mini" :title="r.active ? 'Disable' : 'Enable'" @click="toggleActive(r)">{{ r.active ? "on" : "off" }}</button>
                  <button class="tt-mini tt-mini--del" title="Delete" @click="removeRow(r)">&times;</button>
                </div>
              </div>
              <div v-if="!keyterms.length" class="hint">None.</div>
            </div>
          </div>

          <!-- Replacements -->
          <div class="tt-vocab-col">
            <div class="tt-vocab-head">Replacements <span class="hint">({{ replacements.length }})</span></div>
            <div class="tt-add-row">
              <input v-model="newReplFrom" class="select" placeholder="heard e.g. Duke" @keydown.enter="addReplacement" />
              <span class="tt-arrow">&#8594;</span>
              <input v-model="newReplTo" class="select" placeholder="fix e.g. Juke" @keydown.enter="addReplacement" />
              <button class="btn btn--primary btn--sm" :disabled="!newReplFrom.trim() || !newReplTo.trim()" @click="addReplacement">Add</button>
            </div>
            <div class="tt-vocab-list">
              <div v-for="r in replacements" :key="r.id" class="tt-vocab-item" :class="{ 'tt-vocab-item--off': !r.active }">
                <span class="tt-vocab-term">{{ r.term }} <span class="tt-arrow">&#8594;</span> {{ r.replaceWith }}</span>
                <div class="tt-vocab-actions">
                  <button class="tt-mini" :title="r.active ? 'Disable' : 'Enable'" @click="toggleActive(r)">{{ r.active ? "on" : "off" }}</button>
                  <button class="tt-mini tt-mini--del" title="Delete" @click="removeRow(r)">&times;</button>
                </div>
              </div>
              <div v-if="!replacements.length" class="hint">None.</div>
            </div>
          </div>
        </div>
        <p class="hint" style="margin-top: 10px">Changes apply to new transcriptions within a minute. Add cautiously — a bad replacement rewrites legitimate words. Re-transcribe affected calls to benefit.</p>
      </div>
    </div>

    <!-- Embed transcripts -->
    <div class="tile" style="margin-top: 14px">
      <div class="tile-head">
        <div class="tile-icon">&#129517;</div>
        <div class="tile-text">
          <div class="tile-title">Semantic Search — Embed Transcripts</div>
          <div class="tile-desc">Generate meaning vectors so transcripts are searchable by phrase (Find record → Meaning). Cheap; run repeatedly to clear the backlog.</div>
        </div>
      </div>
      <div class="tile-body">
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap">
          <label class="label">Batch size</label>
          <select v-model.number="embedLimit" class="select" style="max-width: 120px">
            <option :value="100">100</option>
            <option :value="200">200</option>
            <option :value="500">500</option>
          </select>
          <button class="btn btn--primary" :disabled="embedding" @click="runEmbed">{{ embedding ? "Embedding…" : `Embed next ${embedLimit}` }}</button>
          <button class="btn btn--ghost btn--sm" @click="loadEmbedStatus">Refresh</button>
          <span v-if="embedStatus" class="chip chip--primary">{{ embedStatus }}</span>
        </div>
        <div v-if="embedCoverage" style="margin-top: 12px; max-width: 420px">
          <div class="hint">
            <strong>{{ embedCoverage.embedded }}</strong> of
            <strong>{{ embedCoverage.embedded + embedCoverage.remaining }}</strong>
            transcripts embedded ({{ embedPct }}%) · <strong>{{ embedCoverage.remaining }}</strong> remaining
          </div>
          <div class="tt-bar"><div class="tt-bar-fill" :style="{ width: embedPct + '%' }" /></div>
        </div>
      </div>
    </div>

    <!-- Vocabulary suggestions -->
    <div class="tile" style="margin-top: 14px">
      <div class="tile-head">
        <div class="tile-icon">&#128257;</div>
        <div class="tile-text">
          <div class="tile-title">Transcription Vocabulary Suggestions</div>
          <div class="tile-desc">Words Deepgram was least sure about, mined from transcripts — candidates to add to the keyterms above.</div>
        </div>
      </div>
      <div class="tile-body">
        <div style="margin-bottom: 12px"><LowConfidenceHelp /></div>
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px">
          <label class="label">Window (days)</label>
          <select v-model.number="keytermDays" class="select" style="max-width: 140px">
            <option :value="30">30</option>
            <option :value="90">90</option>
            <option :value="180">180</option>
            <option :value="365">365 (1 yr)</option>
            <option :value="730">730 (2 yrs)</option>
          </select>
          <button class="btn btn--primary" :disabled="loadingKeyterms" @click="loadKeytermSuggestions">{{ loadingKeyterms ? "Analysing…" : "Analyse transcripts" }}</button>
        </div>
        <div v-if="keytermData">
          <div class="hint" style="margin-bottom: 8px">{{ keytermData.analysed }} transcript(s) with low-confidence words analysed · {{ keytermData.distinctTerms }} distinct new terms.</div>
          <table v-if="keytermData.suggestions.length" class="tt-table">
            <thead><tr><th>Term</th><th class="num">Calls</th><th class="num">Occurrences</th><th class="num">Min conf</th><th class="num">Avg conf</th><th></th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in keytermData.suggestions" :key="i">
                <td><span class="mono">{{ s.word }}</span></td>
                <td class="num">{{ s.calls }}</td>
                <td class="num">{{ s.occurrences }}</td>
                <td class="num">{{ Math.round(s.minConfidence * 100) }}%</td>
                <td class="num">{{ Math.round(s.avgConfidence * 100) }}%</td>
                <td class="num"><button class="tt-mini" title="Add as keyterm" @click="addSuggestedKeyterm(s.word)">+ keyterm</button></td>
              </tr>
            </tbody>
          </table>
          <div v-else class="hint">No new low-confidence terms in this window.</div>
        </div>
        <div v-else class="hint">Click Analyse to mine recent transcripts for shaky terms.</div>
      </div>
    </div>

    <!-- Lowest-confidence review -->
    <div class="tile" style="margin-top: 14px">
      <div class="tile-head">
        <div class="tile-icon">&#127911;</div>
        <div class="tile-text">
          <div class="tile-title">Review: Lowest-Confidence Transcripts</div>
          <div class="tile-desc">Calls the transcription AI was least sure about — ranked worst first. Click a row to open the transcript.</div>
        </div>
        <div class="spacer" />
        <button class="btn btn--ghost btn--sm" :disabled="loadingLowConf" @click="loadLowConfidence">{{ loadingLowConf ? "Loading…" : "Refresh" }}</button>
      </div>
      <div class="tile-body">
        <div style="margin-bottom: 12px"><LowConfidenceHelp /></div>
        <div v-if="!lowConfList.length && !loadingLowConf && !lowConfLoaded">
          <button class="btn btn--primary" @click="loadLowConfidence">Load lowest-confidence transcripts</button>
          <span class="hint" style="margin-left: 10px">Only Deepgram transcripts report confidence.</span>
        </div>
        <div v-else-if="!lowConfList.length && !loadingLowConf && lowConfLoaded" class="hint" style="line-height: 1.5">
          No transcripts have a confidence score yet — captured only for Deepgram transcripts made after the confidence migration, so existing ones read null until re-transcribed.
        </div>
        <table v-if="lowConfList.length" class="tt-table">
          <thead><tr><th class="num">Confidence</th><th class="num">Shaky terms</th><th>Campaign</th><th>Date</th><th>Snippet</th></tr></thead>
          <tbody>
            <tr v-for="r in lowConfList" :key="r.id" class="tt-row-click" @click="reviewDrawerId = r.id">
              <td class="num"><span class="chip" :class="confClass(r.confidence)" style="font-size: 11px">{{ Math.round((r.confidence ?? 0) * 100) }}%</span></td>
              <td class="num">{{ r.lowConfidenceCount }}</td>
              <td>{{ r.campaign || "—" }}</td>
              <td>{{ fmtDate(r.date) }}</td>
              <td style="max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted)">{{ r.snippet }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <InteractionDetailDrawer :recording-id="reviewDrawerId" @close="reviewDrawerId = null" />
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref } from "vue";
import { RecordingPath } from "@/enums/recording-paths";
import InteractionDetailDrawer from "./InteractionDetailDrawer.vue";
import LowConfidenceHelp from "./LowConfidenceHelp.vue";

const VOCAB_PATH = "/uiapi/transcription/vocab";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

// ── Vocabulary editor ───────────────────────────────────────────────────────
interface VocabRow { id: string; kind: "keyterm" | "replacement"; term: string; replaceWith: string | null; active: boolean }
const vocab = ref<VocabRow[]>([]);
const loadingVocab = ref(false);
const vocabMsg = ref("");
const newKeyterm = ref("");
const newReplFrom = ref("");
const newReplTo = ref("");
const keyterms = computed(() => vocab.value.filter((r) => r.kind === "keyterm"));
const replacements = computed(() => vocab.value.filter((r) => r.kind === "replacement"));

async function loadVocab() {
  loadingVocab.value = true;
  try {
    vocab.value = (await axios.get(VOCAB_PATH)).data ?? [];
  } catch (e: any) {
    vocabMsg.value = e?.response?.data?.message || "Failed to load vocabulary";
  } finally {
    loadingVocab.value = false;
  }
}
async function addKeyterm() {
  const term = newKeyterm.value.trim();
  if (!term) return;
  await axios.post(VOCAB_PATH, { kind: "keyterm", term });
  newKeyterm.value = "";
  await loadVocab();
}
async function addSuggestedKeyterm(term: string) {
  await axios.post(VOCAB_PATH, { kind: "keyterm", term });
  vocabMsg.value = `Added "${term}" to keyterms.`;
  await loadVocab();
}
async function addReplacement() {
  const term = newReplFrom.value.trim();
  const replaceWith = newReplTo.value.trim();
  if (!term || !replaceWith) return;
  await axios.post(VOCAB_PATH, { kind: "replacement", term, replaceWith });
  newReplFrom.value = "";
  newReplTo.value = "";
  await loadVocab();
}
async function toggleActive(r: VocabRow) {
  await axios.patch(`${VOCAB_PATH}/${r.id}`, { active: !r.active });
  await loadVocab();
}
async function removeRow(r: VocabRow) {
  if (!window.confirm(`Delete "${r.term}"${r.replaceWith ? " → " + r.replaceWith : ""}?`)) return;
  await axios.delete(`${VOCAB_PATH}/${r.id}`);
  await loadVocab();
}

// ── Embed transcripts ───────────────────────────────────────────────────────
const embedding = ref(false);
const embedLimit = ref(200);
const embedStatus = ref("");
const embedCoverage = ref<{ embedded: number; remaining: number; total: number } | null>(null);
const embedPct = computed(() => {
  const c = embedCoverage.value;
  if (!c) return 0;
  const denom = c.embedded + c.remaining;
  return denom ? Math.round((c.embedded / denom) * 100) : 0;
});
async function loadEmbedStatus() {
  try { embedCoverage.value = (await axios.get(RecordingPath.embedStatus)).data; } catch { /* ignore */ }
}
async function runEmbed() {
  embedding.value = true;
  embedStatus.value = "";
  try {
    const d = (await axios.post(RecordingPath.batchEmbed, null, { params: { limit: embedLimit.value } })).data ?? {};
    embedStatus.value = `Embedded ${d.embedded ?? 0} (${d.remaining ?? 0} remaining) via ${d.model ?? "?"}.`;
    await loadEmbedStatus();
  } catch (e: any) {
    embedStatus.value = e?.response?.data?.message || e?.message || "Embed failed";
  } finally {
    embedding.value = false;
  }
}

// ── Vocabulary suggestions ──────────────────────────────────────────────────
const keytermData = ref<any>(null);
const loadingKeyterms = ref(false);
const keytermDays = ref(90);
async function loadKeytermSuggestions() {
  loadingKeyterms.value = true;
  try {
    keytermData.value = (await axios.get(RecordingPath.keytermSuggestions, { params: { days: keytermDays.value, limit: 40 } })).data;
  } catch { /* ignore */ } finally { loadingKeyterms.value = false; }
}

// ── Lowest-confidence review ────────────────────────────────────────────────
const lowConfList = ref<any[]>([]);
const loadingLowConf = ref(false);
const lowConfLoaded = ref(false);
const reviewDrawerId = ref<string | null>(null);
function confClass(c: number) {
  const p = Math.round((c ?? 0) * 100);
  if (p >= 90) return "chip--success";
  if (p >= 75) return "chip--warning";
  return "chip--danger";
}
async function loadLowConfidence() {
  loadingLowConf.value = true;
  try {
    lowConfList.value = (await axios.get(RecordingPath.lowConfidence, { params: { limit: 50 } })).data ?? [];
    lowConfLoaded.value = true;
  } catch { /* ignore */ } finally { loadingLowConf.value = false; }
}

onMounted(() => {
  loadVocab();
  loadEmbedStatus();
});
</script>

<style scoped>
.tt-root { padding: 4px 0; }
.tt-hero { margin-bottom: 14px; }
.tt-title { font-size: 20px; font-weight: 800; color: var(--ink); margin: 0; }
.tt-sub { font-size: 13px; color: var(--muted); margin: 4px 0 0; max-width: 720px; }

.tt-vocab-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
@media (max-width: 800px) { .tt-vocab-cols { grid-template-columns: 1fr; } }
.tt-vocab-head { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: var(--brand, #6366f1); margin-bottom: 8px; }
.tt-add-row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
.tt-add-row .select { flex: 1; min-width: 60px; }
.tt-arrow { color: var(--muted); }
.tt-vocab-list { display: flex; flex-direction: column; gap: 3px; max-height: 320px; overflow-y: auto; }
.tt-vocab-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.tt-vocab-item--off { opacity: 0.5; }
.tt-vocab-term { color: var(--ink); }
.tt-vocab-actions { display: flex; gap: 4px; flex-shrink: 0; }
.tt-mini { border: 1px solid var(--border); background: transparent; color: var(--muted); font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 5px; cursor: pointer; }
.tt-mini:hover { background: var(--surface-soft, rgba(0,0,0,0.04)); }
.tt-mini--del { color: #dc2626; }

.tt-bar { height: 8px; background: var(--surface-2, #e0e0e0); border-radius: 4px; overflow: hidden; margin-top: 5px; }
.tt-bar-fill { height: 100%; background: #6366f1; transition: width 0.4s; }

.tt-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.tt-table th, .tt-table td { padding: 5px 8px; border-bottom: 1px solid var(--border); text-align: left; }
.tt-table th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); font-weight: 700; }
.tt-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.tt-row-click { cursor: pointer; }
.tt-row-click:hover { background: var(--surface-soft, rgba(99,102,241,0.06)); }
</style>
