<template>
  <div v-if="booting" class="boot-screen">
    <div class="boot-card">
      <img class="boot-logo" :src="logoUrl" alt="Auto Ignite" />
      <div class="boot-title">Loading Omni-Sense...</div>
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
      <div v-if="viewingAs" class="view-as-banner">
        Viewing as: <strong>{{ viewAsClientName }}</strong> — this preview matches exactly what that client sees.
        <button class="view-as-exit" @click="setViewAs(null, null)">Exit</button>
      </div>
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
            <GlobalRecordSearch />
            <div v-if="realCanUseViewAs" class="view-as-dropdown" ref="viewAsRef">
              <button class="settings-btn" :class="{ 'settings-btn--active': viewingAs }" @click="onToggleViewAsMenu" title="View as client">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="tab-chev" :class="{ 'tab-chev--open': viewAsOpen }" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <div v-if="viewAsOpen" class="tab-dropdown-menu settings-dropdown-menu view-as-menu">
                <div class="view-as-menu-label">View as client</div>
                <button
                  v-for="c in viewAsClients"
                  :key="c.id"
                  class="tab-dropdown-item"
                  :class="{ 'tab-dropdown-item--active': viewAsClientId === c.id }"
                  @click="setViewAs(c.id, c.name); viewAsOpen = false"
                >{{ c.name }}</button>
                <div v-if="!viewAsClients.length" class="view-as-menu-empty">No clients yet</div>
                <template v-if="viewingAs">
                  <div class="settings-menu-divider" />
                  <button class="tab-dropdown-item" @click="setViewAs(null, null); viewAsOpen = false">Exit view-as</button>
                </template>
              </div>
            </div>
            <div class="settings-dropdown" ref="setRef" v-if="!isClient">
              <button class="settings-btn" :class="{ 'settings-btn--active': isSettingsMenuTab }" @click="setOpen = !setOpen" title="Settings">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                <svg class="tab-chev" :class="{ 'tab-chev--open': setOpen }" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
              <div v-if="setOpen" class="tab-dropdown-menu settings-dropdown-menu">
                <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'settings' }" @click="tab = 'settings'; setOpen = false">User Set Up</button>
                <template v-if="canSeeAdminTools">
                  <div class="settings-menu-divider" />
                  <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'prompts' }" @click="tab = 'prompts'; setOpen = false">Prompts</button>
                  <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'models' }" @click="tab = 'models'; setOpen = false">AI Models</button>
                  <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'health' }" @click="tab = 'health'; setOpen = false">System Health</button>
                  <button v-if="canImportData" class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'dataimport' }" @click="tab = 'dataimport'; setOpen = false">Data Import</button>
                </template>
              </div>
            </div>
            <div class="app-user" v-if="user">
              <div class="app-user-name">{{ user.name || user.email }}</div>
            </div>
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
              <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'transcription' }" @click="tab = 'transcription'; dpOpen = false">Transcription Tools</button>
            </div>
          </div>
          <button v-if="canSeeFullUI" class="tab" :class="{ 'tab--active': tab === 'summary' }" @click="tab = 'summary'">Data Overview</button>
          <!-- Dashboards dropdown -->
          <div class="tab-dropdown" ref="dashRef">
            <button
              class="tab"
              :class="{ 'tab--active': isDashboardTab }"
              @click="dashOpen = !dashOpen"
            >
              Dashboards
              <svg class="tab-chev" :class="{ 'tab-chev--open': dashOpen }" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div v-if="dashOpen" class="tab-dropdown-menu">
              <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'ops' }" @click="tab = 'ops'; dashOpen = false">Operations (QC)</button>
              <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'clientservices' }" @click="tab = 'clientservices'; dashOpen = false">Campaign Insights</button>
              <button class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'survey' }" @click="tab = 'survey'; dashOpen = false">Survey Analytics</button>
              <button v-if="canSeeFullUI" class="tab-dropdown-item" :class="{ 'tab-dropdown-item--active': tab === 'csat' }" @click="tab = 'csat'; dashOpen = false">CSAT Assessment</button>
            </div>
          </div>
          <button class="tab" :class="{ 'tab--active': tab === 'narratives' }" @click="tab = 'narratives'">Narratives</button>
        </nav>
      </div>

      <div class="app-content">
        <!-- Render-time guard, not just nav-hiding: a client role (real or
             view-as previewed) can only ever reach CLIENT_ALLOWED_TABS, even
             by editing ?tab= directly — matches the server-side scoping in
             insights.controller.ts / survey-analytics.controller.ts. -->
        <template v-if="isTabAllowed(tab)">
          <keep-alive>
            <TestLab v-if="tab === 'test'" />
            <DataQueue v-else-if="tab === 'data'" />
            <BatchDashboard v-else-if="tab === 'batch'" />
            <TranscriptionToolsPage v-else-if="tab === 'transcription'" />
            <SummaryDashboard v-else-if="tab === 'summary'" />
            <OperationsDashboard v-else-if="tab === 'ops'" />
            <ClientServicesDashboard v-else-if="tab === 'clientservices'" />
            <SurveyDashboard v-else-if="tab === 'survey'" />
            <CsatDashboard v-else-if="tab === 'csat'" />
            <NarrativesPage v-else-if="tab === 'narratives'" />
            <PromptsAdmin v-else-if="tab === 'prompts'" />
            <SystemHealthPanel v-else-if="tab === 'health'" />
            <ModelRegistryPage v-else-if="tab === 'models'" />
            <!-- Role-guarded on the render too, not just the menu item: ?tab=dataimport
                 would otherwise let a supervisor reach a page that 403s. -->
            <DataImportPage v-else-if="tab === 'dataimport' && canImportData" />
            <SettingsPanel v-else />
          </keep-alive>
        </template>
        <div v-else class="tab-not-allowed">You don't have access to this section.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import TestLab from "./components/TestLab.vue";
import DataQueue from "./components/DataQueue.vue";
import BatchDashboard from "./components/BatchDashboard.vue";
import TranscriptionToolsPage from "./components/TranscriptionToolsPage.vue";
import SummaryDashboard from "./components/SummaryDashboard.vue";
import OperationsDashboard from "./components/OperationsDashboard.vue";
import ClientServicesDashboard from "./components/ClientServicesDashboard.vue";
import SurveyDashboard from "./components/SurveyDashboard.vue";
import CsatDashboard from "./components/CsatDashboard.vue";
import NarrativesPage from "./components/NarrativesPage.vue";
import PromptsAdmin from "./components/PromptsAdmin.vue";
import SystemHealthPanel from "./components/SystemHealthPanel.vue";
import ModelRegistryPage from "./components/ModelRegistryPage.vue";
import DataImportPage from "./components/DataImportPage.vue";
import GlobalRecordSearch from "./components/GlobalRecordSearch.vue";
import LoginPanel from "./components/auth/LoginPanel.vue";
import TwoFactorPanel from "./components/auth/TwoFactorPanel.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import { useAuth, type User } from "./composables/useAuth";
import { useAccess } from "./composables/useAccess";
import { listClients } from "./services/clients.service";
import logoUrl from "./assets/ai-icon.png";

const {
  canSeeAdminTools,
  canSeeDevTools,
  canImportData,
  isClient,
  allowedTabs,
  realCanUseViewAs,
  viewingAs,
  viewAsClientId,
  viewAsClientName,
  setViewAs,
} = useAccess();
const canSeeFullUI = computed(() => canSeeDevTools.value || canSeeAdminTools.value);
function isTabAllowed(t: string) {
  return !allowedTabs.value || (allowedTabs.value as readonly string[]).includes(t);
}

type ClientOption = { id: string; name: string };
const viewAsClients = ref<ClientOption[]>([]);
const viewAsOpen = ref(false);
const viewAsRef = ref<HTMLElement | null>(null);
async function loadViewAsClients() {
  try {
    viewAsClients.value = await listClients();
  } catch {
    viewAsClients.value = [];
  }
}
function onToggleViewAsMenu() {
  viewAsOpen.value = !viewAsOpen.value;
  if (viewAsOpen.value && !viewAsClients.value.length) loadViewAsClients();
}

const tab = ref<"test" | "data" | "batch" | "transcription" | "summary" | "ops" | "clientservices" | "survey" | "csat" | "narratives" | "prompts" | "health" | "models" | "dataimport" | "settings">("ops");
const dpOpen = ref(false);
const dpRef = ref<HTMLElement | null>(null);
const isDataProcessingTab = computed(() => ["test", "data", "batch", "transcription"].includes(tab.value));

// Settings menu (gear button) now also houses the admin surfaces: User Set Up,
// Prompts, Models, System Health.
const setOpen = ref(false);
const setRef = ref<HTMLElement | null>(null);
const isSettingsMenuTab = computed(() => ["settings", "prompts", "models", "health", "dataimport"].includes(tab.value));

// Dashboards menu — the analytics dashboards (Operations, Campaign Insights, Survey).
const dashOpen = ref(false);
const dashRef = ref<HTMLElement | null>(null);
const isDashboardTab = computed(() => ["ops", "clientservices", "survey", "csat"].includes(tab.value));

// Deep-linkable active tab — read from ?tab= on load, keep the URL in sync so a
// view can be shared/pasted (dashboards sync their own filters into the query).
// Every member of `tab` must be listed here or ?tab=<name> silently falls back
// ("csat" was missing until the data-import work added it).
const VALID_TABS = ["test", "data", "batch", "transcription", "summary", "ops", "clientservices", "survey", "csat", "narratives", "prompts", "health", "models", "dataimport", "settings"] as const;
function initialTab(): typeof tab.value {
  const p = new URLSearchParams(window.location.search).get("tab");
  if (p && (VALID_TABS as readonly string[]).includes(p) && isTabAllowed(p)) return p as typeof tab.value;
  if (allowedTabs.value) return allowedTabs.value[0] as typeof tab.value;
  return canSeeFullUI.value ? "test" : "ops";
}
watch(tab, (t) => {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", t);
  window.history.replaceState({}, "", url);
});
// Re-clamp if the allowed set changes at runtime — e.g. an admin turns
// view-as on/off while sitting on a tab that role can't reach.
watch(allowedTabs, (allowed) => {
  if (allowed && !allowed.includes(tab.value)) {
    tab.value = allowed[0] as typeof tab.value;
  }
});

function onClickOutsideMenus(e: MouseEvent) {
  const target = e.target as Node;
  if (dpOpen.value && dpRef.value && !dpRef.value.contains(target)) {
    dpOpen.value = false;
  }
  if (setOpen.value && setRef.value && !setRef.value.contains(target)) {
    setOpen.value = false;
  }
  if (dashOpen.value && dashRef.value && !dashRef.value.contains(target)) {
    dashOpen.value = false;
  }
  if (viewAsOpen.value && viewAsRef.value && !viewAsRef.value.contains(target)) {
    viewAsOpen.value = false;
  }
}
onMounted(() => document.addEventListener("click", onClickOutsideMenus));
onUnmounted(() => document.removeEventListener("click", onClickOutsideMenus));
const booting = ref(true);
const authStep = ref<"login" | "2fa" | "app">("login");
const pendingTwoFactorToken = ref("");

const { user, restore, logout } = useAuth();

onMounted(async () => {
  const restored = await restore();
  authStep.value = restored ? "app" : "login";
  if (restored) tab.value = initialTab();
  booting.value = false;
});

function handleTwoFactorRequired(payload: { twoFactorToken: string }) {
  pendingTwoFactorToken.value = payload.twoFactorToken;
  authStep.value = "2fa";
}

function handleAuthenticated(_payload: { user: User }) {
  pendingTwoFactorToken.value = "";
  authStep.value = "app";
  tab.value = initialTab();
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
  background:
    radial-gradient(90% 120% at 92% -25%, rgba(6, 182, 212, 0.34), transparent 55%),
    radial-gradient(90% 120% at -10% 120%, rgba(139, 92, 246, 0.30), transparent 55%),
    linear-gradient(135deg, #1a3a5c 0%, #2b6cb0 100%);
  border-radius: 18px 18px 0 0;
  padding: 14px 20px 0;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.1);
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
  filter: brightness(0) invert(1);
  background: transparent;
  border: none;
  padding: 0;
  border-radius: 0;
}

.app-title {
  display: inline-block;
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.02em;
}

/* Brand accent bar spanning the width of the title. */
.app-title::after {
  content: "";
  display: block;
  width: 100%;
  height: 3px;
  margin-top: 5px;
  border-radius: 2px;
  background: linear-gradient(90deg, #38bdf8, #2b6cb0);
}

.app-topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-subtitle {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.65);
  margin-top: 2px;
}

.app-user-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.logout-btn {
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 12px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.logout-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.4);
}

.tabbar {
  display: flex;
  gap: 4px;
  margin-top: 10px;
  padding-top: 8px;
  padding-bottom: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.tab {
  border: 1px solid transparent;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  padding: 8px 16px;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
  border-color: transparent;
}

.tab--active {
  background: #fff;
  color: #1a3a5c;
  border-color: #fff;
  font-weight: 700;
}

/* ── Settings icon button ──────────────────────────────────────────────────── */
.settings-dropdown {
  position: relative;
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 36px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.settings-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.4);
  color: #fff;
}

.settings-btn--active {
  background: #fff;
  border-color: #fff;
  color: #1a3a5c;
}

/* Settings menu opens below the gear, right-aligned to it. */
.settings-dropdown-menu {
  left: auto;
  right: 0;
}

.settings-menu-divider {
  height: 1px;
  background: #e5e7eb;
  margin: 4px 6px;
}

/* ── View as banner + picker ──────────────────────────────────────────────── */
.view-as-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fef3c7;
  border: 1px solid #fbbf24;
  color: #78350f;
  border-radius: 10px;
  padding: 8px 14px;
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 8px;
}

.view-as-exit {
  margin-left: auto;
  border: 1px solid #b45309;
  border-radius: 8px;
  background: #fff;
  color: #92400e;
  padding: 4px 10px;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.view-as-exit:hover {
  background: #fffbeb;
}

.view-as-dropdown {
  position: relative;
}

.view-as-menu {
  min-width: 200px;
}

.view-as-menu-label {
  padding: 6px 14px 2px;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #9ca3af;
}

.view-as-menu-empty {
  padding: 8px 14px;
  font-size: 0.82rem;
  color: #9ca3af;
}

.tab-not-allowed {
  padding: 40px 20px;
  text-align: center;
  color: #6b7280;
  font-size: 0.95rem;
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
  background: linear-gradient(135deg, #1a3a5c 0%, #2b6cb0 100%);
  color: #fff;
}

.tab-dropdown-item--active:hover {
  background: linear-gradient(135deg, #1a3a5c 0%, #2b6cb0 100%);
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
