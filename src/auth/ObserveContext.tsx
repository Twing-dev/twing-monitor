import type { ReactNode } from "react";
import { AuthContext, type AuthContextValue } from "./ServerContext.js";

/**
 * Public "observe twing getting built" demo (2026-08-28): a second
 * `AuthContext` provider for the unauthenticated `/observe` route
 * (`ObserveApp.tsx`), reusing the exact same context object `ServerContext`
 * exports -- `useAuth()`/`useApiFetch()` and every view under
 * `RepoDetailLayout` work completely unchanged under either provider, they
 * never know which one they're mounted under.
 *
 * Deliberately NOT built on `ServerContext`/`storage.ts`: this page has no
 * real credential, nothing to persist, and no login/logout to perform --
 * `auth` is a single fixed value for the lifetime of the tab, and
 * `login`/`logout` are no-ops. Critically, this means `/observe` never
 * touches localStorage at all, so a real admin who happens to open the demo
 * link in the same browser never has their own cached session read,
 * overwritten, or cleared by it.
 *
 * `authToken: ""` is exactly the "no real token" wire shape
 * `apiFetch`/`useApiFetch` (`api/client.ts`) already sends as a plain empty
 * bearer value -- matching what the server's `publicProjectId` auth-
 * middleware branch (`app.ts`) treats as an unauthenticated GET. No changes
 * needed anywhere in `api/*.ts` to support this.
 */
const DEFAULT_SERVER_URL = import.meta.env.VITE_DEFAULT_SERVER_URL ?? "https://coordination-server.twing.dev";

const OBSERVE_AUTH: AuthContextValue = {
  auth: { serverUrl: DEFAULT_SERVER_URL, authToken: "", developerId: "public-viewer" },
  login: () => {},
  logout: () => {},
};

export function ObserveProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={OBSERVE_AUTH}>{children}</AuthContext.Provider>;
}
