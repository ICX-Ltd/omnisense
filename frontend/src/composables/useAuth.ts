import { computed, ref } from "vue";

export type User = {
  id: string;
  name?: string;
  email?: string;
  roleId?: string | null;
  tagList?: Record<string, any> | null;
};

export type LoginOk = {
  twoFactorRequired: false;
  accessToken: string;
  refreshToken: string;
  user: User;
};

export type LoginNeeds2FA = {
  twoFactorRequired: true;
  twoFactorToken: string;
};

export type LoginResponse = LoginOk | LoginNeeds2FA;

const userRef = ref<User | null>(null);
const accessTokenRef = ref<string | null>(localStorage.getItem("accessToken"));
const refreshTokenRef = ref<string | null>(
  localStorage.getItem("refreshToken")
);

function isGuid(value: string) {
  return /^[0-9a-fA-F-]{36}$/.test(value);
}

function setSession(
  accessToken: string,
  refreshToken?: string,
  user?: User | null
) {
  accessTokenRef.value = accessToken;
  localStorage.setItem("accessToken", accessToken);

  if (refreshToken) {
    refreshTokenRef.value = refreshToken;
    localStorage.setItem("refreshToken", refreshToken);
  }

  if (user !== undefined) {
    userRef.value = user;
  }
}

function clearSession() {
  userRef.value = null;
  accessTokenRef.value = null;
  refreshTokenRef.value = null;
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
}

async function parseError(res: Response, fallback: string) {
  const text = await res.text().catch(() => "");
  if (!text) return fallback;
  try {
    const json = JSON.parse(text);
    // NestJS validation errors return message as string or string[]
    const msg = json.message;
    if (Array.isArray(msg)) return msg.join(". ");
    if (typeof msg === "string") return msg;
  } catch { /* not JSON — fall through */ }
  return fallback;
}

export function useAuth() {
  const user = computed(() => userRef.value);
  const accessToken = computed(() => accessTokenRef.value);
  const refreshToken = computed(() => refreshTokenRef.value);
  const isAuthenticated = computed(
    () => !!accessTokenRef.value && !!userRef.value
  );

  async function login(
    identifier: string,
    password: string
  ): Promise<LoginResponse> {
    const body = isGuid(identifier)
      ? { id: identifier, password }
      : { email: identifier, password };

    const res = await fetch("/uiapi/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(await parseError(res, "Login failed"));
    }

    const data = (await res.json()) as LoginResponse;

    if (data.twoFactorRequired) {
      return data;
    }

    setSession(data.accessToken, data.refreshToken, data.user);
    return data;
  }

  async function verify2fa(twoFactorToken: string, code: string) {
    const res = await fetch("/uiapi/auth/2fa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ twoFactorToken, code }),
    });

    if (!res.ok) {
      throw new Error(await parseError(res, "2FA verification failed"));
    }

    const data = (await res.json()) as LoginOk;
    setSession(data.accessToken, data.refreshToken, data.user);
    return data;
  }

  async function refresh() {
    const token = refreshTokenRef.value || localStorage.getItem("refreshToken");
    if (!token) {
      clearSession();
      return false;
    }

    const res = await fetch("/uiapi/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: token }),
    });

    if (!res.ok) {
      clearSession();
      return false;
    }

    const data = (await res.json()) as { accessToken: string };
    setSession(data.accessToken);
    return true;
  }

  async function fetchMe(token: string) {
    const res = await fetch("/uiapi/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return null;
    }

    return (await res.json()) as User;
  }

  async function restore() {
    const token = accessTokenRef.value || localStorage.getItem("accessToken");
    if (!token) {
      clearSession();
      return false;
    }

    const me = await fetchMe(token);
    if (me) {
      accessTokenRef.value = token;
      userRef.value = me;
      return true;
    }

    const refreshed = await refresh();
    if (!refreshed) {
      return false;
    }

    const newToken = accessTokenRef.value;
    if (!newToken) {
      clearSession();
      return false;
    }

    const freshMe = await fetchMe(newToken);
    if (!freshMe) {
      clearSession();
      return false;
    }

    userRef.value = freshMe;
    return true;
  }

  function logout() {
    clearSession();
  }

  return {
    user,
    accessToken,
    refreshToken,
    isAuthenticated,
    login,
    verify2fa,
    refresh,
    restore,
    logout,
  };
}
