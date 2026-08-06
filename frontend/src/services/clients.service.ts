import api from "@/services/api";

export type ClientDef = {
  id: string;
  name: string;
  key: string;
  active: boolean;
  createdAt: string;
};

export async function listClients(includeInactive = false): Promise<ClientDef[]> {
  const { data } = await api.get<ClientDef[]>("/uiapi/clients", {
    params: includeInactive ? { includeInactive: "true" } : undefined,
  });
  return data ?? [];
}

export async function createClient(name: string, key: string) {
  const { data } = await api.post("/uiapi/clients", { name, key });
  return data;
}

export async function renameClient(id: string, name: string) {
  const { data } = await api.patch(`/uiapi/clients/${id}`, { name });
  return data;
}

export async function setClientActive(id: string, active: boolean) {
  const { data } = await api.patch(`/uiapi/clients/${id}/active`, { active });
  return data;
}
