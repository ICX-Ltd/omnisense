// Dashboard components import the raw `axios` package directly (not the
// pre-configured `api` instance in `./api.ts`), so those requests carried no
// auth at all. This attaches the same Bearer-token behaviour to the raw
// singleton, plus the X-View-As-Client header when an admin/dev is previewing
// a client's view — imported once, for side effects only, from main.ts.
import axios, { type InternalAxiosRequestConfig } from "axios";
import { getViewAsClientId } from "../composables/useAccess";

axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem("accessToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const viewAsClientId = getViewAsClientId();
  if (viewAsClientId) {
    config.headers["X-View-As-Client"] = viewAsClientId;
  }
  return config;
});
