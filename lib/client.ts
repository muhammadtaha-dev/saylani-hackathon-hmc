"use client";

// Frontend API client: sends cookies + bearer token, maps the standard error
// envelope to a typed error, never lets the server response shape leak.
export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: Array<{ field: string; reason: string }>;
  constructor(status: number, code: string, message: string, details?: Array<{ field: string; reason: string }>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const TOKEN_KEY = "hcm_token";

export function saveToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit & { raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (init.body && typeof init.body === "string") headers["Content-Type"] = headers["Content-Type"] || "application/json";
  const res = await fetch(path, { ...init, headers, credentials: "include" });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: Array<{ field: string; reason: string }> } })?.error;
    throw new ApiClientError(res.status, err?.code || "REQUEST_FAILED", err?.message || `Request failed (${res.status})`, err?.details);
  }
  if (init.raw) return text as unknown as T;
  return ((json as { data?: unknown })?.data ?? json) as T;
}

export const api = {
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body === undefined ? "{}" : JSON.stringify(body) }),
  put: <T,>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: body === undefined ? "{}" : JSON.stringify(body) }),
  patch: <T,>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: body === undefined ? "{}" : JSON.stringify(body) }),
  del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  raw: {
    post: (path: string, body: string, contentType: string) =>
      request<unknown>(path, { method: "POST", body, headers: { "Content-Type": contentType } }),
  },
};

export function qs(params: Record<string, string | number | null | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return entries.length ? "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
}
