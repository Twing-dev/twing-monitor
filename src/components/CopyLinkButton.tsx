import { useState } from "react";

/** Sits as a sibling of a card's own toggle button (never nested inside it
 * -- a button-in-button is invalid HTML and would double-fire the toggle's
 * click), mirroring the sibling-control pattern RepoListView already uses
 * for its per-row checkbox. */
export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Best-effort only, same stance as RepoListView's saveStoredSelection
      // -- no clipboard access just means no "Copied!" feedback.
    }
  }

  return (
    <button type="button" className="card-copy-link" onClick={handleClick} title={copied ? "Copied!" : "Copy link"} aria-label={copied ? "Copied!" : "Copy link"}>
      {copied ? (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      )}
    </button>
  );
}
