import { createContext, useCallback, useState, type ReactNode } from "react";
import { loadStoredAuth, saveAuth, clearAuth, type StoredAuth } from "./storage.js";

export interface AuthContextValue {
  auth: StoredAuth | null;
  /** Persists to localStorage and updates state in one call -- callers
   * (LoginScreen) never touch storage.ts directly. */
  login: (serverUrl: string, authToken: string, developerId: string) => void;
  /** Also the 401 path: `useApiFetch` (client.ts) calls this itself when a
   * request comes back unauthorized, so an expired/revoked token drops the
   * whole app back to LoginScreen rather than every view separately
   * noticing its own fetch failed. */
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function ServerProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(() => loadStoredAuth());

  const login = useCallback((serverUrl: string, authToken: string, developerId: string) => {
    saveAuth(serverUrl, authToken, developerId);
    setAuth({ serverUrl, authToken, developerId });
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setAuth(null);
  }, []);

  return <AuthContext.Provider value={{ auth, login, logout }}>{children}</AuthContext.Provider>;
}
