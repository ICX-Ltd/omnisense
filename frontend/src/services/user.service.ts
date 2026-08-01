import api from "@/services/api";

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  displayName: string | null;
  roleId: string | null;
  active: boolean;
  lastLoggedInDate: string | null;
};

export type RoleDef = {
  id: string;
  label: string;
  description: string;
};

/**
 * The roles come from the backend rather than a hardcoded list here — there is
 * no roles table, so backend/src/modules/user/roles.ts is the definition, and
 * serving it keeps the dropdown and the server-side validation in step.
 */
export async function listRoles(): Promise<RoleDef[]> {
  const { data } = await api.get<RoleDef[]>("/uiapi/users/meta/roles");
  return data ?? [];
}

export async function createUser(payload: {
  email: string;
  displayName: string;
  password: string;
  roleId?: string;
}) {
  const { data } = await api.post("/uiapi/users/create", payload);
  return data;
}

/** Change a user's role. Rejected by the server if you target yourself. */
export async function updateUserRole(id: string, roleId: string) {
  const { data } = await api.patch(`/uiapi/users/${id}/role`, { roleId });
  return data;
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data } = await api.get("/uiapi/users");
  return data ?? [];
}

export async function adminResetPassword(id: string, newPassword: string) {
  const { data } = await api.patch(`/uiapi/users/${id}/password`, {
    newPassword,
  });
  return data;
}
