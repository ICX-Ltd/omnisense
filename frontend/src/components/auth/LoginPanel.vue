<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-brand">
        <img class="auth-logo" :src="logoUrl" alt="Auto Ignite" />
        <div>
          <h1 class="auth-title">Omni-Sense</h1>
          <p class="auth-subtitle">
            Sign in to access transcription, insights extraction, and batch
            processing.
          </p>
        </div>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label class="auth-field">
          <span>Email or User ID</span>
          <input
            v-model.trim="identifier"
            type="text"
            autocomplete="username"
            placeholder="you@example.com"
            :disabled="submitting"
          />
        </label>

        <label class="auth-field">
          <span>Password</span>
          <div class="password-wrap">
            <input
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="Password"
              :disabled="submitting"
            />
            <button
              type="button"
              class="pw-toggle"
              tabindex="-1"
              @mousedown.prevent="showPassword = true"
              @mouseup.prevent="showPassword = false"
              @mouseleave="showPassword = false"
              @touchstart.prevent="showPassword = true"
              @touchend.prevent="showPassword = false"
            >
              <svg v-if="!showPassword" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
          </div>
        </label>

        <p v-if="error" class="auth-error">{{ error }}</p>

        <button class="auth-button" type="submit" :disabled="submitting">
          {{ submitting ? "Signing in..." : "Sign in" }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import logoUrl from "../../assets/ai-icon.png";
import { useAuth } from "../../composables/useAuth";

const emit = defineEmits<{
  (
    e: "authenticated",
    payload: { user: { id: string; name?: string; email?: string } }
  ): void;
  (e: "two-factor-required", payload: { twoFactorToken: string }): void;
}>();

const { login } = useAuth();

const identifier = ref("");
const password = ref("");
const error = ref("");
const submitting = ref(false);
const showPassword = ref(false);

async function submit() {
  error.value = "";

  if (!identifier.value || !password.value) {
    error.value = "Enter your email or user ID and password.";
    return;
  }

  submitting.value = true;

  try {
    const result = await login(identifier.value, password.value);

    if (result.twoFactorRequired) {
      emit("two-factor-required", {
        twoFactorToken: result.twoFactorToken,
      });
      return;
    }

    emit("authenticated", { user: result.user });
  } catch (err: any) {
    error.value = err?.message || "Unable to sign in.";
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #f4f7fb;
}

.auth-card {
  width: 100%;
  max-width: 460px;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 16px 50px rgba(16, 24, 40, 0.08);
  padding: 28px;
  border: 1px solid #e7ecf3;
}

.auth-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}

.auth-logo {
  width: 52px;
  height: 52px;
  object-fit: contain;
}

.auth-title {
  margin: 0;
  font-size: 1.6rem;
  font-weight: 700;
  color: #122033;
}

.auth-subtitle {
  margin: 6px 0 0;
  color: #5b6b80;
  font-size: 0.95rem;
  line-height: 1.45;
}

.auth-form {
  display: grid;
  gap: 16px;
}

.auth-field {
  display: grid;
  gap: 6px;
}

.auth-field span {
  font-size: 0.92rem;
  font-weight: 600;
  color: #304256;
}

.auth-field input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid #d3dce7;
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 0.98rem;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.auth-field input:focus {
  border-color: #4c7cf0;
  box-shadow: 0 0 0 4px rgba(76, 124, 240, 0.12);
}

.password-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.password-wrap input {
  padding-right: 42px;
}

.pw-toggle {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  cursor: pointer;
  color: #8899aa;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: color 0.15s;
}

.pw-toggle:hover {
  color: #304256;
}

.auth-error {
  margin: 0;
  color: #b42318;
  background: #fef3f2;
  border: 1px solid #fecdca;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 0.92rem;
}

.auth-button {
  border: 0;
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 1rem;
  font-weight: 700;
  background: #1f6feb;
  color: white;
  cursor: pointer;
}

.auth-button:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
