<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import api from "@/services/api";
import { useAccess } from "@/composables/useAccess";

const { canSeeDevTools } = useAccess();

const qrDataUrl = ref<string | null>(null);
const manualKey = ref<string | null>(null);
const code = ref("");
const enabled = ref(false);
const confirmedAt = ref<string | null>(null);
const error = ref("");
const successMsg = ref("");
const busy = ref(false);

const showToken = ref(false);
const accessToken = computed(() => localStorage.getItem("accessToken") || "");

const codeClean = computed(() =>
  String(code.value || "")
    .replace(/\s+/g, "")
    .slice(0, 6)
);

function showSuccess(msg: string) {
  successMsg.value = msg;
  setTimeout(() => (successMsg.value = ""), 2500);
}

async function copyToken() {
  const token = localStorage.getItem("accessToken") || "";
  if (!token) return;
  try {
    await navigator.clipboard.writeText(token);
    showSuccess("Copied to clipboard");
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = token;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showSuccess("Copied to clipboard");
    } catch {
      error.value = "Copy failed";
    }
  }
}

async function loadStatus() {
  error.value = "";
  try {
    const { data } = await api.get("/uiapi/auth/2fa/status");
    enabled.value = !!data.enabled;
    confirmedAt.value = data.confirmedAt ?? null;
    if (enabled.value) {
      qrDataUrl.value = null;
      manualKey.value = null;
    }
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to load 2FA status";
  }
}

async function startSetup() {
  error.value = "";
  busy.value = true;
  try {
    const { data } = await api.post("/uiapi/auth/2fa/setup");
    qrDataUrl.value = data.qrDataUrl ?? null;
    manualKey.value = data.secret ?? null;
    enabled.value = false;
    confirmedAt.value = null;
    code.value = "";
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to start 2FA setup";
  } finally {
    busy.value = false;
  }
}

async function confirm() {
  error.value = "";
  busy.value = true;
  try {
    await api.post("/uiapi/auth/2fa/confirm", { code: codeClean.value });
    await loadStatus();
    code.value = "";
    showSuccess("2FA enabled successfully");
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to confirm 2FA";
  } finally {
    busy.value = false;
  }
}

async function disable2fa() {
  error.value = "";
  if (codeClean.value.length !== 6) {
    error.value = "Enter your 6-digit code to disable 2FA.";
    return;
  }
  busy.value = true;
  try {
    await api.post("/uiapi/auth/2fa/disable", { code: codeClean.value });
    qrDataUrl.value = null;
    manualKey.value = null;
    code.value = "";
    await loadStatus();
    showSuccess("2FA disabled");
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to disable 2FA";
  } finally {
    busy.value = false;
  }
}

async function reset2fa() {
  error.value = "";
  if (codeClean.value.length !== 6) {
    error.value = "Enter your 6-digit code to reset 2FA.";
    return;
  }
  busy.value = true;
  try {
    const { data } = await api.post("/uiapi/auth/2fa/reset", {
      code: codeClean.value,
    });
    qrDataUrl.value = data.qrDataUrl ?? null;
    manualKey.value = data.secret ?? null;
    enabled.value = false;
    confirmedAt.value = null;
    code.value = "";
  } catch (e: any) {
    error.value =
      e?.response?.data?.message || e?.message || "Failed to reset 2FA";
  } finally {
    busy.value = false;
  }
}

onMounted(loadStatus);
</script>

<template>
  <div class="tile">
    <div class="tile-head">
      <div class="tile-icon">🔐</div>
      <div class="tile-text">
        <div class="tile-title">Two-Factor Authentication</div>
        <div class="tile-desc">Secure your account with an authenticator app</div>
      </div>
      <span
        class="chip"
        :class="enabled ? 'chip--success' : 'chip--danger'"
        style="margin-left: auto; flex-shrink: 0"
      >
        {{ enabled ? "2FA enabled" : "2FA disabled" }}
      </span>
    </div>

    <div class="tile-body">
      <div v-if="enabled && confirmedAt" class="muted" style="margin-bottom: 12px">
        Enabled since {{ new Date(confirmedAt).toLocaleString() }}
      </div>

      <!-- QR setup panel -->
      <div v-if="qrDataUrl" class="subcard" style="margin-bottom: 14px">
        <div class="tile-title" style="font-size: 14px; margin-bottom: 6px">
          Scan QR code
        </div>
        <div class="muted" style="margin-bottom: 12px">
          Scan with Microsoft Authenticator or a compatible app, then enter the
          6-digit code below to confirm.
        </div>
        <div class="qr-row">
          <img
            :src="qrDataUrl"
            class="qr-img"
            alt="2FA QR code"
          />
          <div class="qr-detail">
            <div class="muted" style="margin-bottom: 6px">Manual entry key</div>
            <input
              class="input"
              :value="manualKey ?? ''"
              readonly
              style="width: 100%; font-family: monospace; font-size: 12px; letter-spacing: 1px"
            />
          </div>
        </div>
      </div>

      <!-- Code input + action buttons -->
      <div class="actions-row" style="margin-bottom: 10px">
        <input
          v-model="code"
          class="input"
          placeholder="000000"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          :disabled="busy"
          style="width: 130px; letter-spacing: 4px; font-size: 16px; text-align: center"
        />

        <button
          v-if="!enabled && !qrDataUrl"
          class="btn btn--primary"
          :disabled="busy"
          @click="startSetup"
        >
          {{ busy ? "Starting…" : "Enable 2FA" }}
        </button>

        <button
          v-if="qrDataUrl"
          class="btn btn--primary"
          :disabled="busy || codeClean.length !== 6"
          @click="confirm"
        >
          {{ busy ? "Confirming…" : "Confirm setup" }}
        </button>

        <template v-if="enabled && !qrDataUrl">
          <button
            class="btn btn--ghost"
            :disabled="busy || codeClean.length !== 6"
            @click="disable2fa"
          >
            {{ busy ? "Working…" : "Disable 2FA" }}
          </button>
          <button
            class="btn btn--secondary"
            :disabled="busy || codeClean.length !== 6"
            @click="reset2fa"
          >
            {{ busy ? "Working…" : "Reset / Re-enrol" }}
          </button>
        </template>
      </div>

      <div v-if="enabled && !qrDataUrl" class="hint">
        Enter your 6-digit code to disable or reset 2FA.
      </div>

      <div v-if="successMsg" class="muted" style="margin-top: 8px; color: var(--success)">
        {{ successMsg }}
      </div>

      <div v-if="error" class="error-tile" style="margin-top: 10px">
        <div class="error-title">Error</div>
        <div class="error-text">{{ error }}</div>
      </div>

      <!-- Dev tools -->
      <div v-if="canSeeDevTools" class="subcard" style="margin-top: 16px">
        <div class="tile-title" style="font-size: 14px; margin-bottom: 8px">
          Dev tools
        </div>
        <div class="actions-row">
          <button
            class="btn btn--ghost btn--sm"
            :disabled="!accessToken"
            @click="copyToken"
          >
            Copy access token
          </button>
          <button
            class="btn btn--ghost btn--sm"
            :disabled="!accessToken"
            @click="showToken = !showToken"
          >
            {{ showToken ? "Hide token" : "Show token" }}
          </button>
        </div>
        <div v-if="showToken && accessToken" class="prompt-box" style="margin-top: 10px">
          <pre class="pre">{{ accessToken }}</pre>
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

.qr-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  align-items: flex-start;
}

.qr-img {
  width: 180px;
  height: 180px;
  border-radius: 12px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.qr-detail {
  flex: 1;
  min-width: 180px;
}
</style>
