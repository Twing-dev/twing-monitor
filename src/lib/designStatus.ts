import type { BadgeTone } from "../components/StatusBadge.js";
import type { DesignStatement } from "../api/types.js";

/** Shared status -> badge tone mapping for a `DesignStatement`. Extracted
 * out of `DesignsView.tsx` (its original, only caller) so `ActivityView`'s
 * grouped-by-design rows can badge a design's status the same way the
 * Designs tab itself does, instead of a second, drifting copy of this
 * switch. Not to be confused with `AlignmentThreadsView.tsx`'s own
 * same-named local helper -- that one tones a *thread's* "open"/"closed"
 * status, a different domain entirely. */
export function toneForDesignStatus(status: DesignStatement["status"]): BadgeTone {
  switch (status) {
    case "open":
      return "good";
    case "flagged":
      return "warning";
    case "dormant":
      return "neutral";
    default:
      return "neutral";
  }
}
