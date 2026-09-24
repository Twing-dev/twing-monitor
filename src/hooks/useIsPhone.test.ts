/**
 * `useIsPhone`. The case that matters most is the one with no `matchMedia`
 * at all: that is what jsdom gives every other test in this repo, and it is
 * what keeps the whole existing suite on the desktop path while the phone
 * layout is added around it.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsPhone } from "./useIsPhone.js";
import { PHONE_MAX_WIDTH, PHONE_MEDIA_QUERY } from "../lib/breakpoints.js";

/** A controllable `MediaQueryList`, so a test can move the viewport. */
function stubMatchMedia(initial: boolean, { legacy = false } = {}) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const list = {
    matches: initial,
    media: PHONE_MEDIA_QUERY,
    addEventListener: legacy ? undefined : (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeEventListener: legacy ? undefined : (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    addListener: (fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
    removeListener: (fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
  };
  const matchMedia = vi.fn(() => list);
  vi.stubGlobal("matchMedia", matchMedia);
  return {
    matchMedia,
    listenerCount: () => listeners.size,
    /** Simulate a rotation or a window resize. */
    set(matches: boolean) {
      list.matches = matches;
      for (const fn of listeners) fn({ matches } as MediaQueryListEvent);
    },
  };
}

describe("useIsPhone", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The load-bearing case: jsdom has no matchMedia, so every existing test
  // in this repo keeps rendering the desktop layout unchanged.
  it("is false when matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
  });

  it("reports a phone-width viewport", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);
  });

  it("reports a desktop viewport", () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
  });

  // Without this the app keeps whichever layout it started in -- rotate a
  // phone to landscape and the master/detail split never comes back.
  it("follows the viewport when it changes", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);

    act(() => media.set(true));
    expect(result.current).toBe(true);

    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  // Older WebKit has addListener but not addEventListener; missing this
  // means it silently never updates there.
  it("falls back to the legacy listener API", () => {
    const media = stubMatchMedia(false, { legacy: true });
    const { result } = renderHook(() => useIsPhone());

    act(() => media.set(true));
    expect(result.current).toBe(true);
  });

  it("unsubscribes on unmount, both API shapes", () => {
    for (const legacy of [false, true]) {
      const media = stubMatchMedia(false, { legacy });
      const { unmount } = renderHook(() => useIsPhone());
      expect(media.listenerCount()).toBe(1);
      unmount();
      expect(media.listenerCount()).toBe(0);
      vi.unstubAllGlobals();
    }
  });

  it("asks for the same query the stylesheet uses", () => {
    const media = stubMatchMedia(false);
    renderHook(() => useIsPhone());
    expect(media.matchMedia).toHaveBeenCalledWith(PHONE_MEDIA_QUERY);
    // Pinned, because `index.css` hard-codes the number: if this changes
    // without the stylesheet, a back button appears on a two-pane layout.
    expect(PHONE_MEDIA_QUERY).toBe("(max-width: 640px)");
    expect(PHONE_MAX_WIDTH).toBe(640);
  });
});
