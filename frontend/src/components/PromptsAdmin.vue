<template>
  <div>
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <h1 class="hero-title">Prompts</h1>
          <div class="hero-subtitle">
            Manage the LLM prompt fragments used by the insights extraction pipeline.
          </div>
        </div>
        <div class="hero-right">
          <button class="btn help-btn" @click="helpOpen = true" title="How do prompt fragments work?">?</button>
          <button class="btn btn--primary" @click="startCreate">+ New fragment</button>
        </div>
      </div>
    </div>

    <div class="layout">
      <aside class="sidebar">
        <div class="search-row">
          <input
            v-model="search"
            class="input input--sm search-input"
            type="search"
            placeholder="Filter by label, key, campaign…"
          />
          <button
            v-if="search"
            class="search-clear"
            title="Clear filter"
            @click="search = ''"
          >
            &times;
          </button>
        </div>
        <div class="filter-row">
          <select v-model="filter.interactionType" class="input input--sm">
            <option value="">All types</option>
            <option value="call">Call</option>
            <option value="chat">Chat</option>
            <option value="shared">Shared</option>
          </select>
          <select v-model="filter.kind" class="input input--sm">
            <option value="">All kinds</option>
            <option v-for="k in kindOptions" :key="k" :value="k">{{ k }}</option>
          </select>
        </div>

        <div v-if="loading && !prompts.length" class="muted small">Loading…</div>
        <div v-else-if="filteredPrompts.length === 0" class="muted small">
          No prompts match those filters.
        </div>

        <ul class="list">
          <li
            v-for="p in filteredPrompts"
            :key="p.id"
            class="list-item"
            :class="{ 'list-item--active': selected?.id === p.id, 'list-item--inactive': !p.isActive }"
            @click="selectPrompt(p)"
          >
            <div class="list-item-label">{{ p.label }}</div>
            <div class="list-item-meta">
              <span class="chip">{{ p.interactionType }}</span>
              <span class="chip chip--muted">{{ p.kind }}</span>
              <span v-if="p.campaign" class="chip chip--campaign">{{ p.campaign }}</span>
              <span v-if="!p.isActive" class="chip chip--warn">inactive</span>
            </div>
            <div class="list-item-key muted small">{{ p.key }}</div>
          </li>
        </ul>
      </aside>

      <section class="editor">
        <div v-if="mode === 'empty'" class="empty-state">
          <div class="empty-icon"><FileText :size="44" :stroke-width="1.5" /></div>
          <div>Pick a prompt fragment on the left to edit, or create a new one.</div>
        </div>

        <div v-else class="editor-inner">
          <div class="editor-head">
            <div class="editor-title">
              <input
                v-model="editing.label"
                class="input input--lg"
                placeholder="Label"
              />
              <div class="editor-meta muted small">
                <span v-if="mode === 'edit' && selected">v{{ selected.version }} · last updated {{ formatDate(selected.updatedAt) }}</span>
                <span v-else>New fragment</span>
              </div>
            </div>
            <div class="editor-actions">
              <button v-if="mode === 'edit'" class="btn" @click="openHistory">History</button>
              <button v-if="mode === 'edit'" class="btn btn--ghost" @click="confirmDelete" :disabled="saving">Delete</button>
              <button class="btn" @click="cancel" :disabled="saving">Cancel</button>
              <button class="btn btn--primary" @click="save" :disabled="!canSave || saving">
                {{ saving ? "Saving…" : "Save" }}
              </button>
            </div>
          </div>

          <div class="field-grid">
            <div class="field">
              <label class="field-label">Key</label>
              <input
                v-model="editing.key"
                class="input"
                :readonly="mode === 'edit'"
                placeholder="e.g. call.campaign.MFS"
              />
            </div>
            <div class="field">
              <label class="field-label">Interaction type</label>
              <select v-model="editing.interactionType" class="input">
                <option value="call">call</option>
                <option value="chat">chat</option>
                <option value="shared">shared</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">Kind</label>
              <select v-model="editing.kind" class="input">
                <option v-for="k in kindOptions" :key="k" :value="k">{{ k }}</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">Campaign (optional)</label>
              <input v-model="editing.campaign" class="input" placeholder="e.g. MFS, RAC" />
            </div>
            <div class="field field--full">
              <label class="field-label">Notes</label>
              <input v-model="editing.notes" class="input" placeholder="Editor-facing notes (optional)" />
            </div>
            <div class="field field--full inline-toggle">
              <label class="field-label">Active</label>
              <label class="toggle">
                <input type="checkbox" v-model="editing.isActive" />
                <span>{{ editing.isActive ? "In use at runtime" : "Ignored at runtime" }}</span>
              </label>
            </div>
          </div>

          <div class="body-section">
            <div class="body-head">
              <label class="field-label">Body</label>
              <div class="muted small">
                <span>Supported placeholders:</span>
                <code v-for="ph in placeholderHints" :key="ph" class="ph-chip">{{ ph }}</code>
              </div>
            </div>
            <textarea
              v-model="editing.body"
              class="code-area"
              spellcheck="false"
              placeholder="Prompt body…"
            ></textarea>
          </div>

          <div class="preview-section">
            <div class="preview-head">
              <h3>Preview composed prompt</h3>
              <div class="preview-controls">
                <select v-model="previewType" class="input input--sm">
                  <option value="call">call</option>
                  <option value="chat">chat</option>
                </select>
                <input
                  v-model="previewCampaign"
                  class="input input--sm"
                  placeholder="campaign (optional)"
                />
                <button class="btn" @click="runPreview" :disabled="previewLoading">
                  {{ previewLoading ? "Composing…" : "Preview" }}
                </button>
              </div>
            </div>
            <pre v-if="previewOutput" class="preview-output">{{ previewOutput }}</pre>
            <div v-else class="muted small">Preview renders the full prompt as it will be sent to the model.</div>
          </div>
        </div>
      </section>
    </div>

    <div v-if="statusMsg" class="toast" :class="{ 'toast--error': !!error }">
      {{ statusMsg }}
    </div>

    <div v-if="historyOpen" class="modal-backdrop" @click.self="historyOpen = false">
      <div class="modal">
        <div class="modal-head">
          <h3>Version history — {{ selected?.label }}</h3>
          <button class="btn btn--ghost" @click="historyOpen = false">Close</button>
        </div>
        <div v-if="historyLoading" class="muted">Loading…</div>
        <div v-else-if="history.length === 0" class="muted">No previous versions saved.</div>
        <ul v-else class="history-list">
          <li v-for="h in history" :key="h.id" class="history-item">
            <div class="history-head">
              <strong>v{{ h.version }}</strong>
              <span class="muted small">{{ formatDate(h.createdAt) }}</span>
            </div>
            <pre class="history-body">{{ h.body }}</pre>
          </li>
        </ul>
      </div>
    </div>

    <div v-if="helpOpen" class="modal-backdrop" @click.self="helpOpen = false">
      <div class="modal modal--wide">
        <div class="modal-head">
          <h3>How prompt fragments work</h3>
          <button class="btn btn--ghost" @click="helpOpen = false">Close</button>
        </div>

        <div class="help-body">
          <section>
            <h4>The two halves</h4>
            <p>
              <strong>Base templates</strong> (<code>call.base</code>, <code>chat.base</code>)
              are the outer skeletons with named slots. They are the only fragments the
              composer reads directly.
            </p>
            <p>
              <strong>Everything else is a fragment</strong> that fills one of those slots.
              Which fragment fills which slot is decided at runtime based on the
              <code>campaign</code> attached to the transcript.
            </p>
          </section>

          <section>
            <h4>Call flow (simple)</h4>
            <p>
              <code>call.base</code> has one slot: <code v-pre>{{campaign_section}}</code>.
              When a call comes in, the composer fills that slot using this waterfall:
            </p>
            <pre class="help-block" v-pre>campaign is null or "unknown"
    → call.campaign.unknown         (detect from transcript)

campaign is "MFS"                   → call.campaign.MFS
campaign is "MFS_EOC"               → call.campaign.MFS_EOC
campaign is "NMGB_AO"               → call.campaign.NMGB_AO
campaign is "Winback"               → call.campaign.Winback
campaign is "FPI"                   → call.campaign.FPI

campaign is anything else (e.g. "Foo")
    → call.campaign.default         (no specific compliance check;
                                     {{campaign}} substituted to "Foo")</pre>
            <p>
              The lookup is literally <code>call.campaign.{campaign}</code> by key, falling
              back to <code>call.campaign.default</code> if that key doesn't exist. To add
              a new campaign, just create a fragment with key
              <code>call.campaign.&lt;NewCampaign&gt;</code> — the composer will pick it up
              automatically.
            </p>
          </section>

          <section>
            <h4>Chat flow (where the RAC fragments come in)</h4>
            <p><code>chat.base</code> has more slots:</p>
            <pre class="help-block" v-pre>{{campaign_line}}           text snippet ("Campaign context: X")
{{operations_section}}      always ← chat.operations.default
{{operations_schema}}       always ← chat.operations_schema.default
{{opportunity_section}}     RAC-only
{{qa_section}}              RAC-only
{{qa_schema}}               RAC-only
{{objection_section}}       RAC-only
{{objection_schema}}        RAC-only</pre>
            <p>
              The RAC slots are only filled when the campaign name matches the regex
              <code>/rac/i</code> — so "RAC", "RAC_Winback", "rac-anything" all qualify.
              When matched, the composer pulls:
            </p>
            <ul>
              <li><code>chat.rac.opportunity</code> → <code v-pre>{{opportunity_section}}</code></li>
              <li><code>chat.rac.qa</code> → <code v-pre>{{qa_section}}</code></li>
              <li><code>chat.rac.qa_schema</code> → <code v-pre>{{qa_schema}}</code></li>
              <li><code>chat.rac.objection</code> → <code v-pre>{{objection_section}}</code></li>
              <li><code>chat.rac.objection_schema</code> → <code v-pre>{{objection_schema}}</code></li>
            </ul>
            <p>
              For any <em>non-RAC</em> chat campaign (say "MFS"), those five slots render
              as empty strings — the chat prompt for MFS is the base template with only
              <code v-pre>{{campaign_line}}</code>, <code v-pre>{{operations_section}}</code>
              and <code v-pre>{{operations_schema}}</code> filled in.
            </p>
          </section>

          <section>
            <h4>Two concrete traces</h4>
            <p><strong>Chat, campaign = "RAC":</strong></p>
            <pre class="help-block" v-pre>chat.base
  ├─ {{campaign_line}}        → "Campaign context: RAC"
  ├─ {{opportunity_section}}  → chat.rac.opportunity.body
  ├─ {{operations_section}}   → chat.operations.default.body
  ├─ {{qa_section}}           → chat.rac.qa.body
  ├─ {{objection_section}}    → chat.rac.objection.body
  ├─ {{operations_schema}}    → chat.operations_schema.default.body
  ├─ {{qa_schema}}            → "," + chat.rac.qa_schema.body
  ├─ {{objection_schema}}     → "," + chat.rac.objection_schema.body
  └─ {{transcript}}           → &lt;the actual chat text&gt;</pre>

            <p><strong>Same transcript, campaign = "MFS" (or any non-RAC):</strong></p>
            <pre class="help-block" v-pre>chat.base
  ├─ {{campaign_line}}        → "Campaign context: MFS"
  ├─ {{opportunity_section}}  → ""
  ├─ {{operations_section}}   → chat.operations.default.body
  ├─ {{qa_section}}           → ""
  ├─ {{objection_section}}    → ""
  ├─ {{operations_schema}}    → chat.operations_schema.default.body
  ├─ {{qa_schema}}            → ""
  ├─ {{objection_schema}}     → ""
  └─ {{transcript}}           → &lt;the actual chat text&gt;</pre>
          </section>

          <section>
            <h4>Why <code>chat.rac.*</code> isn't a simple key match</h4>
            <p>
              For calls, the composer just does <code>call.campaign.{campaign}</code> — pure
              string match on the key, so you can add campaigns without touching code.
            </p>
            <p>
              For chat, the RAC variant adds <em>multiple</em> sections (opportunity + QA +
              objection), each slotting into a different placeholder. There's no "one key
              per campaign" scheme that would work. So the composer hard-codes the rule
              "if campaign looks like RAC, pull these five specific keys into these five
              specific slots."
            </p>
            <p>
              If you need a new chat variant (e.g. "Jardine" with its own QA), that's a
              one-line change in the composer — reach out to a developer for that.
            </p>
          </section>

          <section>
            <h4>Seeing it in action</h4>
            <p>
              The quickest way to build intuition: open any fragment, scroll to the
              <strong>Preview composed prompt</strong> section at the bottom, pick an
              interaction type + campaign, and hit <strong>Preview</strong>. The backend
              runs the exact composer described above and shows the final string that
              would be sent to the model.
            </p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FileText } from "lucide-vue-next";
import { computed, onMounted, reactive, ref, watch } from "vue";
import {
  createPrompt,
  deletePrompt,
  getPromptHistory,
  listPrompts,
  previewPrompt,
  updatePrompt,
  type PromptHistoryRow,
  type PromptInteractionType,
  type PromptKind,
  type PromptTemplate,
} from "@/services/prompts.service";

const placeholderHints: string[] = [
  "{{transcript}}",
  "{{campaign}}",
  "{{campaign_section}}",
  "{{campaign_line}}",
  "{{operations_section}}",
  "{{operations_schema}}",
  "{{opportunity_section}}",
  "{{qa_section}}",
  "{{qa_schema}}",
  "{{objection_section}}",
  "{{objection_schema}}",
];

const kindOptions: PromptKind[] = [
  "base",
  "campaign_section",
  "opportunity_section",
  "operations_section",
  "operations_schema",
  "qa_section",
  "qa_schema",
  "objection_section",
  "objection_schema",
  "other",
];

const prompts = ref<PromptTemplate[]>([]);
const selected = ref<PromptTemplate | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref(false);
const statusMsg = ref("");

type Mode = "empty" | "edit" | "create";
const mode = ref<Mode>("empty");

const filter = reactive<{ interactionType: "" | PromptInteractionType; kind: "" | PromptKind }>({
  interactionType: "",
  kind: "",
});

const editing = reactive({
  key: "",
  interactionType: "call" as PromptInteractionType,
  kind: "other" as PromptKind,
  campaign: "" as string,
  label: "",
  notes: "" as string,
  body: "",
  isActive: true,
});

const previewType = ref<"call" | "chat">("call");
const previewCampaign = ref("");
const previewOutput = ref("");
const previewLoading = ref(false);

const historyOpen = ref(false);
const history = ref<PromptHistoryRow[]>([]);
const historyLoading = ref(false);

const helpOpen = ref(false);

const search = ref("");

// Client-side text filter over the (server-filtered) list. Matches against
// label, key, campaign and kind so the user can quickly find a fragment.
const filteredPrompts = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return prompts.value;
  return prompts.value.filter((p) =>
    [p.label, p.key, p.campaign ?? "", p.kind]
      .join(" ")
      .toLowerCase()
      .includes(q)
  );
});

const canSave = computed(() => {
  return (
    editing.key.trim().length > 0 &&
    editing.label.trim().length > 0 &&
    editing.body.length > 0
  );
});

onMounted(load);

watch(
  () => [filter.interactionType, filter.kind],
  () => load(),
);

async function load() {
  loading.value = true;
  try {
    prompts.value = await listPrompts({
      interactionType: filter.interactionType || undefined,
      kind: filter.kind || undefined,
    });
  } catch (e: any) {
    showError(e?.response?.data?.message ?? "Could not load prompts");
  } finally {
    loading.value = false;
  }
}

function selectPrompt(p: PromptTemplate) {
  selected.value = p;
  mode.value = "edit";
  editing.key = p.key;
  editing.interactionType = p.interactionType;
  editing.kind = p.kind;
  editing.campaign = p.campaign ?? "";
  editing.label = p.label;
  editing.notes = p.notes ?? "";
  editing.body = p.body;
  editing.isActive = p.isActive;
  previewOutput.value = "";
  previewCampaign.value = p.campaign ?? "";
  previewType.value = p.interactionType === "chat" ? "chat" : "call";
}

function startCreate() {
  selected.value = null;
  mode.value = "create";
  editing.key = "";
  editing.interactionType = "call";
  editing.kind = "other";
  editing.campaign = "";
  editing.label = "";
  editing.notes = "";
  editing.body = "";
  editing.isActive = true;
  previewOutput.value = "";
}

function cancel() {
  if (selected.value) selectPrompt(selected.value);
  else {
    mode.value = "empty";
    previewOutput.value = "";
  }
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    const payload = {
      interactionType: editing.interactionType,
      kind: editing.kind,
      campaign: editing.campaign.trim() || null,
      label: editing.label.trim(),
      notes: editing.notes.trim() || null,
      body: editing.body,
      isActive: editing.isActive,
    };

    if (mode.value === "create") {
      const created = await createPrompt({ key: editing.key.trim(), ...payload });
      await load();
      const newRow = prompts.value.find((r) => r.id === created.id) ?? created;
      selectPrompt(newRow);
      showSuccess("Prompt fragment created");
    } else if (selected.value) {
      const updated = await updatePrompt(selected.value.id, payload);
      await load();
      const refreshed = prompts.value.find((r) => r.id === updated.id) ?? updated;
      selectPrompt(refreshed);
      showSuccess("Saved");
    }
  } catch (e: any) {
    showError(e?.response?.data?.message ?? "Save failed");
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!selected.value) return;
  if (!confirm(`Delete prompt "${selected.value.label}"? This cannot be undone.`)) return;
  try {
    await deletePrompt(selected.value.id);
    selected.value = null;
    mode.value = "empty";
    await load();
    showSuccess("Deleted");
  } catch (e: any) {
    showError(e?.response?.data?.message ?? "Delete failed");
  }
}

async function runPreview() {
  previewLoading.value = true;
  try {
    const { body } = await previewPrompt({
      interactionType: previewType.value,
      campaign: previewCampaign.value.trim() || null,
    });
    previewOutput.value = body;
  } catch (e: any) {
    showError(e?.response?.data?.message ?? "Preview failed");
  } finally {
    previewLoading.value = false;
  }
}

async function openHistory() {
  if (!selected.value) return;
  historyOpen.value = true;
  historyLoading.value = true;
  try {
    history.value = await getPromptHistory(selected.value.id);
  } catch (e: any) {
    showError(e?.response?.data?.message ?? "Could not load history");
  } finally {
    historyLoading.value = false;
  }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function showSuccess(msg: string) {
  error.value = false;
  statusMsg.value = msg;
  setTimeout(() => (statusMsg.value = ""), 2500);
}

function showError(msg: string) {
  error.value = true;
  statusMsg.value = msg;
  setTimeout(() => (statusMsg.value = ""), 4000);
}
</script>

<style scoped>
.hero {
  margin-bottom: 16px;
}
.hero-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
}
.hero-title {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 800;
  color: #122033;
}
.hero-subtitle {
  font-size: 0.85rem;
  color: #64748b;
  margin-top: 4px;
}

.layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
  align-items: start;
}

.sidebar {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
  max-height: calc(100vh - 220px);
  overflow-y: auto;
  position: sticky;
  top: 16px;
}

.search-row {
  position: relative;
  margin-bottom: 6px;
}
.search-input {
  width: 100%;
}
.search-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
}
.search-clear:hover {
  color: #475569;
}

.filter-row {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.list-item {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: white;
  padding: 10px;
  cursor: pointer;
  transition: border-color 0.1s, background 0.1s;
}
.list-item:hover {
  border-color: #94a3b8;
}
.list-item--active {
  border-color: #2b6cb0;
  background: #eff6ff;
}
.list-item--inactive {
  opacity: 0.7;
}
.list-item-label {
  font-weight: 600;
  font-size: 0.9rem;
  color: #122033;
}
.list-item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.list-item-key {
  margin-top: 4px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.72rem;
}

.chip {
  display: inline-block;
  background: #2b6cb0;
  color: white;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.7rem;
  font-weight: 600;
}
.chip--muted {
  background: #e2e8f0;
  color: #334155;
}
.chip--campaign {
  background: #f59e0b;
  color: white;
}
.chip--warn {
  background: #dc2626;
}

.editor {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  min-height: 400px;
}
.empty-state {
  padding: 64px 24px;
  text-align: center;
  color: #64748b;
}
.empty-icon {
  font-size: 2rem;
  margin-bottom: 12px;
}

.editor-inner {
  padding: 16px;
}
.editor-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  padding-bottom: 12px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 12px;
}
.editor-title {
  flex: 1;
}
.editor-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.editor-meta {
  margin-top: 4px;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field--full {
  grid-column: 1 / -1;
}
.inline-toggle {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
.field-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.input {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 0.88rem;
  font-family: inherit;
  background: white;
}
.input:focus {
  outline: none;
  border-color: #2b6cb0;
}
.input--sm {
  padding: 4px 8px;
  font-size: 0.82rem;
}
.input--lg {
  font-size: 1.1rem;
  font-weight: 700;
  padding: 8px 10px;
}
.input[readonly] {
  background: #f1f5f9;
  color: #475569;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85rem;
  color: #334155;
}

.body-section,
.preview-section {
  margin-top: 14px;
}
.body-head,
.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  gap: 12px;
}
.code-area {
  width: 100%;
  min-height: 420px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 10px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.45;
  resize: vertical;
  background: #fafbfc;
}

.preview-section {
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
}
.preview-head h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: #122033;
}
.preview-controls {
  display: flex;
  gap: 6px;
}
.preview-output {
  background: #0f172a;
  color: #f1f5f9;
  padding: 12px;
  border-radius: 8px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  max-height: 500px;
  overflow: auto;
  white-space: pre-wrap;
}

.btn {
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: white;
  padding: 7px 12px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.btn:hover {
  background: #f1f5f9;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn--primary {
  background: linear-gradient(135deg, #1a3a5c, #2b6cb0);
  color: white;
  border-color: transparent;
}
.btn--primary:hover {
  filter: brightness(1.05);
  background: linear-gradient(135deg, #1a3a5c, #2b6cb0);
}
.btn--ghost {
  background: transparent;
  color: #dc2626;
  border-color: #fca5a5;
}
.btn--ghost:hover {
  background: #fef2f2;
}

.ph-chip {
  display: inline-block;
  background: #eef2f7;
  color: #334155;
  border-radius: 4px;
  padding: 1px 6px;
  margin: 2px 4px 0 0;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.72rem;
}
.muted {
  color: #64748b;
}
.small {
  font-size: 0.78rem;
}

.toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  padding: 10px 16px;
  background: #122033;
  color: white;
  border-radius: 10px;
  font-size: 0.88rem;
  font-weight: 600;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.2);
  z-index: 200;
}
.toast--error {
  background: #b91c1c;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: grid;
  place-items: center;
  z-index: 300;
}
.modal {
  background: white;
  border-radius: 12px;
  width: min(900px, 90vw);
  max-height: 85vh;
  overflow-y: auto;
  padding: 18px;
}
.modal--wide {
  width: min(1000px, 94vw);
}

.help-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  border-radius: 50%;
  font-weight: 700;
  color: #2b6cb0;
}

.help-body {
  line-height: 1.55;
  color: #1f2937;
  font-size: 0.9rem;
}
.help-body section {
  margin-bottom: 18px;
}
.help-body h4 {
  margin: 18px 0 6px;
  font-size: 1rem;
  color: #122033;
}
.help-body section:first-child h4 {
  margin-top: 0;
}
.help-body p {
  margin: 6px 0;
}
.help-body ul {
  margin: 6px 0 6px 18px;
  padding: 0;
}
.help-body li {
  margin: 3px 0;
}
.help-body code {
  background: #eef2f7;
  color: #334155;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.8rem;
}
.help-block {
  background: #0f172a;
  color: #e2e8f0;
  padding: 12px 14px;
  border-radius: 8px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  overflow-x: auto;
  margin: 8px 0;
  white-space: pre;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.history-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.history-item {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px;
}
.history-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
}
.history-body {
  background: #f8fafc;
  padding: 8px;
  border-radius: 6px;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.75rem;
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  margin: 0;
}
</style>
