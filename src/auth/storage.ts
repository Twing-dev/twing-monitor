/**
 * localStorage persistence for the dashboard's own auth state. Same
 * `{servers: {url: {authToken}}, activeServerUrl}` shape as `@twing/core`'s
 * `TwingConfig` (`~/.twing/config.json`) -- not shared storage (a browser
 * can't read that file), but the same mental model, and forward-compatible
 * with a future multi-coordinator switcher in this same UI without a
 * storage migration.
 */

const STORAGE_KEY = "twing-monitor:auth";

export interface StoredAuth {
  serverUrl: string;
  authToken: string;
  /** Captured once from `/v1/auth/whoami` at login time (`LoginScreen`) --
   * lets views like DesignsView filter to "mine" without a whoami round
   * trip of their own. */
  developerId: string;
}

interface StoredShape {
  servers: Record<string, { authToken: string; developerId: string }>;
  activeServerUrl: string;
}

function readRaw(): StoredShape | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredShape;
  } catch {
    return null;
  }
}

/** The one server this session is signed into. `servers` in `StoredShape`
 * only carries more than one entry once a multi-coordinator switcher
 * exists (not yet) -- today it's always exactly the active one. */
export function loadStoredAuth(): StoredAuth | null {
  const parsed = readRaw();
  if (!parsed?.activeServerUrl) return null;
  const entry = parsed.servers?.[parsed.activeServerUrl];
  // Checking the entry's existence, not `authToken`'s truthiness -- a
  // no-auth-mode session (LoginScreen's "this server has no auth" toggle)
  // stores `authToken: ""` with a self-declared `developerId` instead, and
  // that's a real signed-in session, not a signed-out one.
  if (!entry) return null;
  return { serverUrl: parsed.activeServerUrl, authToken: entry.authToken ?? "", developerId: entry.developerId };
}

/** Persists across browser restarts (localStorage, not sessionStorage) --
 * a locked-in v1 requirement, see the plan doc: no repeat-pasting a PAT
 * every time the tab closes. */
export function saveAuth(serverUrl: string, authToken: string, developerId: string): void {
  const parsed = readRaw() ?? { servers: {}, activeServerUrl: serverUrl };
  parsed.servers[serverUrl] = { authToken, developerId };
  parsed.activeServerUrl = serverUrl;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
}

export function clearAuth(): void {
  localStorage.removeItem(STORAGE_KEY);
}
