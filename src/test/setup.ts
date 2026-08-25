import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Web Storage polyfill for the test environment (2026-08-25).
 *
 * On Node 26 the whole suite failed -- 70 of 70, across every file -- with
 * "Cannot read properties of undefined (reading 'getItem')", despite
 * `environment: "jsdom"` being set correctly in vite.config.ts and jsdom
 * being installed. Probing the environment showed why: both
 * `globalThis.localStorage` and `window.localStorage` are `undefined`
 * there, so jsdom isn't supplying Web Storage at all under this Node, and
 * Node's own experimental `localStorage` global is inert without the
 * --localstorage-file flag. There was nothing to point the global at.
 *
 * So this supplies one. It's a faithful, minimal `Storage`: string
 * coercion on both keys and values, `length`/`key()` for completeness, and
 * plain own-property semantics. Test infrastructure only -- no application
 * code changes, and nothing here ships. It also self-heals: if a future
 * Node or jsdom starts providing real Web Storage again, the check below
 * leaves it alone.
 */
function installStorage(): void {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      return store.get(String(key)) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(String(key), String(value));
    },
    removeItem(key: string): void {
      store.delete(String(key));
    },
    clear(): void {
      store.clear();
    },
  };

  for (const target of [globalThis, globalThis.window].filter(Boolean)) {
    Object.defineProperty(target, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
}

if (typeof globalThis.localStorage?.getItem !== "function") {
  installStorage();
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
