/**
 * Thin fetch wrapper for the coordinator's `/v1/*` API. Centralizes the two
 * things every call site would otherwise repeat: attaching the bearer PAT,
 * and turning a non-2xx response into a typed `ApiError` (the server's own
 * `{error: string}` body when present, falling back to the HTTP status text
 * when the body isn't JSON -- e.g. a proxy-level 502).
 */

import { useCallback } from "react";
import { useAuth } from "../auth/useAuth.js";

export class ApiError extends Error {
  // Not a constructor parameter property -- tsconfig's `erasableSyntaxOnly`
  // (TS 6's Node type-stripping-compatible mode) disallows that shorthand
  // since it emits real assignment code, not just types.
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(serverUrl: string, authToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
      authorization: `Bearer ${authToken}`,
    },
  });

  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error) message = body.error;
    } catch {
      // Non-JSON error body (e.g. a plain-text 502 from an edge proxy) --
      // the statusText/status fallback above already covers this.
    }
    throw new ApiError(res.status, message);
  }

  // A handful of routes (e.g. a bare `DELETE`) may return no body -- guard
  // rather than let `res.json()` throw on an empty string.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The bound, auth-attached fetcher `useApiFetch()` returns -- what every
 * `api/*.ts` query function (`fetchDesigns`, `fetchReviews`, ...) takes as
 * its first argument instead of a raw `serverUrl`/`authToken` pair, so a
 * view only ever needs one `useApiFetch()` call to drive every query it
 * makes. */
export type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Every view calls the coordinator through this, never `apiFetch`
 * directly -- it's what makes a 401 (expired/revoked PAT) drop the whole
 * app back to `LoginScreen` in one place, instead of each view separately
 * noticing its own fetch failed and rendering its own dead-end error
 * state. */
export function useApiFetch(): Fetcher {
  const { auth, logout } = useAuth();
  return useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!auth) throw new ApiError(401, "not signed in");
      try {
        return await apiFetch<T>(auth.serverUrl, auth.authToken, path, init);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) logout();
        throw err;
      }
    },
    [auth, logout],
  );
}
