<template>
  <div>
    <div class="hero">
      <div class="hero-row">
        <div class="hero-left">
          <h1 class="hero-title">User Set Up</h1>
          <div class="hero-subtitle">
            Manage your security settings and user administration.
          </div>
        </div>
        <div class="hero-right">
          <span class="chip chip--primary">User Set Up</span>
        </div>
      </div>
    </div>

    <div class="grid">
      <TwoFactorSetup />
      <ResetPassword />
      <CreateUserAdmin v-if="canSeeDevTools || canSeeAdminTools" />
      <ResetUserPasswordAdmin v-if="canSeeDevTools || isAdmin" />
      <!-- Same gate as the password reset: granting a role can hand someone
           full access, so it is not a supervisor-level action. -->
      <UserRoleAdmin v-if="canSeeDevTools || isAdmin" />
      <ClientsAdmin v-if="canSeeDevTools || isAdmin" />
    </div>
  </div>
</template>

<script setup lang="ts">
import TwoFactorSetup from "./TwoFactorSetUp.vue";
import ResetPassword from "./ResetPassword.vue";
import CreateUserAdmin from "./CreateUserAdmin.vue";
import ResetUserPasswordAdmin from "./ResetUserPasswordAdmin.vue";
import UserRoleAdmin from "./UserRoleAdmin.vue";
import ClientsAdmin from "./ClientsAdmin.vue";
import { useAccess } from "../composables/useAccess";

// Reset-another-user's-password is dev/admin only — narrower than canSeeAdminTools,
// which also lets supervisors in. Matches RESET_ROLES on the backend.
const { canSeeDevTools, canSeeAdminTools, isAdmin } = useAccess();
</script>
