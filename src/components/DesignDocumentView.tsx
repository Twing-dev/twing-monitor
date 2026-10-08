import { useEffect, useState, type ReactNode } from "react";
import { ApiError, useApiFetch } from "../api/client.js";
import { fetchDesignDocument, regenerateDesignDocument } from "../api/designs.js";
import type { DesignDocumentResponse } from "../api/types.js";
import { Markdown } from "./Markdown.js";
import { useDocumentReview } from "./DesignReview.js";

const SECTIONS = [
  ["problemStatement", "Problem statement"],
  ["solutionAbstract", "Solution abstract"],
  ["fullSolution", "Full solution"],
  ["implementationDetails", "Implementation details"],
  ["risksAndLimitations", "Risks and limitations"],
  ["validation", "Validation"],
] as const;

/** Fetch once per group, independently of list pagination. Generated prose is
 * read-only; review anchors refer to its own sections and published revision. */
export function DesignDocumentView({ designId, sourceKey, readOnly, children }: {
  designId: string;
  sourceKey?: string;
  readOnly?: boolean;
  children?: (hasDocument: boolean) => ReactNode;
}) {
  const apiFetch = useApiFetch();
  const [loaded, setLoaded] = useState<{ designId: string; document?: DesignDocumentResponse; message?: string }>();
  const document = loaded?.designId === designId ? loaded.document : undefined;
  const message = loaded?.designId === designId ? loaded.message : undefined;
  const [requestError, setRequestError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useDocumentReview(document);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await fetchDesignDocument(apiFetch, designId);
        if (cancelled) return;
        // An older coordinator may have no document endpoint.
        setLoaded({ designId, document: next?.status ? next : undefined });
        if (!next?.status) return;
        if (next.status === "pending" || next.status === "running" || next.status === "ready") {
          timer = setTimeout(() => { void load(); }, next.status === "ready" ? 10_000 : 2_000);
        }
      } catch (error) {
        if (cancelled) return;
        setLoaded({ designId, message: error instanceof ApiError && error.status === 404 ? undefined
          : error instanceof ApiError && error.status === 403
            ? "The shared document requires access to every source repository."
            : "Couldn't load the design document. The original designs are still available below." });
      }
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [apiFetch, designId, sourceKey, refresh]);

  const regenerate = async () => {
    setRequesting(true);
    setRequestError("");
    try {
      await regenerateDesignDocument(apiFetch, designId);
      setRefresh((value) => value + 1);
    } catch {
      setRequestError("Couldn't request a document. Try again.");
    } finally { setRequesting(false); }
  };

  const content = document?.content;
  const generating = document?.status === "pending" || document?.status === "running";
  const unavailable = document?.status === "failed" || document?.status === "unavailable";
  const canRequest = document && !readOnly && !generating && (document.status === "missing" || unavailable || document.stale);

  return <>
    {(document || message) && <section className="design-document" aria-label="Design document">
      {content && document && <>
        <h2 className="design-document-title">{content.title}</h2>
        {SECTIONS.map(([key, label]) => content.sections[key]?.trim() ? <section key={key} className="design-document-section">
          <h3>{label}</h3>
          <Markdown source={content.sections[key]} designId={designId} field={`document:${key}`}
            documentGroupId={document.groupId} documentRevision={document.revision} />
        </section> : null)}
      </>}
      <div className="design-document-state" aria-live="polite">
        {document?.stale && <p>This document reflects an earlier version of the designs.</p>}
        {generating && <p>Preparing the design document…</p>}
        {unavailable && <p>A document couldn't be prepared. You can still read the original designs below.</p>}
        {message && <p>{message}</p>}
        {canRequest && <button type="button" className="link-button" disabled={requesting} onClick={() => { void regenerate(); }}>
          {requesting ? "Requesting…" : document.status === "missing" ? "Generate design document" : "Retry document generation"}
        </button>}
        {requestError && <p role="alert">{requestError}</p>}
      </div>
    </section>}
    {children?.(Boolean(content))}
  </>;
}
