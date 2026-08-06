<script setup lang="ts">
// Admin CRUD for app.clients — the tenants a 'client'-role user or a
// view-as preview is scoped to. New clients are added here as the business
// grows, not just the two seeded at launch (NMGB, RAC).
import IconChip from "./IconChip.vue";
import { computed, onMounted, ref } from "vue";
import {
  createClient,
  listClients,
  renameClient,
  setClientActive,
  type ClientDef,
} from "@/services/clients.service";

const clients = ref<ClientDef[]>([]);
const loading = ref(false);
const error = ref("");
const successMsg = ref("");

const newName = ref("");
const newKey = ref("");
const creating = ref(false);

const renamingId = ref("");
const renameValue = ref("");
const savingId = ref("");

const canCreate = computed(
  () => newName.value.trim().length > 0 && newKey.value.trim().length > 0 && !creating.value,
);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    clients.value = await listClients(true);
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? e?.message ?? "Failed to load clients";
  } finally {
    loading.value = false;
  }
}

function showSuccess(msg: string) {
  successMsg.value = msg;
  setTimeout(() => (successMsg.value = ""), 2500);
}

// The key is the stable identifier used in backfill scripts and campaign
// mapping — keep it a plain lowercase slug, not free text.
function slugify(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function onKeyFieldFocus() {
  if (!newKey.value) newKey.value = slugify(newName.value);
}

async function create() {
  if (!canCreate.value) return;
  creating.value = true;
  error.value = "";
  try {
    await createClient(newName.value.trim(), newKey.value.trim());
    showSuccess("Client created");
    newName.value = "";
    newKey.value = "";
    await load();
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? e?.message ?? "Failed to create client";
  } finally {
    creating.value = false;
  }
}

function startRename(c: ClientDef) {
  renamingId.value = c.id;
  renameValue.value = c.name;
}

function cancelRename() {
  renamingId.value = "";
  renameValue.value = "";
}

async function saveRename(c: ClientDef) {
  if (!renameValue.value.trim()) return;
  savingId.value = c.id;
  error.value = "";
  try {
    await renameClient(c.id, renameValue.value.trim());
    cancelRename();
    await load();
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? e?.message ?? "Failed to rename client";
  } finally {
    savingId.value = "";
  }
}

async function toggleActive(c: ClientDef) {
  savingId.value = c.id;
  error.value = "";
  try {
    await setClientActive(c.id, !c.active);
    await load();
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? e?.message ?? "Failed to update client";
  } finally {
    savingId.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div class="tile">
    <div class="tile-head">
      <IconChip name="dealer" />
      <div class="tile-text">
        <div class="tile-title">Clients</div>
        <div class="tile-desc">
          Manage the external clients (tenants) that scope client-role logins and data.
        </div>
      </div>
    </div>

    <div class="tile-body">
      <div v-if="error" class="error-tile">
        <div class="error-text">{{ error }}</div>
      </div>
      <div v-if="successMsg" class="hint">{{ successMsg }}</div>

      <table class="clients-table" v-if="clients.length">
        <thead>
          <tr>
            <th>Name</th>
            <th>Key</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in clients" :key="c.id">
            <td>
              <input
                v-if="renamingId === c.id"
                v-model="renameValue"
                class="input input--inline"
                :disabled="savingId === c.id"
              />
              <span v-else>{{ c.name }}</span>
            </td>
            <td class="mono">{{ c.key }}</td>
            <td>
              <span class="chip" :class="c.active ? 'chip--success' : 'chip--muted'">
                {{ c.active ? "Active" : "Inactive" }}
              </span>
            </td>
            <td class="actions-cell">
              <template v-if="renamingId === c.id">
                <button class="btn btn--ghost btn--sm" :disabled="savingId === c.id" @click="cancelRename">Cancel</button>
                <button class="btn btn--primary btn--sm" :disabled="savingId === c.id" @click="saveRename(c)">Save</button>
              </template>
              <template v-else>
                <button class="btn btn--ghost btn--sm" @click="startRename(c)">Rename</button>
                <button class="btn btn--ghost btn--sm" :disabled="savingId === c.id" @click="toggleActive(c)">
                  {{ c.active ? "Deactivate" : "Activate" }}
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="!loading" class="hint">No clients yet.</div>

      <div class="new-client-row">
        <div class="field-row">
          <label class="field-label">New client name</label>
          <input v-model="newName" type="text" class="input" placeholder="e.g. Nissan / NMGB" :disabled="creating" />
        </div>
        <div class="field-row">
          <label class="field-label">Key</label>
          <input
            v-model="newKey"
            type="text"
            class="input"
            placeholder="e.g. nmgb"
            :disabled="creating"
            @focus="onKeyFieldFocus"
          />
        </div>
        <div class="actions-row">
          <button class="btn btn--primary" :disabled="!canCreate" @click="create">
            {{ creating ? "Creating…" : "Add client" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tile-text {
  flex: 1;
  min-width: 0;
}

.clients-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-bottom: 16px;
}

.clients-table th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted, #5b6b80);
  padding: 6px 8px;
  border-bottom: 1px solid var(--border, #e5e7eb);
}

.clients-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border, #f1f3f5);
}

.mono {
  font-family: ui-monospace, monospace;
  color: var(--text-muted, #5b6b80);
}

.actions-cell {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}

.btn--sm {
  padding: 4px 10px;
  font-size: 12px;
}

.chip--success {
  background: #ecfdf5;
  color: #059669;
}

.chip--muted {
  background: #f1f5f9;
  color: #64748b;
}

.new-client-row {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px dashed var(--border, #e5e7eb);
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted, #5b6b80);
}

.input--inline {
  width: 100%;
}
</style>
