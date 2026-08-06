import { computed, ref, type Ref } from "vue";
import { useAuth } from "./useAuth";

export type Role = "dev" | "admin" | "supervisor" | "user" | "agent" | "client";

// The fixed set of tabs a 'client'-role user (or an admin's "view as" preview)
// may ever reach — dashboards + narratives, nothing else. Must stay in step
// with ANY_AUTHENTICATED_ROLE / the endpoint scoping in insights.controller.ts
// and survey-analytics.controller.ts: a tab added here without matching
// server-side scoping would just 401/403 on every call.
export const CLIENT_ALLOWED_TABS = ["ops", "clientservices", "survey", "narratives"] as const;

function normalizeRole(roleId: unknown): Role {
  const r = String(roleId ?? "")
    .trim()
    .toLowerCase();
  if (r === "dev" || r === "admin" || r === "supervisor" || r === "agent" || r === "client")
    return r;
  return "user";
}

// ── "View as" — module-level so every useAccess() call site (not just
// App.vue's own) picks up the same substitution automatically, and so the
// axios interceptor (services/http-bootstrap.ts) can read the same value to
// attach the X-View-As-Client header. Never trusted as a security boundary by
// itself — the backend re-derives the real role from the JWT and only honours
// this header when that real role is dev/admin (see auth-scope.decorator.ts).
const viewAsClientId = ref<string | null>(null);
const viewAsClientName = ref<string | null>(null);

export function setViewAs(clientId: string | null, name: string | null) {
  viewAsClientId.value = clientId;
  viewAsClientName.value = clientId ? name : null;
}
export function getViewAsClientId(): string | null {
  return viewAsClientId.value;
}

export function useAccess(userOverride?: Ref<any> | { value: any }) {
  const { user: authUser } = useAuth();
  const baseUserRef = (userOverride as Ref<any> | undefined) ?? authUser;

  // The REAL authenticated role/client, ignoring any view-as substitution —
  // used to decide who may see the view-as picker at all, and to label the
  // "viewing as" banner without it recursively describing itself.
  const realRole = computed<Role>(() => normalizeRole((baseUserRef.value as any)?.roleId));
  const realCanUseViewAs = computed(() => realRole.value === "dev" || realRole.value === "admin");
  const viewingAs = computed(() => realCanUseViewAs.value && !!viewAsClientId.value);

  // The EFFECTIVE user every other computed below is derived from — substituted
  // with a synthetic client identity while view-as is active. An explicit
  // userOverride (e.g. a settings page previewing a specific OTHER user) always
  // wins over view-as, since that caller asked for a specific identity on purpose.
  const userRef = computed(() => {
    if (!userOverride && viewingAs.value) {
      return { ...(baseUserRef.value ?? {}), roleId: "client", clientId: viewAsClientId.value };
    }
    return baseUserRef.value;
  });

  const role = computed<Role>(() =>
    normalizeRole((userRef.value as any)?.roleId)
  );
  // The effective client scope (only ever set for the 'client' role, real or
  // view-as-substituted) — for labelling; the real enforcement is server-side.
  const clientId = computed<string | null>(() => (userRef.value as any)?.clientId ?? null);

  const isDev = computed(() => role.value === "dev");
  const isAdmin = computed(() => role.value === "admin");
  const isSupervisor = computed(() => role.value === "supervisor");
  const isAgent = computed(() => role.value === "agent");
  const isUser = computed(() => role.value === "user");
  const isClient = computed(() => role.value === "client");

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
  // null = "no restriction, sees the full nav" (every role except client).
  // A non-null array is the exhaustive set of tabs that role may reach — both
  // for hiding nav items AND for the render-time content guard, so a client
  // (real or previewed) can't reach anything else by editing ?tab= directly.
  const allowedTabs = computed<readonly string[] | null>(() =>
    isClient.value ? CLIENT_ALLOWED_TABS : null
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
    clientId,
    isDev,
    isAdmin,
    isSupervisor,
    isAgent,
    isUser,
    isClient,
    canSeeDevTools,
    canSeeAdminTools,
    canImportData,
    canSeeAnything,
    allowedTabs,
    allowedAdminTables,
    hasRole,
    // View-as controls — only meaningful/shown for the real dev/admin, never
    // affected by the substitution above (so the "exit" control stays visible
    // while previewing).
    realCanUseViewAs,
    viewingAs,
    viewAsClientId,
    viewAsClientName,
    setViewAs,
  };
}
