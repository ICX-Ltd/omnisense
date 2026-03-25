<script setup lang="ts">
import { computed, ref } from "vue";
import { createUser } from "@/services/user.service";

const loading = ref(false);
const error = ref("");
const successMsg = ref("");

const form = ref({
  email: "",
  displayName: "",
  password: "",
});

const canSubmit = computed(() => {
  return (
    form.value.email.trim().length > 0 &&
    form.value.displayName.trim().length > 0 &&
    form.value.password.trim().length > 0
  );
});

function resetForm() {
  form.value = { email: "", displayName: "", password: "" };
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
      <div class="tile-icon">👤</div>
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
