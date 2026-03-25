<template>
  <div>
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <div class="hero-kicker">Account & Administration</div>
          <h1 class="hero-title">Settings</h1>
          <div class="hero-subtitle">
            Manage your security settings and user administration.
          </div>
        </div>
        <div class="hero-right">
          <span class="chip chip--primary">Settings</span>
        </div>
      </div>
    </div>

    <div class="grid">
      <TwoFactorSetup />
      <ResetPassword />
      <CreateUserAdmin v-if="canSeeDevTools || canSeeAdminTools" />
    </div>
  </div>
</template>

<script setup lang="ts">
import TwoFactorSetup from "./TwoFactorSetUp.vue";
import ResetPassword from "./ResetPassword.vue";
import CreateUserAdmin from "./CreateUserAdmin.vue";
import { useAccess } from "../composables/useAccess";

const { canSeeDevTools, canSeeAdminTools } = useAccess();
</script>
