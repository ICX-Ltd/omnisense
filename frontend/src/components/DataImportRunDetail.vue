<template>
  <div>
    <div class="detail-head">
      <div>
        <h3 class="panel-title">
          <span class="mono">{{ run?.originalFilename ?? runId.slice(0, 8) }}</span>
        </h3>
        <div class="hint" v-if="run">
          {{ run.sourceKey }} · {{ run.intake }} ·
          {{ run.delimiter === "\t" ? "tab" : run.delimiter }}-separated ·
          {{ run.encoding }} · staged {{ fmtDate(run.stagedAt) }}
        </div>
      </div>
      <div class="actions-row">
        <button class="btn btn--ghost btn--sm" @click="load" :disabled="loading">
          {{ loading ? "Loading…" : "Refresh" }}
        </button>
        <button class="btn btn--ghost btn--sm" @click="emit('close')">
          Back to runs
        </button>
      </div>
    </div>

    <div v-if="errorMsg" class="error-tile">
      <div class="error-title">Something went wrong</div>
      <div class="error-text">{{ errorMsg }}</div>
    </div>
    <div v-if="statusMsg" class="run-msg">{{ statusMsg }}</div>

    <div v-if="run?.status === 'parsing'" class="run-msg">
      Still reading the file — {{ run.counts.staged }} rows staged so far.
    </div>
    <div v-if="run?.lastError" class="error-tile">
      <div class="error-title">Run failed</div>
      <div class="error-text">{{ run.lastError }}</div>
    </div>

    <!-- ─── counters ──────────────────────────────────────────────────────── -->
    <div v-if="run" class="stat-row">
      <div class="stat">
        <div class="stat-label">Rows read</div>
        <div class="stat-value">{{ run.counts.read }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Staged</div>
        <div class="stat-value">{{ run.counts.staged }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Valid</div>
        <div class="stat-value">{{ run.counts.valid }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Warnings</div>
        <div class="stat-value">{{ run.counts.warning }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Errors</div>
        <div class="stat-value">{{ run.counts.error }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Duplicates</div>
        <div class="stat-value">{{ run.counts.duplicate }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Already imported</div>
        <div class="stat-value">{{ run.counts.existing }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Excluded</div>
        <div class="stat-value">{{ run.counts.excluded }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Messages</div>
        <div class="stat-value">{{ run.counts.messages }}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Transcripts</div>
        <div class="stat-value">
          {{ run.counts.transcriptsParsed }} /
          {{ run.counts.transcriptsPartial }} /
          {{ run.counts.transcriptsFailed }}
        </div>
        <div class="hint">parsed / partial / failed</div>
      </div>
      <div class="stat" v-if="run.counts.skipped">
        <div class="stat-label">Unreadable records</div>
        <div class="stat-value">{{ run.counts.skipped }}</div>
      </div>
    </div>

    <div v-if="run" class="promote-bar">
      <div>
        <template v-if="run.status === 'promoted'">
          <strong>Promoted.</strong>
          {{ run.promoted.interactions }} interactions,
          {{ run.promoted.transcripts }} transcripts,
          {{ run.promoted.csat }} CSAT, {{ run.promoted.surveys }} survey rows
          created<template v-if="run.promoted.skipped">
            — {{ run.promoted.skipped }} skipped as already present</template
          >.
        </template>
        <template v-else-if="run.status === 'promoting'">
          <strong>Promoting…</strong>
          {{ jobProgress }} of {{ jobTotal }} rows.
        </template>
        <template v-else>
          <strong>{{ promotable ?? promotableCount }}</strong> of
          <strong>{{ run.counts.staged }}</strong> rows ready to promote.
          <span class="hint" v-if="run.counts.excluded">
            {{ run.counts.excluded }} excluded ({{ run.counts.error }} with
            errors, {{ run.counts.duplicate }} duplicate,
            {{ run.counts.existing }} already imported).
          </span>
        </template>
      </div>

      <div class="actions-row">
        <button
          v-if="canPromote"
          class="btn btn--primary"
          :disabled="busy || !(promotable ?? promotableCount)"
          @click="openPromoteConfirm"
        >
          Promote {{ promotable ?? promotableCount }} row{{
            (promotable ?? promotableCount) === 1 ? "" : "s"
          }}
        </button>
        <button
          v-if="run.status === 'promoted' && isDev"
          class="btn btn--ghost"
          :disabled="busy"
          @click="openRollbackConfirm"
        >
          Roll back
        </button>
        <button
          v-if="run.status === 'promoted'"
          class="btn btn--ghost"
          :disabled="busy"
          @click="doPurgeStaging"
          title="Delete the staged rows but keep this run as an audit record"
        >
          Purge staging
        </button>
      </div>
    </div>

    <!-- ─── promote confirm ───────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="promoteConfirm"
        class="modal-backdrop"
        @click.self="promoteConfirm = null"
      >
        <div class="modal modal--narrow">
          <h3 class="panel-title">Promote into the live tables</h3>
          <p class="hint">
            This writes to <span class="mono">app.interactions</span>,
            <span class="mono">interaction_transcripts</span>,
            <span class="mono">interaction_csat</span> and
            <span class="mono">interaction_survey</span>. It can be rolled back.
          </p>

          <table class="tbl">
            <tbody>
              <tr>
                <td>Rows to promote</td>
                <td>
                  <strong>{{ promoteConfirm.promotable }}</strong>
                </td>
              </tr>
              <tr>
                <td>With a transcript</td>
                <td>{{ promoteConfirm.withTranscript }}</td>
              </tr>
              <tr>
                <td>With a CSAT score</td>
                <td>{{ promoteConfirm.withCsat }}</td>
              </tr>
              <tr>
                <td>With survey answers</td>
                <td>{{ promoteConfirm.withSurvey }}</td>
              </tr>
              <tr>
                <td>Excluded, so not promoted</td>
                <td>{{ promoteConfirm.excluded }}</td>
              </tr>
              <tr v-if="promoteConfirm.wouldSkipExisting">
                <td>Already live — will be skipped</td>
                <td>{{ promoteConfirm.wouldSkipExisting }}</td>
              </tr>
              <tr v-if="promoteConfirm.alreadyPromoted">
                <td>Promoted by this run already</td>
                <td>{{ promoteConfirm.alreadyPromoted }}</td>
              </tr>
            </tbody>
          </table>

          <div class="actions-row modal-actions">
            <button class="btn btn--ghost" @click="promoteConfirm = null">
              Cancel
            </button>
            <button
              class="btn btn--primary"
              :disabled="busy || !promoteConfirm.promotable"
              @click="doPromote"
            >
              Promote {{ promoteConfirm.promotable }} rows
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ─── rollback confirm ──────────────────────────────────────────────── -->
    <Teleport to="body">
      <div
        v-if="rollbackConfirm"
        class="modal-backdrop"
        @click.self="rollbackConfirm = null"
      >
        <div class="modal modal--narrow">
          <h3 class="panel-title">Roll back this import</h3>

          <div class="error-tile" v-if="rollbackConfirm.insightsAffected">
            <div class="error-title">
              This destroys {{ rollbackConfirm.insightsAffected }} insight
              record(s)
            </div>
            <div class="error-text">
              Those were produced by the LLM at real cost and will have to be
              regenerated if you promote again.
            </div>
          </div>

          <table class="tbl">
            <tbody>
              <tr>
                <td>Interactions deleted</td>
                <td>
                  <strong>{{ rollbackConfirm.promotedInteractions }}</strong>
                </td>
              </tr>
              <tr>
                <td>Transcripts deleted (cascade)</td>
                <td>{{ rollbackConfirm.transcriptsAffected }}</td>
              </tr>
              <tr>
                <td>Insights deleted (cascade)</td>
                <td>{{ rollbackConfirm.insightsAffected }}</td>
              </tr>
              <tr>
                <td>CSAT rows deleted (created by this import)</td>
                <td>{{ rollbackConfirm.csatCreatedByImport }}</td>
              </tr>
              <tr>
                <td>CSAT rows unlinked, not deleted (pre-existing)</td>
                <td>{{ rollbackConfirm.csatPreExisting }}</td>
              </tr>
              <tr>
                <td>Survey rows deleted</td>
                <td>{{ rollbackConfirm.surveysAffected }}</td>
              </tr>
            </tbody>
          </table>

          <p class="hint">
            Type <span class="mono">{{ rollbackPhrase }}</span> to confirm.
          </p>
          <input
            class="input"
            v-model="rollbackTyped"
            :placeholder="rollbackPhrase"
            autocomplete="off"
          />

          <div class="actions-row modal-actions">
            <button class="btn btn--ghost" @click="rollbackConfirm = null">
              Cancel
            </button>
            <button
              class="btn btn--primary btn--danger"
              :disabled="busy || rollbackTyped.trim().toUpperCase() !== rollbackPhrase"
              @click="doRollback"
            >
              Roll back
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- ─── mapping panel ─────────────────────────────────────────────────── -->
    <div v-if="run" class="panel">
      <div class="panel-head">
        <h4 class="sub-title">Conversation key</h4>
      </div>
      <div class="key-row">
        <div>
          Currently reading the conversation id from
          <span class="mono">{{ run.naturalKeyColumnLabel ?? "—" }}</span
          >.
        </div>
        <div class="actions-row">
          <select class="select" v-model="rekeyColumn">
            <option value="">Choose a different column…</option>
            <option v-for="h in run.headers" :key="h" :value="h">{{ h }}</option>
          </select>
          <button
            class="btn btn--secondary btn--sm"
            :disabled="!rekeyColumn || busy"
            @click="doRekey"
          >
            Re-key rows
          </button>
        </div>
      </div>
      <div class="hint">
        Re-keying re-derives the id from the rows already staged — the file is not
        read again.
      </div>
    </div>

    <!-- ─── rows grid ─────────────────────────────────────────────────────── -->
    <div class="panel">
      <div class="panel-head">
        <h4 class="sub-title">Staged rows</h4>
        <div class="actions-row">
          <button
            class="btn btn--ghost btn--sm"
            @click="doRevalidate"
            :disabled="busy"
          >
            Re-validate
          </button>
          <button
            class="btn btn--ghost btn--sm"
            @click="doExcludeWarnings"
            :disabled="busy || !run?.counts.warning"
          >
            Exclude all warnings
          </button>
          <button class="btn btn--ghost btn--sm" @click="exportCsv" :disabled="!rows.length">
            Download QA CSV
          </button>
        </div>
      </div>

      <div class="controls">
        <div class="control-group">
          <label class="hint">Status</label>
          <select class="select" v-model="filterStatus" @change="reload">
            <option value="">All</option>
            <option value="valid">Valid</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="duplicate">Duplicate</option>
            <option value="existing">Already imported</option>
          </select>
        </div>
        <div class="control-group">
          <label class="hint">Find</label>
          <input
            class="input"
            type="search"
            v-model="searchTerm"
            placeholder="conversation id, session or agent"
            @keyup.enter="reload"
          />
        </div>
        <div class="control-group">
          <label class="hint">
            <input type="checkbox" v-model="onlyIssues" @change="reload" />
            Only rows with issues
          </label>
        </div>
        <div class="control-group">
          <label class="hint">Rows</label>
          <select class="select" v-model.number="limit" @change="reload">
            <option :value="200">200</option>
            <option :value="500">500</option>
            <option :value="2000">2000</option>
          </select>
        </div>
        <div class="spacer" />
        <div class="hint">
          Showing {{ rows.length }} of {{ total }}
          <template v-if="truncated"> (capped — narrow the filters)</template>
        </div>
      </div>

      <div v-if="!rows.length && !loading" class="hint">
        No staged rows match these filters.
      </div>

      <div v-else class="tbl-scroll">
        <table class="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
              <th>Conversation</th>
              <th>Date</th>
              <th>Campaign</th>
              <th>Agent</th>
              <th>Skill</th>
              <th>Msgs</th>
              <th>Transcript</th>
              <th>CSAT</th>
              <th>MCS</th>
              <th>Issues</th>
              <th>In?</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.rowNumber"
              class="row"
              :class="{ 'row--excluded': r.excluded }"
              @click="openRow(r.rowNumber)"
            >
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
              <td>{{ r.skill ?? "—" }}</td>
              <td>{{ r.transcriptMessageCount ?? 0 }}</td>
              <td>{{ r.transcriptParseStatus ?? "—" }}</td>
              <td>
                {{
                  r.csatScore != null
                    ? `${r.csatScore}/${r.csatScoreMax ?? "?"}`
                    : "—"
                }}
              </td>
              <td>{{ r.mcs ?? "—" }}</td>
              <td class="issue-cell">
                <span v-if="!r.issueCodes.length" class="muted">—</span>
                <span
                  v-for="c in r.issueCodes"
                  :key="c"
                  class="mono issue-code"
                  >{{ c }}</span
                >
              </td>
              <td @click.stop>
                <button
                  class="btn btn--ghost btn--sm"
                  :disabled="
                    busy ||
                    r.promoteStatus === 'promoted' ||
                    (r.excluded && r.validationStatus === 'error')
                  "
                  :title="
                    r.validationStatus === 'error'
                      ? 'Rows with validation errors cannot be imported'
                      : r.excluded
                        ? 'Include this row'
                        : 'Exclude this row'
                  "
                  @click="toggleExcluded(r)"
                >
                  {{ r.excluded ? "Excluded" : "Included" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ─── row modal ─────────────────────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="rowDetail" class="modal-backdrop" @click.self="rowDetail = null">
        <div class="modal">
          <div class="modal-head">
            <div>
              <h3 class="panel-title">
                Row {{ rowDetail.rowNumber }} —
                <span class="mono">{{ rowDetail.conversationId ?? "no id" }}</span>
              </h3>
              <div class="hint">
                <span :class="statusChip(rowDetail.validationStatus)">
                  {{ rowDetail.validationStatus }}
                </span>
                <span v-if="rowDetail.excluded"> · excluded</span>
              </div>
            </div>
            <button class="btn btn--ghost btn--sm" @click="rowDetail = null">
              Close
            </button>
          </div>

          <div class="tabs-row">
            <button
              v-for="t in ['messages', 'issues', 'raw'] as const"
              :key="t"
              class="btn btn--sm"
              :class="modalTab === t ? 'btn--primary' : 'btn--ghost'"
              @click="modalTab = t"
            >
              {{
                t === "messages"
                  ? `Parsed messages (${rowDetail.messages.length})`
                  : t === "issues"
                    ? `Issues (${rowDetail.issues.length})`
                    : "Raw row"
              }}
            </button>
          </div>

          <!-- messages: what the detail drawer will show after promote -->
          <div v-if="modalTab === 'messages'" class="modal-body">
            <div v-if="!rowDetail.messages.length" class="hint">
              No messages were parsed from this transcript.
            </div>
            <div v-else class="chat-thread">
              <div
                v-for="m in rowDetail.messages"
                :key="m.seq"
                class="chat-msg"
                :class="[
                  m.source === 'Customer' ? 'chat-msg--customer' : 'chat-msg--agent',
                  { 'chat-msg--dropped': !m.includedInTranscript },
                ]"
              >
                <div class="chat-meta">
                  <span class="chat-sender">{{ m.sender || m.source }}</span>
                  <span class="chat-time">
                    {{ m.timestampIso ?? m.timestampText ?? "—" }}
                    <template v-if="m.dayOffset">
                      · day +{{ m.dayOffset }}</template
                    >
                  </span>
                </div>
                <div class="chat-bubble">{{ m.content }}</div>
                <div class="chat-flags">
                  <span v-if="!m.includedInTranscript" class="chip chip--warning">
                    not imported
                  </span>
                  <span v-if="m.isHandover" class="chip chip--info">handover</span>
                  <span v-if="m.isAuto" class="chip">automated</span>
                  <span v-if="m.parseWarning" class="hint">{{
                    m.parseWarning
                  }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- issues -->
          <div v-else-if="modalTab === 'issues'" class="modal-body">
            <div v-if="!rowDetail.issues.length" class="hint">
              No issues on this row.
            </div>
            <table v-else class="tbl">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Code</th>
                  <th>Field</th>
                  <th>Detail</th>
                  <th>Original value</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(i, idx) in rowDetail.issues" :key="idx">
                  <td>
                    <span
                      :class="
                        i.level === 'error'
                          ? 'chip chip--danger'
                          : 'chip chip--warning'
                      "
                      >{{ i.level }}</span
                    >
                  </td>
                  <td class="mono">{{ i.code }}</td>
                  <td>{{ i.field ?? "—" }}</td>
                  <td class="wrap-cell">{{ i.message }}</td>
                  <td class="wrap-cell mono">
                    <template v-if="i.original">
                      {{ i.original }}
                      <span v-if="i.truncatedTo" class="hint">
                        (kept first {{ i.truncatedTo }})
                      </span>
                    </template>
                    <span v-else class="muted">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- raw source row, with the PII policy made visible -->
          <div v-else class="modal-body">
            <div class="hint">
              Showing {{ Object.keys(rowDetail.raw).length }} populated column(s).
              <template v-if="rowDetail.droppedByPolicy.length">
                {{ rowDetail.droppedByPolicy.length }} dropped by the PII policy
                and never stored.
              </template>
              <template v-if="rowDetail.emptyColumnCount">
                {{ rowDetail.emptyColumnCount }} were empty in the source and are
                not kept.
              </template>
            </div>
            <table class="tbl">
              <tbody>
                <tr v-for="(v, k) in rowDetail.raw" :key="k">
                  <td class="mono raw-key">{{ k }}</td>
                  <td class="wrap-cell">{{ v }}</td>
                </tr>
                <tr v-for="k in rowDetail.droppedByPolicy" :key="`drop-${k}`">
                  <td class="mono raw-key muted">{{ k }}</td>
                  <td class="muted">— dropped by policy</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { downloadCsv } from "../utils/csv";
import { useAccess } from "../composables/useAccess";
import {
  excludeByStatus,
  getJob,
  getPromotePreview,
  getRollbackPreview,
  getRowDetail,
  getRun,
  listRows,
  promoteRun,
  purgeStaging,
  rekeyRun,
  revalidateRun,
  rollbackRun,
  setRowExcluded,
  type ImportRunDetail,
  type PromotePreview,
  type RollbackPreview,
  type StagedRowDetail,
  type StagedRowSummary,
} from "../services/data-import.service";

const props = defineProps<{ runId: string }>();
const emit = defineEmits<{ (e: "close"): void; (e: "changed"): void }>();

const run = ref<ImportRunDetail | null>(null);
const rows = ref<StagedRowSummary[]>([]);
const total = ref(0);
const truncated = ref(false);
const rowDetail = ref<StagedRowDetail | null>(null);
const modalTab = ref<"messages" | "issues" | "raw">("messages");

const filterStatus = ref("");
const searchTerm = ref("");
const onlyIssues = ref(false);
const limit = ref(200);

const loading = ref(false);
const busy = ref(false);
const errorMsg = ref("");
const statusMsg = ref("");
const rekeyColumn = ref("");

const promotableCount = computed(() => {
  if (!run.value) return 0;
  return Math.max(run.value.counts.staged - run.value.counts.excluded, 0);
});

// ─── promote / rollback ─────────────────────────────────────────────────────
// Rollback is dev-only server side (it destroys promoted interactions and
// cascades away their insights), so the button is gated to match rather than
// letting an admin click something that 403s.
const { isDev } = useAccess();
const promotable = ref<number | null>(null);
const promoteConfirm = ref<PromotePreview | null>(null);
const rollbackConfirm = ref<RollbackPreview | null>(null);
const rollbackTyped = ref("");
const jobProgress = ref(0);
const jobTotal = ref(0);
let jobPoll: ReturnType<typeof setInterval> | null = null;

const canPromote = computed(
  () => !!run.value && ["staged", "promote_failed"].includes(run.value.status),
);
const rollbackPhrase = computed(
  () => `ROLLBACK ${props.runId.slice(0, 8)}`.toUpperCase(),
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

async function load() {
  loading.value = true;
  errorMsg.value = "";
  try {
    run.value = await getRun(props.runId);
    await reload();
    await refreshPromotable();
    syncJobPolling();
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    loading.value = false;
  }
}

/** Authoritative promotable count — the server applies the real gate. */
async function refreshPromotable() {
  if (!run.value) return;
  try {
    promotable.value = (await getPromotePreview(props.runId)).promotable;
  } catch {
    // Falls back to the local estimate; not worth surfacing as a page error.
    promotable.value = null;
  }
}

async function openPromoteConfirm() {
  busy.value = true;
  try {
    promoteConfirm.value = await getPromotePreview(props.runId);
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function doPromote() {
  busy.value = true;
  try {
    const res = await promoteRun(props.runId);
    jobTotal.value = res.total;
    jobProgress.value = 0;
    promoteConfirm.value = null;
    flash(`Promoting ${res.total} rows…`);
    await load();
    emit("changed");
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function openRollbackConfirm() {
  busy.value = true;
  rollbackTyped.value = "";
  try {
    rollbackConfirm.value = await getRollbackPreview(props.runId);
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function doRollback() {
  busy.value = true;
  try {
    const res = await rollbackRun(props.runId, rollbackTyped.value.trim());
    rollbackConfirm.value = null;
    flash(
      `Rolled back: ${res.interactionsDeleted} interactions and ` +
        `${res.csatDeleted} CSAT rows deleted, ${res.csatUnlinked} CSAT unlinked, ` +
        `${res.surveysDeleted} survey rows deleted. The run is staged again.`,
    );
    await load();
    emit("changed");
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function doPurgeStaging() {
  if (
    !window.confirm(
      "Delete this run's staged rows?\n\nThe promoted interactions are unaffected, but you will no longer be able to roll this run back or inspect what was imported.",
    )
  ) {
    return;
  }
  busy.value = true;
  try {
    const res = await purgeStaging(props.runId);
    flash(`Purged ${res.purged} staged row(s). The run header is kept.`);
    await load();
    emit("changed");
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

/**
 * Polls the promote job while one is running. Unlike a streaming parse, promote
 * knows its total up front, so this is a real progress figure.
 */
function syncJobPolling() {
  const active = run.value?.status === "promoting" && run.value.promoteJobId;
  if (active && !jobPoll) {
    jobPoll = setInterval(() => void pollJob(), 2000);
  } else if (!active && jobPoll) {
    clearInterval(jobPoll);
    jobPoll = null;
  }
}

async function pollJob() {
  const jobId = run.value?.promoteJobId;
  if (!jobId) return;
  try {
    const job = await getJob(jobId);
    jobProgress.value = job.progress;
    jobTotal.value = job.total;
    if (job.status !== "running") {
      await load();
      emit("changed");
    }
  } catch {
    await load();
  }
}

async function reload() {
  try {
    const page = await listRows(props.runId, {
      status: filterStatus.value || undefined,
      onlyIssues: onlyIssues.value || undefined,
      q: searchTerm.value.trim() || undefined,
      limit: limit.value,
    });
    rows.value = page.rows;
    total.value = page.total;
    truncated.value = page.truncated;
  } catch (e) {
    errorMsg.value = describe(e);
  }
}

async function openRow(rowNumber: number) {
  try {
    rowDetail.value = await getRowDetail(props.runId, rowNumber);
    modalTab.value = "messages";
  } catch (e) {
    errorMsg.value = describe(e);
  }
}

async function toggleExcluded(row: StagedRowSummary) {
  busy.value = true;
  try {
    await setRowExcluded(props.runId, row.rowNumber, !row.excluded);
    row.excluded = !row.excluded;
    run.value = await getRun(props.runId);
    emit("changed");
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function doExcludeWarnings() {
  if (
    !window.confirm(
      "Exclude every row that carries a warning?\n\nThey will not be promoted until you re-include them individually.",
    )
  ) {
    return;
  }
  busy.value = true;
  try {
    const res = await excludeByStatus(props.runId, ["warning"]);
    flash(`Excluded ${res.excluded} row(s) with warnings.`);
    await load();
    emit("changed");
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function doRevalidate() {
  busy.value = true;
  try {
    run.value = await revalidateRun(props.runId);
    await reload();
    flash("Re-validated. Rows you excluded by hand were left excluded.");
    emit("changed");
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

async function doRekey() {
  if (!rekeyColumn.value) return;
  if (
    !window.confirm(
      `Re-derive every conversation id from "${rekeyColumn.value}"?\n\nThis re-reads the staged rows and re-runs validation.`,
    )
  ) {
    return;
  }
  busy.value = true;
  try {
    const res = await rekeyRun(props.runId, rekeyColumn.value);
    flash(`Re-keyed ${res.updated} row(s) from ${rekeyColumn.value}.`);
    rekeyColumn.value = "";
    await load();
    emit("changed");
  } catch (e) {
    errorMsg.value = describe(e);
  } finally {
    busy.value = false;
  }
}

const QA_CSV_COLUMNS = [
  "rowNumber",
  "validationStatus",
  "excluded",
  "excludedReason",
  "conversationId",
  "interactionDateTime",
  "campaign",
  "agent",
  "skill",
  "outcome",
  "transcriptMessageCount",
  "transcriptParseStatus",
  "csatScore",
  "mcs",
  "issueCodes",
];

function exportCsv() {
  // Exports the rows currently loaded, which is what the operator is looking at.
  downloadCsv(
    `import-run-${props.runId.slice(0, 8)}-rows.csv`,
    rows.value as unknown as Array<Record<string, unknown>>,
    QA_CSV_COLUMNS,
  );
}

watch(() => props.runId, load);
onMounted(load);
onUnmounted(() => {
  if (jobPoll) clearInterval(jobPoll);
});
</script>

<style scoped>
.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.panel-title {
  margin: 0;
  font-size: 16px;
}
.sub-title {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
  flex-wrap: wrap;
}
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin: 12px 0;
}
.promote-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
}
.key-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.controls {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.control-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.spacer {
  flex: 1;
}
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
.row {
  cursor: pointer;
}
.row:hover {
  background: rgba(43, 108, 176, 0.05);
}
.row--excluded {
  opacity: 0.55;
}
.issue-cell {
  white-space: normal;
  max-width: 280px;
}
.issue-code {
  display: inline-block;
  font-size: 11px;
  padding: 1px 5px;
  margin: 1px 2px 1px 0;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.wrap-cell {
  white-space: normal;
  max-width: 460px;
}
.raw-key {
  vertical-align: top;
  max-width: 260px;
  white-space: normal;
}
.run-msg {
  margin: 10px 0;
  padding: 8px 12px;
  border-radius: var(--radius-lg);
  background: rgba(43, 108, 176, 0.08);
  font-size: 13px;
}

/* modal */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px;
}
.modal {
  background: var(--surface, #fff);
  border-radius: var(--radius-lg);
  max-width: 1000px;
  width: 100%;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  padding: 18px;
}
.modal--narrow {
  max-width: 560px;
}
.modal-actions {
  margin-top: 14px;
  justify-content: flex-end;
}
.btn--danger {
  background: var(--danger);
  border-color: var(--danger);
}
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.tabs-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.modal-body {
  overflow: auto;
  flex: 1;
}

/* chat bubbles — mirrors how the interaction drawer renders a promoted chat, so
   what is reviewed here is what will be seen afterwards */
.chat-thread {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.chat-msg {
  max-width: 78%;
}
.chat-msg--agent {
  align-self: flex-start;
}
.chat-msg--customer {
  align-self: flex-end;
  text-align: right;
}
.chat-msg--dropped {
  opacity: 0.6;
}
.chat-meta {
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 2px;
}
.chat-msg--customer .chat-meta {
  justify-content: flex-end;
}
.chat-sender {
  font-weight: 600;
}
.chat-bubble {
  display: inline-block;
  text-align: left;
  padding: 8px 12px;
  border-radius: 12px;
  border: 1px solid var(--border);
  white-space: pre-wrap;
  font-size: 13px;
}
.chat-msg--agent .chat-bubble {
  background: rgba(43, 108, 176, 0.08);
}
.chat-msg--customer .chat-bubble {
  background: rgba(100, 116, 139, 0.1);
}
.chat-msg--dropped .chat-bubble {
  border-style: dashed;
}
.chat-flags {
  display: flex;
  gap: 6px;
  margin-top: 3px;
  flex-wrap: wrap;
  font-size: 11px;
}
.chat-msg--customer .chat-flags {
  justify-content: flex-end;
}
</style>
