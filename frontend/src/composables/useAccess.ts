import { computed, type Ref } from "vue";
import { useAuth } from "./useAuth";

export type Role = "dev" | "admin" | "supervisor" | "user" | "agent";

function normalizeRole(roleId: unknown): Role {
  const r = String(roleId ?? "")
    .trim()
    .toLowerCase();
  if (r === "dev" || r === "admin" || r === "supervisor" || r === "agent")
    return r;
  return "user";
}

export function useAccess(userOverride?: Ref<any> | { value: any }) {
  const { user: authUser } = useAuth();
  const userRef = (userOverride as Ref<any> | undefined) ?? authUser;

  const role = computed<Role>(() =>
    normalizeRole((userRef.value as any)?.roleId)
  );

  const isDev = computed(() => role.value === "dev");
  const isAdmin = computed(() => role.value === "admin");
  const isSupervisor = computed(() => role.value === "supervisor");
  const isAgent = computed(() => role.value === "agent");
  const isUser = computed(() => role.value === "user");

  const canSeeDevTools = computed(() => isDev.value);
  const canSeeAdminTools = computed(
    () => isDev.value || isAdmin.value || isSupervisor.value
  );
  // Narrower than canSeeAdminTools ON PURPOSE. The data importer loads raw
  // customer conversations into the live interaction tables, so it excludes
  // supervisors. Must stay in step with READ_ROLES/WRITE_ROLES in
  // backend/src/data-import/data-import.controller.ts, or the page appears in
  // the menu and then 403s on every call.
  const canImportData = computed(() => isDev.value || isAdmin.value);
  const canSeeAnything = computed(
    () => isDev.value || isAdmin.value || isSupervisor.value
  );

  const allowedAdminTables = computed(() => {
    if (isDev.value || isAdmin.value)
      return [
        "aiTag",
        "aiPrompt",
        "aiMessage",
        "auditLog",
        "report",
        "account",
      ] as const;
    if (isSupervisor.value) return ["aiMessage"] as const;
    return [] as const;
  });

  function hasRole(...roles: Role[]) {
    return roles.includes(role.value);
  }

  return {
    role,
    isDev,
    isAdmin,
    isSupervisor,
    isAgent,
    isUser,
    canSeeDevTools,
    canSeeAdminTools,
    canImportData,
    canSeeAnything,
    allowedAdminTables,
    hasRole,
  };
}
