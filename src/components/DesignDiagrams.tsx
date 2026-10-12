import { useEffect, useId, useState } from "react";
import type { Fetcher } from "../api/client.js";
import type { DesignDiagram } from "../api/types.js";
import { fetchDesignDiagrams, repairDesignDiagram } from "../api/designs.js";
import { useAsyncData } from "../hooks/useAsyncData.js";

/**
 * Optional diagrams under a design's Problem / Approach (2026-10-11): one tab
 * per diagram the coordinator decided was worth drawing (Flow, Sequence,
 * Structure). Most designs get none, and then this renders nothing at all.
 *
 * - Mermaid is loaded with a dynamic import, only once a diagram is on
 *   screen, so it costs the main bundle nothing.
 * - Only the open tab is drawn: a diagram drawn inside a hidden container
 *   comes out broken (seen while building the mocks).
 * - The text is model output, so Mermaid runs with `securityLevel: "strict"`
 *   (no scripts, links or HTML in labels).
 * - A diagram the browser can't parse is hidden, never shown broken. A
 *   generated one is sent back once to be regenerated with the parse error;
 *   an author-drawn one can't be redrawn here, so it just stays hidden.
 * - The footer says who drew it: the author's coding session (which read the
 *   code) or the coordinator (which only saw the declared plan).
 */
export function DesignDiagrams({ apiFetch, designId }: { apiFetch: Fetcher; designId: string }) {
  const state = useAsyncData(() => fetchDesignDiagrams(apiFetch, designId), [apiFetch, designId]);
  const [replaced, setReplaced] = useState<Record<string, DesignDiagram>>({});
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string | undefined>();

  const diagrams = state.status === "ready" ? state.data.diagrams.map((d) => replaced[d.id] ?? d).filter((d) => !hidden[d.id]) : [];
  const current = diagrams.find((d) => d.id === active) ?? diagrams[0];
  if (!current) return null;

  const onRenderError = (diagram: DesignDiagram, message: string) => {
    setHidden((h) => ({ ...h, [diagram.id]: true }));
    // Only a generated diagram can be redrawn, and only once.
    if (diagram.source !== "generated" || replaced[diagram.id]) return;
    repairDesignDiagram(apiFetch, designId, diagram.type, message)
      .then(({ diagram: fixed }) => {
        if (!fixed) return;
        setReplaced((r) => ({ ...r, [diagram.id]: fixed }));
        setHidden((h) => ({ ...h, [diagram.id]: false }));
      })
      .catch(() => {});
  };

  return (
    <div className="design-diagrams">
      <div className="design-diagrams-tabs" role="tablist">
        {diagrams.map((d) => (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={d.id === current.id}
            className={d.id === current.id ? "on" : undefined}
            title={d.reason || undefined}
            onClick={() => setActive(d.id)}
          >
            {d.title}
          </button>
        ))}
      </div>
      <MermaidView key={`${current.id}:${current.mermaid}`} diagram={current} onError={(message) => onRenderError(current, message)} />
      <div className="design-diagrams-foot">
        {current.source === "author" ? "Drawn by the author's coding session" : "Generated from the plan and declared changes · may be simplified"}
      </div>
    </div>
  );
}

type MermaidApi = typeof import("mermaid").default;
let mermaidLoad: Promise<MermaidApi> | undefined;

/** Loads and configures Mermaid once, on first use. */
function loadMermaid(): Promise<MermaidApi> {
  mermaidLoad ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: {
        fontFamily: "Nunito, sans-serif",
        fontSize: "14px",
        primaryColor: "#fff6e9",
        primaryBorderColor: "#e5d9c3",
        primaryTextColor: "#211f2e",
        lineColor: "#9a94a8",
        secondaryColor: "#ffe3e9",
        tertiaryColor: "#f4f1ea",
        actorBkg: "#fff6e9",
        actorBorder: "#e5d9c3",
      },
      flowchart: { curve: "basis" },
      sequence: { mirrorActors: false },
    });
    return mermaid;
  });
  return mermaidLoad;
}

function MermaidView({ diagram, onError }: { diagram: DesignDiagram; onError: (message: string) => void }) {
  const id = `design-diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(async (mermaid) => {
        await mermaid.parse(diagram.mermaid);
        const { svg: rendered } = await mermaid.render(id, diagram.mermaid);
        if (!cancelled) setSvg(rendered);
      })
      .catch((err: unknown) => {
        if (!cancelled) onError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // Re-render only when the diagram itself changes; `onError` is a fresh
    // closure every render and must not restart the drawing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagram.mermaid, id]);

  if (!svg) return <div className="design-diagrams-canvas design-diagrams-loading">Drawing diagram…</div>;
  // Mermaid's strict mode sanitizes its own SVG output.
  return <div className="design-diagrams-canvas" dangerouslySetInnerHTML={{ __html: svg }} />;
}
