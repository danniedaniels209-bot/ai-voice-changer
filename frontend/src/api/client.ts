import type { ApiErrorBody } from "../types/api";

// --- Backend target resolution -------------------------------------------
// Cloud GPU mode (Settings page) stores a remote URL + token in
// localStorage on THIS device. When off (default), the backend is local:
// same-origin when the backend serves the built frontend, or the dev
// backend when running under Vite.
const remoteUrl = localStorage.getItem("avc_remote_url");
const remoteEnabled = localStorage.getItem("avc_remote_enabled") === "1" && !!remoteUrl;

const isViteDev =
  window.location.port === "5173" ||
  window.location.port === "5174" ||
  window.location.port === "5175";
const localBase = isViteDev ? "http://127.0.0.1:8000" : "";

export const API_BASE_URL = remoteEnabled ? remoteUrl!.replace(/\/+$/, "") : localBase;
export const REMOTE_BACKEND_ACTIVE = remoteEnabled;

function toWsBase(httpBase: string): string {
  if (httpBase === "") {
    const proto = window.location.protocol === "https:" ? "wss://" : "ws://";
    return `${proto}${window.location.host}`;
  }
  return httpBase.replace(/^http/, "ws");
}

const authToken = remoteEnabled ? localStorage.getItem("avc_remote_token") : null;

export const WS_BASE_URL = toWsBase(API_BASE_URL);
/** Append to WebSocket URLs so a token-protected backend accepts them. */
export const WS_AUTH_SUFFIX = authToken ? `?token=${encodeURIComponent(authToken)}` : "";

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  if (authToken) headers["X-AVC-Token"] = authToken;
  return headers;
}

export class ApiError extends Error {
  code: string;
  details: Record<string, unknown>;
  status: number;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let body: ApiErrorBody;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(response.status, {
        error: { code: "unknown_error", message: response.statusText, details: {} },
      });
    }
    throw new ApiError(response.status, body);
  }
  return response.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders() });
  return handleResponse<T>(response);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: authHeaders(body !== undefined ? { "Content-Type": "application/json" } : undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(response);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return handleResponse<T>(response);
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return handleResponse<T>(response);
}

/** True when traffic flows through a Cloudflare quick tunnel, which caps
 * request bodies at ~100 MB — large uploads must be warned about upfront. */
export const TUNNEL_ACTIVE =
  window.location.host.endsWith(".trycloudflare.com") ||
  (REMOTE_BACKEND_ACTIVE && (remoteUrl ?? "").includes(".trycloudflare.com"));

export function apiUpload<T>(
  path: string,
  formData: FormData,
  onProgress?: (percent: number) => void,
): Promise<T> {
  // XMLHttpRequest instead of fetch: it's the only way to observe upload
  // progress, and large videos over a slow uplink NEED visible progress.
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}${path}`);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
        else reject(new ApiError(xhr.status, body));
      } catch {
        reject(
          new ApiError(xhr.status, {
            error: {
              code: "unknown_error",
              message:
                xhr.status === 413
                  ? "The upload was rejected as too large (tunnel connections cap uploads at ~100 MB)."
                  : xhr.statusText || "Upload failed",
              details: {},
            },
          }),
        );
      }
    };
    xhr.onerror = () =>
      reject(
        new ApiError(0, {
          error: {
            code: "network_error",
            message:
              "Upload failed — connection lost or rejected. Tunnel connections cap uploads at ~100 MB.",
            details: {},
          },
        }),
      );
    xhr.send(formData);
  });
}
