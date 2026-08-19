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
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const url = normalizeServerUrl(serverUrl);
    const pat = token.trim();
    if (!url || !pat) return;

    setChecking(true);
    setError(null);
    try {
      // Validate against the real server before persisting anything --
      // saving a bad token would otherwise land the user on RepoListView's
      // own 401 error state instead of a clear "that didn't work" message
      // right here. Also doubles as how developerId gets captured (storage.ts)
      // -- one round trip, not a separate whoami call downstream.
      const identity = await apiFetch<{ developerId: string }>(url, pat, "/v1/auth/whoami");
      login(url, pat, identity.developerId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
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

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>twing-monitor</h1>
        <p className="login-subtitle">Sign in with a personal access token to see your repos, designs, activity, and reviews.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="server-url">Coordinator URL</label>
          <input id="server-url" type="text" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} spellCheck={false} autoCapitalize="off" />

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

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={checking || !token.trim() || !serverUrl.trim()}>
            {checking ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-hint">
          No token yet? Run <code>twing keygen --invite &lt;code&gt;</code> or <code>twing login --token &lt;pat&gt;</code> from the CLI.
        </p>
      </div>
    </div>
  );
}
