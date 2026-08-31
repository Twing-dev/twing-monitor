import { useState, type FormEvent } from "react";
import { apiFetch, ApiError } from "../api/client.js";
import { useAuth } from "./useAuth.js";

const DEFAULT_SERVER_URL = import.meta.env.VITE_DEFAULT_SERVER_URL ?? "https://coordination-server.twing.dev";

function normalizeServerUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export function LoginScreen() {
  const { login } = useAuth();
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [token, setToken] = useState("");
  // §17 Phase 4: a coordinator started with `twing serve --no-auth` has no
  // PATs at all -- every request instead carries a self-declared
  // `X-Twing-Developer-Id` header (no verification, attribution only; see
  // apiFetch's `developerId` param). Explicit and unchecked by default,
  // never auto-detected/probed for -- mirrors `twing init --no-auth`'s own
  // philosophy (`@twing/core`'s `ServerAuth.noAuth`), since there's no
  // endpoint here that could tell "requires a PAT" apart from "doesn't"
  // without just trying one and seeing what comes back.
  const [noAuth, setNoAuth] = useState(false);
  const [developerId, setDeveloperId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const url = normalizeServerUrl(serverUrl);
    const pat = token.trim();
    const devId = developerId.trim();
    if (!url || (noAuth ? !devId : !pat)) return;

    setChecking(true);
    setError(null);
    try {
      // Validate against the real server before persisting anything --
      // saving a bad token would otherwise land the user on RepoListView's
      // own 401 error state instead of a clear "that didn't work" message
      // right here. Also doubles as how developerId gets captured (storage.ts)
      // -- one round trip, not a separate whoami call downstream. In
      // no-auth mode this doubles as confirmation the server actually *is*
      // running without auth (see the 401 branch below) -- the self-declared
      // devId travels as a header, never as `pat`, which stays "".
      const identity = await apiFetch<{ developerId: string }>(url, noAuth ? "" : pat, "/v1/auth/whoami", {}, noAuth ? devId : undefined);
      login(url, noAuth ? "" : pat, identity.developerId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && noAuth) {
        // The server didn't accept the (missing) bearer token -- meaning it
        // isn't actually running in no-auth mode, unlike what the checkbox
        // above claims. Distinct from the "rejected PAT" message below: no
        // token was even sent, so nothing was "rejected" by content.
        setError("This server requires a personal access token -- it doesn't look like it's running in no-auth mode. Uncheck the box above and paste your PAT instead.");
      } else if (err instanceof ApiError && err.status === 401) {
        setError("That token was rejected. Check you copied the whole PAT, and that it's for this server.");
      } else if (err instanceof ApiError) {
        setError(`Server responded with an error: ${err.message}`);
      } else {
        setError(`Couldn't reach ${url}. Check the server URL and your connection.`);
      }
    } finally {
      setChecking(false);
    }
  }

  function handleNoAuthToggle(next: boolean) {
    // Switching modes clears both the error and whichever field is about to
    // be hidden -- a stale PAT/devId from the other mode shouldn't silently
    // ride along into the next submit attempt.
    setNoAuth(next);
    setError(null);
    if (next) setToken("");
    else setDeveloperId("");
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>twing-monitor</h1>
        <p className="login-subtitle">Sign in with a personal access token to see your repos, designs, activity, and reviews.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="server-url">Coordinator URL</label>
          <input id="server-url" type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} spellCheck={false} autoCapitalize="off" />

          {noAuth ? (
            <>
              <label htmlFor="developer-id">Developer ID</label>
              <input
                id="developer-id"
                type="text"
                value={developerId}
                onChange={(e) => setDeveloperId(e.target.value)}
                placeholder="you@example.com -- self-declared, not verified"
                spellCheck={false}
                autoCapitalize="off"
              />
            </>
          ) : (
            <>
              <label htmlFor="pat">Personal access token</label>
              <input
                id="pat"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="paste your PAT"
                spellCheck={false}
                autoCapitalize="off"
              />
            </>
          )}

          <label className="login-checkbox">
            <input type="checkbox" checked={noAuth} onChange={(e) => handleNoAuthToggle(e.target.checked)} />
            This server has no auth
          </label>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={checking || !serverUrl.trim() || (noAuth ? !developerId.trim() : !token.trim())}>
            {checking ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-hint">
          No token yet? Run <code>twing init</code> in your repo, then <code>twing servers --show-token</code> to get the server URL and token to paste
          above.
        </p>
        {/* Public "observe twing getting built" demo (2026-08-28): a plain
            link, not a button/action -- /observe is its own unauthenticated
            route (App.tsx's pathname branch), reached by a normal
            navigation, not a client-side view switch the way sign-in is. */}
        <p className="login-hint">
          Just curious? <a href="/observe">Observe twing getting built</a> -- no sign-in needed.
        </p>
      </div>
    </div>
  );
}
