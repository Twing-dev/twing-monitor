import { describe, it, expect } from "vitest";
import { loadStoredAuth, saveAuth, clearAuth } from "./storage.js";

describe("auth/storage", () => {
  it("round-trips through localStorage -- persists across a simulated restart (a fresh load call)", () => {
    expect(loadStoredAuth()).toBeNull();

    saveAuth("https://coordination-server.twing.dev", "my-pat", "alice@example.com");

    expect(loadStoredAuth()).toEqual({ serverUrl: "https://coordination-server.twing.dev", authToken: "my-pat", developerId: "alice@example.com" });
  });

  it("clearAuth removes it entirely", () => {
    saveAuth("https://coordination-server.twing.dev", "my-pat", "alice@example.com");
    clearAuth();
    expect(loadStoredAuth()).toBeNull();
  });

  it("saving a second server switches the active one", () => {
    saveAuth("https://a.example", "token-a", "alice@example.com");
    saveAuth("https://b.example", "token-b", "alice@example.com");
    expect(loadStoredAuth()).toEqual({ serverUrl: "https://b.example", authToken: "token-b", developerId: "alice@example.com" });
  });

  it("malformed localStorage content fails soft to null instead of throwing", () => {
    localStorage.setItem("twing-monitor:auth", "not json");
    expect(loadStoredAuth()).toBeNull();
  });

  it("an empty-string authToken (a no-auth-mode session) still counts as signed in", () => {
    saveAuth("https://coordination-server.twing.dev", "", "alice@example.com");
    expect(loadStoredAuth()).toEqual({ serverUrl: "https://coordination-server.twing.dev", authToken: "", developerId: "alice@example.com" });
  });
});
