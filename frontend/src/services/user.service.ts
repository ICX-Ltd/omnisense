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

export async function createUser(payload: {
  email: string;
  displayName: string;
  password: string;
}) {
  const { data } = await api.post("/uiapi/users/create", payload);
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
