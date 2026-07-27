<script setup lang="ts">
import IconChip from "./IconChip.vue";
import { computed, onMounted, ref } from "vue";
import {
  adminResetPassword,
  listUsers,
  type AdminUser,
} from "@/services/user.service";

const users = ref<AdminUser[]>([]);
const loadingUsers = ref(false);
const saving = ref(false);
const error = ref("");
const successMsg = ref("");

const selectedId = ref("");
const pw1 = ref("");
const pw2 = ref("");
const reveal = ref(false);

const selectedUser = computed(
  () => users.value.find((u) => u.id === selectedId.value) ?? null
);

const canSubmit = computed(
  () =>
    !!selectedId.value &&
    pw1.value.length >= 8 &&
    pw1.value === pw2.value &&
    !saving.value
);

function showSuccess(msg: string) {
  successMsg.value = msg;
  setTimeout(() => (successMsg.value = ""), 4000);
}

async function loadUsers() {
  loadingUsers.value = true;
  error.value = "";
  try {
    users.value = await listUsers();
  } catch (e: any) {
    if (e?.code === "AUTH_REDIRECT") return;
    error.value = e?.message ?? "Failed to load users";
  } finally {
    loadingUsers.value = false;
  }
}

async function submit() {
  error.value = "";

  if (!selectedId.value) {
    error.value = "Pick a user first.";
    return;
  }
  if (pw1.value.length < 8) {
    error.value = "New password must be at least 8 characters.";
    return;
  }
  if (pw1.value !== pw2.value) {
    error.value = "Passwords do not match.";
    return;
  }

  const label = selectedUser.value?.email ?? "this user";
  if (
    !window.confirm(
      `Reset the password for ${label}?\n\nTheir current password stops working and any active session is signed out.`
    )
  ) {
    return;
  }

  saving.value = true;
  try {
    await adminResetPassword(selectedId.value, pw1.value);
    showSuccess(`Password reset for ${label} — they are now signed out.`);
    pw1.value = "";
    pw2.value = "";
    reveal.value = false;
  } catch (e: any) {
    if (e?.code === "AUTH_REDIRECT") return;
    error.value = e?.message ?? String(e);
  } finally {
    saving.value = false;
  }
}

onMounted(loadUsers);
</script>

<template>
  <div class="tile">
    <div class="tile-head">
      <IconChip name="password" />
      <div class="tile-text">
        <div class="tile-title">Reset User Password</div>
        <div class="tile-desc">Set a new password for another account</div>
      </div>
    </div>

    <div class="tile-body">
      <div class="field-stack">
        <div class="field-row">
          <label class="field-label">User</label>
          <select
            v-model="selectedId"
            class="input"
            :disabled="loadingUsers || saving"
          >
            <option value="">
              {{ loadingUsers ? "Loading users…" : "Select a user…" }}
            </option>
            <option v-for="u in users" :key="u.id" :value="u.id">
              {{ u.email }}{{ u.name && u.name !== u.email ? ` — ${u.name}` : "" }}
            </option>
          </select>
        </div>

        <div class="field-row">
          <label class="field-label">New password</label>
          <div class="input-wrap">
            <input
              v-model="pw1"
              :type="reveal ? 'text' : 'password'"
              class="input"
              autocomplete="new-password"
              :disabled="saving"
            />
            <button
              type="button"
              class="reveal-btn"
              tabindex="-1"
              @click="reveal = !reveal"
            >{{ reveal ? "Hide" : "Show" }}</button>
          </div>
        </div>

        <div class="field-row">
          <label class="field-label">Confirm new password</label>
          <input
            v-model="pw2"
            :type="reveal ? 'text' : 'password'"
            class="input"
            autocomplete="new-password"
            :disabled="saving"
          />
        </div>
      </div>

      <div class="actions-row" style="margin-top: 14px">
        <button
          class="btn btn--ghost"
          :disabled="loadingUsers || saving"
          @click="loadUsers"
        >
          Refresh list
        </button>
        <button
          class="btn btn--primary"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ saving ? "Resetting…" : "Reset password" }}
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

.input-wrap {
  display: flex;
  gap: 8px;
  align-items: center;
}

.input-wrap .input {
  flex: 1;
}

.reveal-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-muted, #5b6b80);
  white-space: nowrap;
}

.reveal-btn:hover {
  background: var(--surface-2, #f1f5f9);
}
</style>
