<script setup lang="ts">
import { ref } from "vue";
import { changeMyPassword } from "@/services/auth.service";

const current = ref("");
const pw1 = ref("");
const pw2 = ref("");
const saving = ref(false);
const error = ref("");
const successMsg = ref("");

const revealCurrent = ref(false);
const revealNew = ref(false);
const revealConfirm = ref(false);

function showSuccess(msg: string) {
  successMsg.value = msg;
  setTimeout(() => (successMsg.value = ""), 2500);
}

async function submit() {
  error.value = "";
  const newPw = String(pw1.value ?? "");

  if (!newPw || newPw.length < 8) {
    error.value = "New password must be at least 8 characters.";
    return;
  }
  if (pw1.value !== pw2.value) {
    error.value = "Passwords do not match.";
    return;
  }

  saving.value = true;
  try {
    await changeMyPassword({
      currentPassword: current.value,
      newPassword: pw1.value,
    });

    showSuccess("Password updated");
    current.value = "";
    pw1.value = "";
    pw2.value = "";
  } catch (e: any) {
    if (e?.code === "AUTH_REDIRECT") return;
    error.value = e?.message ?? String(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="tile">
    <div class="tile-head">
      <div class="tile-icon">🔑</div>
      <div class="tile-text">
        <div class="tile-title">Change Password</div>
        <div class="tile-desc">Update your account password</div>
      </div>
    </div>

    <div class="tile-body">
      <div class="field-stack">
        <div class="field-row">
          <label class="field-label">Current password</label>
          <div class="input-wrap">
            <input
              v-model="current"
              :type="revealCurrent ? 'text' : 'password'"
              class="input"
              autocomplete="current-password"
              :disabled="saving"
            />
            <button
              type="button"
              class="reveal-btn"
              tabindex="-1"
              @click="revealCurrent = !revealCurrent"
            >{{ revealCurrent ? "Hide" : "Show" }}</button>
          </div>
        </div>

        <div class="field-row">
          <label class="field-label">New password</label>
          <div class="input-wrap">
            <input
              v-model="pw1"
              :type="revealNew ? 'text' : 'password'"
              class="input"
              autocomplete="new-password"
              :disabled="saving"
            />
            <button
              type="button"
              class="reveal-btn"
              tabindex="-1"
              @click="revealNew = !revealNew"
            >{{ revealNew ? "Hide" : "Show" }}</button>
          </div>
        </div>

        <div class="field-row">
          <label class="field-label">Confirm new password</label>
          <div class="input-wrap">
            <input
              v-model="pw2"
              :type="revealConfirm ? 'text' : 'password'"
              class="input"
              autocomplete="new-password"
              :disabled="saving"
            />
            <button
              type="button"
              class="reveal-btn"
              tabindex="-1"
              @click="revealConfirm = !revealConfirm"
            >{{ revealConfirm ? "Hide" : "Show" }}</button>
          </div>
        </div>
      </div>

      <div class="actions-row" style="margin-top: 14px">
        <button
          class="btn btn--primary"
          :disabled="saving"
          @click="submit"
        >
          {{ saving ? "Saving…" : "Update password" }}
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
