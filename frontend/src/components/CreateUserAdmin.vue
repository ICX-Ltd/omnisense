<script setup lang="ts">
import IconChip from "./IconChip.vue";
import { computed, onMounted, ref } from "vue";
import { createUser, listRoles, type RoleDef } from "@/services/user.service";
import { listClients, type ClientDef } from "@/services/clients.service";

const loading = ref(false);
const error = ref("");
const successMsg = ref("");

const roles = ref<RoleDef[]>([]);
const clients = ref<ClientDef[]>([]);

const form = ref({
  email: "",
  displayName: "",
  password: "",
  // Role was previously unsettable here: the service read it but the DTO
  // rejected it, so every account was created with a null role that needed
  // direct database access to fix.
  roleId: "",
  clientId: "",
});

onMounted(async () => {
  try {
    roles.value = await listRoles();
  } catch {
    // Non-fatal: the form still works, the role just has to be set afterwards.
  }
  try {
    clients.value = await listClients();
  } catch {
    // Non-fatal: only blocks creating a 'client'-role user until retried.
  }
});

const selectedRole = computed(
  () => roles.value.find((r) => r.id === form.value.roleId) ?? null,
);
// The client role is external-only access and must be scoped to exactly one
// client — mirrors the server-side requirement in UserService.create.
const isClientRole = computed(() => form.value.roleId === "client");

const canSubmit = computed(() => {
  return (
    form.value.email.trim().length > 0 &&
    form.value.displayName.trim().length > 0 &&
    form.value.password.trim().length > 0 &&
    form.value.roleId.trim().length > 0 &&
    (!isClientRole.value || form.value.clientId.trim().length > 0)
  );
});

function resetForm() {
  form.value = { email: "", displayName: "", password: "", roleId: "", clientId: "" };
  error.value = "";
}

function showSuccess(msg: string) {
  successMsg.value = msg;
  setTimeout(() => (successMsg.value = ""), 2500);
}

async function submit() {
  if (!canSubmit.value) return;
  error.value = "";
  loading.value = true;

  try {
    await createUser({
      email: form.value.email.trim(),
      displayName: form.value.displayName.trim(),
      password: form.value.password,
      roleId: form.value.roleId,
      clientId: isClientRole.value ? form.value.clientId : undefined,
    });

    showSuccess("User created");
    resetForm();
  } catch (e: any) {
    error.value = e?.message ?? "Failed to create user";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="tile">
    <div class="tile-head">
      <IconChip name="user-add" />
      <div class="tile-text">
        <div class="tile-title">Create User</div>
        <div class="tile-desc">Add a new user account</div>
      </div>
    </div>

    <div class="tile-body">
      <div class="field-stack">
        <div class="field-row">
          <label class="field-label">Email</label>
          <input
            v-model="form.email"
            type="email"
            class="input"
            autocomplete="off"
            :disabled="loading"
          />
        </div>

        <div class="field-row">
          <label class="field-label">Display name</label>
          <input
            v-model="form.displayName"
            type="text"
            class="input"
            autocomplete="off"
            :disabled="loading"
          />
        </div>

        <div class="field-row">
          <label class="field-label">Role</label>
          <div class="input-wrap">
            <select v-model="form.roleId" class="input" :disabled="loading">
              <option value="">Select a role…</option>
              <option v-for="r in roles" :key="r.id" :value="r.id">
                {{ r.label }} ({{ r.id }})
              </option>
            </select>
            <div v-if="selectedRole" class="hint">{{ selectedRole.description }}</div>
          </div>
        </div>

        <div v-if="isClientRole" class="field-row">
          <label class="field-label">Client</label>
          <div class="input-wrap">
            <select v-model="form.clientId" class="input" :disabled="loading">
              <option value="">Select a client…</option>
              <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <div class="hint">This user will only see this client's data.</div>
          </div>
        </div>

        <div class="field-row">
          <label class="field-label">Password</label>
          <input
            v-model="form.password"
            type="password"
            class="input"
            autocomplete="new-password"
            :disabled="loading"
          />
        </div>
      </div>

      <div class="actions-row" style="margin-top: 14px">
        <button
          class="btn btn--ghost"
          :disabled="loading"
          @click="resetForm"
        >
          Clear
        </button>
        <button
          class="btn btn--primary"
          :disabled="loading || !canSubmit"
          @click="submit"
        >
          {{ loading ? "Creating…" : "Create user" }}
        </button>
      </div>

      <div v-if="successMsg" class="muted" style="margin-top: 8px; color: var(--success)">
        {{ successMsg }}
      </div>

      <div v-if="error" class="error-tile" style="margin-top: 10px">
        <div class="error-title">Error</div>
        <div class="error-text">{{ error }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tile-text {
  flex: 1;
  min-width: 0;
}

.field-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
</style>
