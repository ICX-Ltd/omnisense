<template>
  <div v-if="booting" class="boot-screen">
    <div class="boot-card">
      <img class="boot-logo" :src="logoUrl" alt="Auto Ignite" />
      <div class="boot-title">Loading Pulse...</div>
    </div>
  </div>

  <LoginPanel
    v-else-if="authStep === 'login'"
    @authenticated="handleAuthenticated"
    @two-factor-required="handleTwoFactorRequired"
  />

  <TwoFactorPanel
    v-else-if="authStep === '2fa'"
    :two-factor-token="pendingTwoFactorToken"
    @verified="handleAuthenticated"
    @cancel="goToLogin"
  />

  <div v-else class="app-shell">
    <div class="app-shell-inner">
      <div class="app-header app-header--nav">
        <div class="app-header-row">
          <div class="app-brand">
            <img class="app-logo" :src="logoUrl" alt="Auto Ignite" />
            <div>
              <h1 class="app-title">Omni-Sense</h1>
              <div class="app-subtitle">
                Prototype for transcription, insights extraction, and batch
                processing.
              </div>
            </div>
          </div>

          <div class="app-topbar-right">
            <div class="app-user" v-if="user">
              <div class="app-user-name">{{ user.name || user.email }}</div>
              <div class="app-user-email">{{ user.email }}</div>
            </div>

            <button class="logout-button" @click="handleLogout">Logout</button>
          </div>
        </div>

        <div class="tabbar">
          <button
            class="tab"
            :class="{ 'tab--active': tab === 'test' }"
            @click="tab = 'test'"
          >
            Test Lab
          </button>

          <button
            class="tab"
            :class="{ 'tab--active': tab === 'data' }"
            @click="tab = 'data'"
          >
            Data Queue
          </button>

          <button
            class="tab"
            :class="{ 'tab--active': tab === 'batch' }"
            @click="tab = 'batch'"
          >
            Batch Dashboard
          </button>

          <button
            class="tab"
            :class="{ 'tab--active': tab === 'summary' }"
            @click="tab = 'summary'"
          >
            Summary
          </button>

          <button
            class="tab"
            :class="{ 'tab--active': tab === 'narratives' }"
            @click="tab = 'narratives'"
          >
            Narratives
          </button>

          <button
            class="tab"
            :class="{ 'tab--active': tab === 'settings' }"
            @click="tab = 'settings'"
          >
            Settings
          </button>
        </div>
      </div>

      <div class="app-content">
        <TestLab v-if="tab === 'test'" />
        <DataQueue v-else-if="tab === 'data'" />
        <BatchDashboard v-else-if="tab === 'batch'" />
        <SummaryDashboard v-else-if="tab === 'summary'" />
        <NarrativesPage v-else-if="tab === 'narratives'" />
        <SettingsPanel v-else />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import TestLab from "./components/TestLab.vue";
import DataQueue from "./components/DataQueue.vue";
import BatchDashboard from "./components/BatchDashboard.vue";
import SummaryDashboard from "./components/SummaryDashboard.vue";
import NarrativesPage from "./components/NarrativesPage.vue";
import LoginPanel from "./components/auth/LoginPanel.vue";
import TwoFactorPanel from "./components/auth/TwoFactorPanel.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { useAuth, type User } from "./composables/useAuth";
import logoUrl from "./assets/ai-icon.png";

const tab = ref<"test" | "data" | "batch" | "summary" | "narratives" | "settings">("test");
const booting = ref(true);
const authStep = ref<"login" | "2fa" | "app">("login");
const pendingTwoFactorToken = ref("");

const { user, restore, logout } = useAuth();

onMounted(async () => {
  const restored = await restore();
  authStep.value = restored ? "app" : "login";
  booting.value = false;
});

function handleTwoFactorRequired(payload: { twoFactorToken: string }) {
  pendingTwoFactorToken.value = payload.twoFactorToken;
  authStep.value = "2fa";
}

function handleAuthenticated(_payload: { user: User }) {
  pendingTwoFactorToken.value = "";
  authStep.value = "app";
}

function goToLogin() {
  pendingTwoFactorToken.value = "";
  authStep.value = "login";
}

function handleLogout() {
  logout();
  pendingTwoFactorToken.value = "";
  authStep.value = "login";
}
</script>

<style scoped>
.boot-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #f4f7fb;
  padding: 24px;
}

.boot-card {
  display: flex;
  align-items: center;
  gap: 14px;
  background: white;
  border: 1px solid #e7ecf3;
  border-radius: 18px;
  padding: 24px 28px;
  box-shadow: 0 16px 50px rgba(16, 24, 40, 0.08);
}

.boot-logo {
  width: 44px;
  height: 44px;
  object-fit: contain;
}

.boot-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #122033;
}

.app-shell {
  min-height: 100vh;
  background: #f5f7fa;
  color: #1f2937;
}

.app-shell-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.app-header {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 18px;
  padding: 20px;
  margin-bottom: 20px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.05);
}

.app-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.app-brand {
  display: flex;
  align-items: center;
  gap: 16px;
}

.app-logo {
  width: 52px;
  height: 52px;
  object-fit: contain;
}

.app-title {
  margin: 0;
  font-size: 1.8rem;
  font-weight: 700;
  color: #122033;
}

.app-subtitle {
  color: #5b6b80;
  margin-top: 4px;
}

.app-topbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.app-user {
  text-align: right;
}

.app-user-name {
  font-size: 0.96rem;
  font-weight: 700;
  color: #1f2937;
}

.app-user-email {
  font-size: 0.88rem;
  color: #667085;
}

.logout-button {
  border: 1px solid #d0d7e2;
  border-radius: 12px;
  padding: 10px 14px;
  background: white;
  color: #243447;
  font-weight: 700;
  cursor: pointer;
}

.tabbar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 18px;
}

.tab {
  border: 1px solid #d0d7e2;
  background: #fff;
  color: #243447;
  padding: 10px 14px;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 600;
}

.tab--active {
  background: #1f6feb;
  color: #fff;
  border-color: #1f6feb;
}

.app-content {
  display: block;
}
</style>
