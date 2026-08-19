import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "./ServerContext.js";

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() called outside <ServerProvider>");
  return ctx;
}
