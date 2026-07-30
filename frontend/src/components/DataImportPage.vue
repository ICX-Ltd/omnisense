<template>
  <div class="page">
    <div class="hero">
      <div class="hero-row">
        <div>
          <h2 class="hero-title">Data Import</h2>
          <div class="hero-subtitle">
            Load a third-party interaction export into staging, check it, then
            promote it into the app. Nothing reaches the live tables until you
            promote.
          </div>
        </div>
        <button class="btn btn--ghost" @click="refreshAll" :disabled="loading">
          {{ loading ? "Loading…" : "Refresh" }}
        </button>
      </div>
    </div>

    <div v-if="errorMsg" class="error-tile">
      <div class="error-title">Something went wrong</div>
      <div class="error-text">{{ errorMsg }}</div>
    </div>

    <div v-if="statusMsg" class="run-msg">{{ statusMsg }}</div>

    <!-- ─── run detail takes over the page when a run is open ─────────────── -->
    <DataImportRunDetail
      v-if="openRunId"
      :run-id="openRunId"
      @close="closeRun"
      @changed="loadRuns"
    />

    <template v-else>
      <!-- ─── intake ──────────────────────────────────────────────────────── -->
      <div class="grid">
        <div class="tile tile--accent">
          <div class="tile-head">
            <IconChip name="add" />
            <div class="tile-text">
              <div class="tile-title">Server folder</div>
              <div class="tile-desc">
                The intended path for the real monthly export — the file streams
                straight from disk, so size is not a constraint.
              </div>
            </div>
          </div>
          <div class="tile-body">
            <div v-if="serverFilesError" class="hint hint--warn">
              {{ serverFilesError }}
            </div>
            <template v-else>
              <div v-if="!serverFiles.length" class="hint">
                No .csv, .tsv or .txt files in the import inbox.
              </div>
              <div v-for="f in serverFiles" :key="f.name" class="list-row">
                <div class="file-meta">
                  <div class="mono file-name">{{ f.name }}</div>
                  <div class="hint">
                    {{ prettyBytes(f.sizeBytes) }} · {{ fmtDate(f.modifiedAt) }}
                  </div>
                </div>
                <div class="actions-row">
                  <button
                    class="btn btn--ghost btn--sm"
                    @click="doPreviewServer(f.name)"
                    :disabled="busy"
                  >
                    Preview
                  </button>
                  <button
                    class="btn btn--primary btn--sm"
                    @click="doStageServer(f.name)"
                    :disabled="busy"
                  >
                    Stage
                  </button>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div class="tile">
          <div class="tile-head">
            <IconChip name="analysis" />
            <div class="tile-text">
              <div class="tile-title">Upload a file</div>
              <div class="tile-desc">
                For samples and one-offs. Large exports are better placed in the
                server folder.
              </div>
            </div>
          </div>
          <div class="tile-body">
            <div
              class="dropzone"
              :class="{ 'dropzone--over': dragOver }"
              @dragover.prevent="dragOver = true"
              @dragleave.prevent="dragOver = false"
              @drop.prevent="onDrop"
            >
              <label class="btn btn--secondary" style="cursor: pointer">
                {{ file ? "Change file" : "Choose file" }}
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  @change="onPick"
                  hidden
                />
              </label>
              <div class="hint">or drag a file here</div>
            </div>

            <div v-if="file" class="hint">
              Selected: <strong>{{ file.name }}</strong>
              ({{ prettyBytes(file.size) }})
            </div>
            <div v-if="uploadPercent !== null" class="hint">
              Uploading… {{ uploadPercent }}%
            </div>

            <div class="actions-row">
              <button
                class="btn btn--ghost"
                @click="doPreviewUpload"
                :disabled="!file || busy"
              >
                Preview
              </button>
              <button
                class="btn btn--primary"
                @click="doStageUpload"
                :disabled="!file || busy"
              >
                Stage
              </button>
            </div>
          </div>
        </div>

        <div class="tile">
          <div class="tile-head">
            <IconChip name="filters" />
            <div class="tile-text">
              <div class="tile-title">Source</div>
              <div class="tile-desc">How the file will be interpreted.</div>
            </div>
          </div>
          <div class="tile-body">
            <select class="select" v-model="sourceKey">
              <option v-for="s in sources" :key="s.key" :value="s.key">
                {{ s.label }} (v{{ s.version }})
              </option>
            </select>
            <div v-if="activeSource" class="kv-block">
              <div class="kv">
                <span>Conversation key</span>
                <span class="mono">{{
                  activeSource.naturalKeyCandidates[0]
                }}</span>
              </div>
              <div class="kv">
                <span>Expected columns</span>
                <span>~{{ activeSource.expectedColumns }} referenced</span>
              </div>
              <div class="kv">
                <span>Promoted as</span>
                <span class="mono">
                  {{ activeSource.interactionDefaults.interactionType }} /
                  {{ activeSource.interactionDefaults.status }}
                </span>
              </div>
              <div class="kv">
                <span>PII columns dropped</span>
                <span>{{ activeSource.piiDropColumns.length }} patterns</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── preview result ──────────────────────────────────────────────── -->
      <div v-if="preview" class="panel preview-panel">
        <div class="panel-head">
          <h3 class="panel-title">
            Preview — <span class="mono">{{ preview.file.name }}</span>
          </h3>
          <button class="btn btn--ghost btn--sm" @click="preview = null">
            Dismiss
          </button>
        </div>

        <div class="hint">
          Nothing has been written. This is the first
          {{ preview.rowsRead }} row{{ preview.rowsRead === 1 ? "" : "s" }}
          <template v-if="preview.truncated">
            (the file has more)</template
          >.
        </div>

        <div class="stat-row">
          <div class="stat">
            <div class="stat-label">Columns</div>
            <div class="stat-value">{{ preview.headerColumnCount }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Delimiter</div>
            <div class="stat-value">{{ preview.delimiterLabel }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Encoding</div>
            <div class="stat-value">{{ preview.encoding }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Conversation key</div>
            <div class="stat-value mono">
              {{ preview.naturalKeyColumnLabel ?? "—" }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">Valid</div>
            <div class="stat-value">{{ preview.statusCounts.valid ?? 0 }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Warnings</div>
            <div class="stat-value">
              {{ preview.statusCounts.warning ?? 0 }}
            </div>
          </div>
          <div class="stat">
            <div class="stat-label">Errors</div>
            <div class="stat-value">{{ preview.statusCounts.error ?? 0 }}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Transcripts parsed</div>
            <div class="stat-value">
              {{ preview.transcriptStatusCounts.parsed ?? 0 }}
            </div>
          </div>
        </div>

        <div class="split">
          <div>
            <h4 class="sub-title">Issues found</h4>
            <div v-if="!issueList.length" class="hint">
              No issues in the previewed rows.
            </div>
            <div v-for="i in issueList" :key="i.code" class="kv">
              <span class="mono">{{ i.code }}</span>
              <span>{{ i.count }}</span>
            </div>

            <h4 class="sub-title" v-if="preview.duplicateKeysInSample.length">
              Duplicate keys in the previewed rows
            </h4>
            <div
              v-for="k in preview.duplicateKeysInSample"
              :key="k"
              class="mono hint"
            >
              {{ k }}
            </div>
          </div>

          <div>
            <h4 class="sub-title">Columns</h4>
            <div class="kv">
              <span>Mapped</span>
              <span>{{ preview.columnMapping.mapped.length }}</span>
            </div>
            <div class="kv">
              <span>Not in this file</span>
              <span>{{ preview.columnMapping.missing.length }}</span>
            </div>
            <div class="kv">
              <span>Unused source columns</span>
              <span>{{ preview.columnMapping.unmapped.length }}</span>
            </div>
            <div class="kv">
              <span>Dropped by PII policy</span>
              <span>{{ preview.columnMapping.droppedByPolicy.length }}</span>
            </div>

            <h4 class="sub-title" v-if="preview.columnMapping.missing.length">
              Expected but missing
            </h4>
            <div
              v-for="m in preview.columnMapping.missing"
              :key="m.target"
              class="hint"
            >
              <span class="mono">{{ m.target }}</span>
              — looked for {{ m.columns.join(", ") }}
            </div>
          </div>
        </div>

        <h4 class="sub-title">First rows</h4>
        <div class="tbl-scroll">
          <table class="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Conversation</th>
                <th>Date</th>
                <th>Campaign</th>
                <th>Agent</th>
                <th>Msgs</th>
                <th>Transcript</th>
                <th>CSAT</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in preview.sampleRows" :key="r.rowNumber">
                <td>{{ r.rowNumber }}</td>
                <td>
                  <span :class="statusChip(r.validationStatus)">
                    {{ r.validationStatus }}
                  </span>
                </td>
                <td class="mono">{{ r.conversationId ?? "—" }}</td>
                <td>{{ fmtDate(r.interactionDateTime) }}</td>
                <td>{{ r.campaign ?? "—" }}</td>
                <td>{{ r.agent ?? "—" }}</td>
                <td>{{ r.transcriptMessageCount }}</td>
                <td>{{ r.transcriptParseStatus }}</td>
                <td>{{ r.csatScore ?? "—" }}</td>
                <td class="issue-cell">
                  <span v-if="!r.issues.length" class="muted">—</span>
                  <span
                    v-for="i in r.issues"
                    :key="i.code"
                    class="mono issue-code"
                    :title="i.message"
                  >
                    {{ i.code }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ─── runs ────────────────────────────────────────────────────────── -->
      <div class="panel">
        <div class="panel-head">
          <h3 class="panel-title">Import runs</h3>
        </div>
        <div v-if="!runs.length" class="hint">
          No import runs yet. Stage a file to create one.
        </div>
        <div v-else class="tbl-scroll">
          <table class="tbl">
            <thead>
              <tr>
                <th>Started</th>
                <th>File</th>
                <th>Source</th>
                <th>In</th>
                <th>Status</th>
                <th>Rows</th>
                <th>Valid</th>
                <th>Warn</th>
                <th>Error</th>
                <th>Dupe</th>
                <th>Existing</th>
                <th>Promoted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in runs" :key="r.id" class="row">
                <td>{{ fmtDate(r.createdAt) }}</td>
                <td class="mono file-cell" :title="r.originalFilename ?? ''">
                  {{ r.originalFilename ?? "—" }}
                </td>
                <td>{{ r.sourceKey }}</td>
                <td>{{ r.intake }}</td>
                <td>
                  <span :class="runStatusChip(r.status)">{{ r.status }}</span>
                  <span
                    v-if="r.status === 'parsing'"
                    class="hint"
                    style="margin-left: 6px"
                  >
                    {{ jobProgress[r.parseJobId ?? ""] ?? 0 }} rows
                  </span>
                </td>
                <td>{{ r.counts.staged }}</td>
                <td>{{ r.counts.valid }}</td>
                <td>{{ r.counts.warning }}</td>
                <td>{{ r.counts.error }}</td>
                <td>{{ r.counts.duplicate }}</td>
                <td>{{ r.counts.existing }}</td>
                <td>{{ r.promoted.interactions || "—" }}</td>
                <td>
                  <div class="actions-row">
                    <button
                      class="btn btn--ghost btn--sm"
                      @click="openRunId = r.id"
                    >
                      Open
                    </button>
                    <button
                      class="btn btn--ghost btn--sm"
                      @click="doDiscard(r)"
                      :disabled="busy || r.status === 'promoted'"
                      :title="
                        r.status === 'promoted'
                          ? 'Roll the run back before discarding'
                          : 'Delete this run and its staged rows'
                      "
                    >
                      Discard
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="lastErrorRun" class="error-tile">
          <div class="error-title">
            Last failure — {{ lastErrorRun.originalFilename }}
          </div>
          <div class="error-text">{{ lastErrorRun.lastError }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import IconChip from "./IconChip.vue";
import DataImportRunDetail from "./DataImportRunDetail.vue";
import {
  discardRun,
  getJob,
  listRuns,
  listServerFiles,
  listSources,
  prettyBytes,
  previewServerFile,
  previewUpload,
  stageServerFile,
  stageUpload,
  type ImportRunSummary,
  type PreviewResult,
  type ServerFile,
  type SourceInfo,
} from "../services/data-import.service";

const sources = ref<SourceInfo[]>([]);
const sourceKey = ref<string>("liveperson");
const serverFiles = ref<ServerFile[]>([]);
const serverFilesError = ref("");
const runs = ref<ImportRunSummary[]>([]);
const preview = ref<PreviewResult | null>(null);
const openRunId = ref<string | null>(null);

const file = ref<File | null>(null);
const dragOver = ref(false);
const uploadPercent = ref<number | null>(null);
const loading = ref(false);
const busy = ref(false);
const errorMsg = ref("");
const statusMsg = ref("");

/** Live row counts for runs still parsing, keyed by batch-job id. */
const jobProgress = ref<Record<string, number>>({});
let poll: ReturnType<typeof setInterval> | null = null;

const activeSource = computed(
  () => sources.value.find((s) => s.key === sourceKey.value) ?? null,
);

const issueList = computed(() => {
  if (!preview.value) return [];
  return Object.entries(preview.value.issueCounts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
});

const lastErrorRun = computed(
  () => runs.value.find((r) => r.status === "parse_failed" && r.lastError) ?? null,
);

function describe(e: unknown): string {
  const err = e as { response?: { data?: { message?: string } }; message?: string };
  return err?.response?.data?.message || err?.message || "Request failed";
}

function flash(msg: string) {
  statusMsg.value = msg;
  setTimeout(() => {
    if (statusMsg.value === msg) statusMsg.value = "";
  }, 6000);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function statusChip(status: string): string {
  if (status === "valid") return "chip chip--success";
  if (status === "warning") return "chip chip--warning";
  if (status === "error") return "chip chip--danger";
  if (status === "duplicate" || status === "existing") return "chip chip--info";
  return "chip";
}

function runStatusChip(status: string): string {
  if (status === "promoted") return "chip chip--success";
  if (status === "staged") return "chip chip--primary";
  if (status === "parsing" || status === "promoting") return "chip chip--info";
  if (status === "rolled_back") return "chip chip--warning";
  return "chip chip--danger";
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
  preview.value = null;
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  const dropped = e.dataTransfer?.files?.[0];
  if (dropped) {
    file.value = dropped;
    preview.value = null;
  }
}

async function loadSources() {
  sources.value = await listSources();
  if (!sources.value.some((s) => s.key === sourceKey.value)) {
    sourceKey.value = sources.value[0]?.key ?? "";
  }
}

async function loadServerFiles() {
  serverFilesError.value = "";
  try {
    serverFiles.value = await listServerFiles();
  } catch (e) {
    serverFiles.value = [];
    // Almost always "IMPORT_INBOX_DIR is not configured" — worth showing plainly
    // rather than as a page-level error, since upload still works.
    serverFilesError.value = describe(e);
  }
}

async function loadRuns() {
  runs.value = await listRuns(25);
}

async function refreshAll() {
  loading.value = true;
  errorMsg.value = "";
  try {
    await Promise.all([loadSources(), loadServerFiles(), loadRuns()]);
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    loading.value = false;
  }
}

async function doPreviewUpload() {
  if (!file.value) return;
  busy.value = true;
  errorMsg.value = "";
  uploadPercent.value = 0;
  try {
    preview.value = await previewUpload(
      file.value,
      sourceKey.value,
      undefined,
      (p) => (uploadPercent.value = p),
    );
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
    uploadPercent.value = null;
  }
}

async function doPreviewServer(name: string) {
  busy.value = true;
  errorMsg.value = "";
  try {
    preview.value = await previewServerFile(name, sourceKey.value);
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function doStageUpload() {
  if (!file.value) return;
  busy.value = true;
  errorMsg.value = "";
  uploadPercent.value = 0;
  try {
    const res = await stageUpload(
      file.value,
      sourceKey.value,
      undefined,
      (p) => (uploadPercent.value = p),
    );
    afterStage(res.runId, res.duplicateOfRunId);
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
    uploadPercent.value = null;
  }
}

async function doStageServer(name: string) {
  busy.value = true;
  errorMsg.value = "";
  try {
    const res = await stageServerFile(name, sourceKey.value);
    afterStage(res.runId, res.duplicateOfRunId);
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

function afterStage(runId: string, duplicateOfRunId: string | null) {
  preview.value = null;
  file.value = null;
  flash(
    duplicateOfRunId
      ? "Staging started. Note: a file with identical contents was imported before — " +
          "check for duplicates before promoting."
      : "Staging started. Rows appear as they are read.",
  );
  void loadRuns();
  openRunId.value = runId;
}

async function doDiscard(run: ImportRunSummary) {
  const label = run.originalFilename ?? run.id.slice(0, 8);
  if (
    !window.confirm(
      `Discard the run for "${label}"?\n\nThis deletes the run and all ${run.counts.staged} staged rows. Nothing in the live tables is affected.`,
    )
  ) {
    return;
  }
  busy.value = true;
  try {
    await discardRun(run.id);
    flash("Run discarded.");
    await loadRuns();
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

function closeRun() {
  openRunId.value = null;
  void loadRuns();
}

/**
 * Polls the batch job behind any still-parsing run. A streaming parse does not
 * know its total, so this reports a row count rather than a percentage.
 */
async function pollJobs() {
  const active = runs.value.filter((r) => r.status === "parsing" && r.parseJobId);
  if (!active.length) return;
  for (const run of active) {
    try {
      const job = await getJob(run.parseJobId!);
      jobProgress.value = { ...jobProgress.value, [run.parseJobId!]: job.progress };
      if (job.status !== "running") await loadRuns();
    } catch {
      // A missing job just means it has been cleaned up; the run list corrects itself.
      await loadRuns();
    }
  }
}

onMounted(() => {
  void refreshAll();
  poll = setInterval(() => void pollJobs(), 3000);
});

onUnmounted(() => {
  if (poll) clearInterval(poll);
});
</script>

<style scoped>
.tbl-scroll {
  overflow-x: auto;
  max-width: 100%;
}
.tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.tbl th,
.tbl td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.tbl th {
  font-weight: 600;
  color: var(--muted);
  font-size: 12px;
}
.panel {
  margin-top: 18px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.panel-title {
  margin: 0;
  font-size: 16px;
}
.sub-title {
  margin: 14px 0 6px;
  font-size: 13px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin: 12px 0;
}
.kv-block {
  margin-top: 10px;
}
.dropzone {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: 10px;
}
.dropzone--over {
  border-color: var(--brand);
  background: rgba(43, 108, 176, 0.06);
}
.file-meta {
  min-width: 0;
}
.file-name,
.file-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}
.issue-cell {
  white-space: normal;
  max-width: 320px;
}
.issue-code {
  display: inline-block;
  font-size: 11px;
  padding: 1px 5px;
  margin: 1px 2px 1px 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: help;
}
.hint--warn {
  color: var(--warning);
}
.run-msg {
  margin: 10px 0;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  background: rgba(43, 108, 176, 0.08);
  font-size: 13px;
}
.preview-panel {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
</style>
