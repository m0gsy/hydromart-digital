'use client';

import { endpoints } from './endpoints';
import { getSession, setSession } from './session-store';
import type { Session } from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Flatten NestJS error bodies ({ message: string | string[] }) into one line. */
function messageFrom(status: number, body: unknown): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string') return m;
  }
  if (status === 0) return 'Cannot reach the server. Check your connection and try again.';
  return `Request failed (${status}).`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** internal: prevents an infinite refresh loop */
  _retry?: boolean;
}

// Single-flight refresh: concurrent 401s share one refresh round-trip.
let refreshing: Promise<Session | null> | null = null;

async function refreshSession(): Promise<Session | null> {
  const session = getSession();
  if (!session?.refreshToken) return null;
  if (!refreshing) {
    refreshing = rawRequest<Session>(endpoints.auth.refresh, {
      method: 'POST',
      body: { refreshToken: session.refreshToken },
    })
      .then((next) => {
        setSession(next);
        return next;
      })
      .catch(() => {
        setSession(null);
        return null;
      })
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = getSession()?.accessToken;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, messageFrom(0, null));
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) throw new ApiError(res.status, messageFrom(res.status, data));
  return data as T;
}

/** Authenticated request with transparent refresh-and-retry on 401. */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && options.auth && !options._retry) {
      const next = await refreshSession();
      if (next) return rawRequest<T>(path, { ...options, _retry: true });
    }
    throw err;
  }
}

/**
 * Multipart upload (always authenticated). The JSON `api` helpers force a JSON
 * Content-Type, so file uploads need this path: it lets the browser set the
 * multipart boundary and attaches the bearer token. No 401 refresh-retry — the
 * caller loads its data with `api` first, so the token is already fresh.
 */
export async function uploadFile<T = { url: string }>(path: string, file: File | Blob): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const token = getSession()?.accessToken;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
  } catch {
    throw new ApiError(0, messageFrom(0, null));
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, messageFrom(res.status, data));
  return data as T;
}

export const api = {
  get: <T>(path: string, auth = false) => request<T>(path, { auth }),
  post: <T>(path: string, body?: unknown, auth = false) =>
    request<T>(path, { method: 'POST', body, auth }),
  put: <T>(path: string, body?: unknown, auth = false) =>
    request<T>(path, { method: 'PUT', body, auth }),
  patch: <T>(path: string, body?: unknown, auth = false) =>
    request<T>(path, { method: 'PATCH', body, auth }),
  del: <T>(path: string, auth = false) => request<T>(path, { method: 'DELETE', auth }),
};
