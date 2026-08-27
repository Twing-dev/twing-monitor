import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "twing-monitor:theme";

function readStoredTheme(): Theme | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Defaults to dark -- the app's original, only palette -- unless a viewer
 * has explicitly switched to light before. Best-effort persistence only,
 * same stance as RepoListView's saveStoredSelection: a blocked localStorage
 * just means the choice doesn't survive a reload. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? "dark");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Best-effort only.
      }
      return next;
    });
  }, []);

  return [theme, toggle];
}
