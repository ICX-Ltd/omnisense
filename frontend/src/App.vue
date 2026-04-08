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
      <div class="app-header">
        <div class="app-header-row">
          <div class="app-brand">
            <img class="app-logo" :src="logoUrl" alt="Auto Ignite" />
            <div>
              <h1 class="app-title">Omni-Sense</h1>
              <div class="app-subtitle">Transcription, insights extraction and batch processing.</div>
            </div>
          </div>
          <div class="app-topbar-right">
            <div class="app-user" v-if="user">
              <div class="app-user-name">{{ user.name || user.email }}</div>
            </div>
            <button class="settings-btn" :class="{ 'settings-btn--active': tab === 'settings' }" @click="tab = 'settings'" title="Settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            </button>
            <button class="logout-btn" @click="handleLogout">Sign out</button>
          </div>
        </div>
        <nav class="tabbar">
          <!-- Data Processing dropdown -->
          <div v-if="canSeeFullUI" class="tab-dropdown" ref="dpRef">
            <button
              class="tab"
              :class="{ 'tab--active': isDataProcessingTab }"
              @click="dpOpen = !dpOpen"
            >
              Data Processing
              <svg class="tab-chev" :class="{ 'tab-chev--open': dpOpen }" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div v-if="dpOpen" class="tab-dropdown-menu">
              <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'test' }" @click="tab = 'test'; dpOpen = false">Test Lab</button>
              <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'data' }" @click="tab = 'data'; dpOpen = false">Data Queue</button>
              <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'batch' }" @click="tab = 'batch'; dpOpen = false">Batch Dashboard</button>
            </div>
          </div>
          <button v-if="canSeeFullUI" class="tab" :class="{ 'tab--active': tab === 'summary' }" @click="tab = 'summary'">Summary</button>
          <button class="tab" :class="{ 'tab--active': tab === 'ops' }" @click="tab = 'ops'">Operations</button>
          <button class="tab" :class="{ 'tab--active': tab === 'clientservices' }" @click="tab = 'clientservices'">Client Services</button>
          <button class="tab" :class="{ 'tab--active': tab === 'survey' }" @click="tab = 'survey'">Survey Analytics</button>
          <button class="tab" :class="{ 'tab--active': tab === 'narratives' }" @click="tab = 'narratives'">Narratives</button>
        </nav>
      </div>

      <div class="app-content">
        <TestLab v-if="tab === 'test'" />
        <DataQueue v-else-if="tab === 'data'" />
        <BatchDashboard v-else-if="tab === 'batch'" />
        <SummaryDashboard v-else-if="tab === 'summary'" />
        <OperationsDashboard v-else-if="tab === 'ops'" />
        <ClientServicesDashboard v-else-if="tab === 'clientservices'" />
        <SurveyDashboard v-else-if="tab === 'survey'" />
        <NarrativesPage v-else-if="tab === 'narratives'" />
        <SettingsPanel v-else />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import TestLab from "./components/TestLab.vue";
import DataQueue from "./components/DataQueue.vue";
import BatchDashboard from "./components/BatchDashboard.vue";
import SummaryDashboard from "./components/SummaryDashboard.vue";
import OperationsDashboard from "./components/OperationsDashboard.vue";
import ClientServicesDashboard from "./components/ClientServicesDashboard.vue";
import SurveyDashboard from "./components/SurveyDashboard.vue";
import NarrativesPage from "./components/NarrativesPage.vue";
import LoginPanel from "./components/auth/LoginPanel.vue";
import TwoFactorPanel from "./components/auth/TwoFactorPanel.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { useAuth, type User } from "./composables/useAuth";
import { useAccess } from "./composables/useAccess";
import logoUrl from "./assets/ai-icon.png";

const { canSeeAdminTools, canSeeDevTools } = useAccess();
const canSeeFullUI = computed(() => canSeeDevTools.value || canSeeAdminTools.value);

const tab = ref<"test" | "data" | "batch" | "summary" | "ops" | "clientservices" | "survey" | "narratives" | "settings">("ops");
const dpOpen = ref(false);
const dpRef = ref<HTMLElement | null>(null);
const isDataProcessingTab = computed(() => ["test", "data", "batch"].includes(tab.value));

function onClickOutsideDp(e: MouseEvent) {
  if (dpOpen.value && dpRef.value && !dpRef.value.contains(e.target as Node)) {
    dpOpen.value = false;
  }
}
onMounted(() => document.addEventListener("click", onClickOutsideDp));
onUnmounted(() => document.removeEventListener("click", onClickOutsideDp));
const booting = ref(true);
const authStep = ref<"login" | "2fa" | "app">("login");
const pendingTwoFactorToken = ref("");

const { user, restore, logout } = useAuth();

onMounted(async () => {
  const restored = await restore();
  authStep.value = restored ? "app" : "login";
  if (restored) tab.value = canSeeFullUI.value ? "test" : "ops";
  booting.value = false;
});

function handleTwoFactorRequired(payload: { twoFactorToken: string }) {
  pendingTwoFactorToken.value = payload.twoFactorToken;
  authStep.value = "2fa";
}

function handleAuthenticated(_payload: { user: User }) {
  pendingTwoFactorToken.value = "";
  authStep.value = "app";
  tab.value = canSeeFullUI.value ? "test" : "ops";
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
  padding: 16px 20px 20px;
}

.app-header {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-bottom: 0px;
  border-radius: 18px 18px 0 0;
  padding: 14px 20px 0;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
}

.app-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.app-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}

.app-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: #122033;
}

.app-topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-subtitle {
  font-size: 0.8rem;
  color: #6b7280;
  margin-top: 2px;
}

.app-user-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: #4b5563;
}

.logout-btn {
  border: 1px solid #d0d7e2;
  border-radius: 12px;
  padding: 8px 14px;
  background: #fff;
  color: #243447;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.logout-btn:hover {
  background: #f3f6fb;
  border-color: #1f6feb;
}

.tabbar {
  display: flex;
  gap: 4px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #e5e7eb;
}

.tab {
  border: 1px solid transparent;
  border-radius: 8px 8px 8px 8px;
  background: #f3f6fb;
  color: #6b7280;
  padding: 8px 16px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.tab:hover {
  background: #fff;
  color: #6b7280;
  border-color: #d0d7e2;
}

.tab--active {
  background: #1a3a5c;
  color: #fff;
  border-color: #1a3a5c;
}

/* ── Settings icon button ──────────────────────────────────────────────────── */
.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid #d0d7e2;
  border-radius: 10px;
  background: #fff;
  color: #6b7280;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.settings-btn:hover {
  background: #f3f6fb;
  border-color: #1f6feb;
  color: #1f6feb;
}

.settings-btn--active {
  background: #1a3a5c;
  border-color: #1a3a5c;
  color: #fff;
}

/* ── Tab dropdown ─────────────────────────────────────────────────────────── */
.tab-dropdown {
  position: relative;
}

.tab-chev {
  margin-left: 4px;
  transition: transform 0.15s;
}

.tab-chev--open {
  transform: rotate(180deg);
}

.tab-dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 180px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.1);
  z-index: 100;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tab-dropdown-item {
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #4b5563;
  padding: 8px 14px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s, color 0.12s;
}

.tab-dropdown-item:hover {
  background: #f3f6fb;
  color: #122033;
}

.tab-dropdown-item--active {
  background: #1a3a5c;
  color: #fff;
}

.tab-dropdown-item--active:hover {
  background: #1a3a5c;
  color: #fff;
}

.app-content {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-top: none;
  border-radius: 0 0 18px 18px;
  padding: 16px 20px 20px;
  margin-bottom: 8px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);
}
</style>
