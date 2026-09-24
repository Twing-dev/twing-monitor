/**
 * Whether this is a phone-width viewport, as a subscription rather than a
 * one-off read -- so rotating the device, or dragging a desktop window
 * narrow, re-lays-out instead of leaving the app in whichever mode it
 * happened to start in.
 *
 * **Returns `false` when `matchMedia` is missing**, which is what jsdom
 * gives every test in this repo. That is deliberate and load-bearing: it
 * means the whole existing suite keeps exercising the desktop path with no
 * change, so a desktop regression from the phone work shows up as a failing
 * test rather than as something to spot by eye. A test that wants the phone
 * path stubs `matchMedia` explicitly.
 */

import { useEffect, useState } from "react";
import { PHONE_MEDIA_QUERY } from "../lib/breakpoints.js";

function read(): boolean {
  // `window.matchMedia` is absent in jsdom and in any non-browser render.
  // Absent means "not a phone" -- the layout that has always worked.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(PHONE_MEDIA_QUERY).matches;
}

export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(read);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(PHONE_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsPhone(event.matches);

    // Re-read on subscribe as well as on change: between the initial
    // `useState` and this effect the viewport may already have moved (a
    // rotation during hydration, a restored window size), and a listener
    // alone would not catch a change that already happened.
    setIsPhone(list.matches);

    // `addEventListener` is the modern form; `addListener` is kept for
    // older WebKit, where the modern one is missing rather than merely
    // deprecated. Without it this silently never updates on those browsers.
    if (typeof list.addEventListener === "function") {
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    }
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, []);

  return isPhone;
}
