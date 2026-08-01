<script setup lang="ts">
// Change an existing user's role.
//
// Previously there was no way to do this at all: the create form could not send
// a role (the DTO rejected it) and nothing could update one afterwards, so roles
// could only be set with direct database access.

import IconChip from "./IconChip.vue";
import { computed, onMounted, ref } from "vue";
import {
  listRoles,
  listUsers,
  updateUserRole,
  type AdminUser,
  type RoleDef,
} from "@/services/user.service";
import { useAuth } from "@/composables/useAuth";

const { user: currentUser } = useAuth();

const users = ref<AdminUser[]>([]);
const roles = ref<RoleDef[]>([]);
const selectedId = ref("");
const nextRole = ref("");
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const successMsg = ref("");

const selectedUser = computed(
  () => users.value.find((u) => u.id === selectedId.value) ?? null,
);
const selectedRole = computed(
  () => roles.value.find((r) => r.id === nextRole.value) ?? null,
);

// The server refuses this too — mirrored here so the button explains itself
// rather than failing on click.
const isSelf = computed(
  () => !!selectedUser.value && selectedUser.value.id === (currentUser.value as any)?.id,
);

const canSave = computed(
  () =>
    !!selectedUser.value &&
    !!nextRole.value &&
    nextRole.value !== selectedUser.value.roleId &&
    !isSelf.value &&
    !saving.value,
);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [u, r] = await Promise.all([listUsers(), listRoles()]);
    users.value = u;
    roles.value = r;
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? e?.message ?? "Failed to load";
  } finally {
    loading.value = false;
  }
}

function onPickUser() {
  // Preselect the current role so the dropdown shows where they are now.
  nextRole.value = selectedUser.value?.roleId ?? "";
  error.value = "";
}

async function save() {
  if (!canSave.value || !selectedUser.value) return;
  saving.value = true;
  error.value = "";
  try {
    await updateUserRole(selectedUser.value.id, nextRole.value);
    successMsg.value = `${selectedUser.value.email} is now ${nextRole.value}`;
    setTimeout(() => (successMsg.value = ""), 4000);
    await load();
  } catch (e: any) {
    error.value =
      e?.response?.data?.message ?? e?.message ?? "Failed to update role";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="tile">
    <div class="tile-head">
      <IconChip name="agents" />
      <div class="tile-text">
        <div class="tile-title">User Roles</div>
        <div class="tile-desc">
          Set what a user can see and do. Roles are checked on the server, so this
          is a real permission change rather than a UI preference.
        </div>
      </div>
    </div>

    <div class="tile-body">
      <div v-if="error" class="error-tile">
        <div class="error-text">{{ error }}</div>
      </div>
      <div v-if="successMsg" class="hint">{{ successMsg }}</div>

      <div class="field-row">
        <label class="field-label">User</label>
        <div class="input-wrap">
          <select
            v-model="selectedId"
            class="input"
            :disabled="loading || saving"
            @change="onPickUser"
          >
            <option value="">
              {{ loading ? "Loading users…" : "Select a user…" }}
            </option>
            <option v-for="u in users" :key="u.id" :value="u.id">
              {{ u.email }} — {{ u.roleId || "no role set" }}
            </option>
          </select>
        </div>
      </div>

      <div class="field-row">
        <label class="field-label">Role</label>
        <div class="input-wrap">
          <select
            v-model="nextRole"
            class="input"
            :disabled="!selectedUser || saving"
          >
            <option value="">Select a role…</option>
            <option v-for="r in roles" :key="r.id" :value="r.id">
              {{ r.label }} ({{ r.id }})
            </option>
          </select>
          <div v-if="selectedRole" class="hint">{{ selectedRole.description }}</div>
          <div v-if="isSelf" class="hint hint--warn">
            You cannot change your own role — a demotion would lock you out of
            reversing it. Ask another admin.
          </div>
        </div>
      </div>

      <div class="actions-row">
        <button class="btn btn--primary" :disabled="!canSave" @click="save">
          {{ saving ? "Saving…" : "Update role" }}
        </button>
        <span
          v-if="selectedUser && nextRole && nextRole === selectedUser.roleId"
          class="hint"
        >
          Already {{ nextRole }}.
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.field-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.field-label {
  width: 110px;
  flex: 0 0 110px;
  padding-top: 8px;
  font-size: 13px;
  font-weight: 600;
}
.input-wrap {
  flex: 1;
  min-width: 0;
}
.hint--warn {
  color: var(--warning);
}
</style>
