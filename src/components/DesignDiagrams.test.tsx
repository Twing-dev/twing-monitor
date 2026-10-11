import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DesignDiagram } from "../api/types.js";

// Mermaid needs real layout; the component's contract is what it does with
// Mermaid's answers, so the library itself is stubbed.
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(async (_text: string) => true),
  render: vi.fn(async (_id: string, text: string) => ({ svg: `<svg data-src="${text.split("\n")[0]}"></svg>` })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

import { DesignDiagrams } from "./DesignDiagrams.js";

const FLOW: DesignDiagram = { type: "flow", title: "Flow", mermaid: "flowchart LR\n  a[A] --> b[B]", reason: "moves data" };
const SEQ: DesignDiagram = { type: "sequence", title: "Sequence (UML)", mermaid: "sequenceDiagram\n  A->>B: hi", reason: "calls" };

function fetcherFor(diagrams: DesignDiagram[], repair: DesignDiagram | null = null) {
  return vi.fn(async (path: string) => (path.endsWith("/repair") ? { diagram: repair } : { diagrams })) as never;
}

beforeEach(() => {
  mermaid.parse.mockReset().mockResolvedValue(true);
});

describe("DesignDiagrams", () => {
  it("renders nothing when the coordinator returned no diagrams", async () => {
    const fetcher = fetcherFor([]);
    const { container } = render(<DesignDiagrams apiFetch={fetcher} designId="d1" />);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a tab only for each returned type and draws the open one", async () => {
    render(<DesignDiagrams apiFetch={fetcherFor([FLOW, SEQ])} designId="d1" />);
    expect(await screen.findByRole("tab", { name: "Flow" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Sequence (UML)" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Structure (UML)" })).not.toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('svg[data-src="flowchart LR"]')).not.toBeNull());

    await userEvent.click(screen.getByRole("tab", { name: "Sequence (UML)" }));
    await waitFor(() => expect(document.querySelector('svg[data-src="sequenceDiagram"]')).not.toBeNull());
  });

  it("hides a diagram the browser can't parse and asks the coordinator to repair it", async () => {
    mermaid.parse.mockImplementation(async (text: string) => {
      if (text.startsWith("sequenceDiagram")) throw new Error("Parse error on line 2");
      return true;
    });
    const fetcher = fetcherFor([SEQ, FLOW], null);
    render(<DesignDiagrams apiFetch={fetcher} designId="d1" />);
    // Loaded first (both tabs), then the broken one disappears.
    expect(await screen.findByRole("tab", { name: "Flow" })).toBeInTheDocument();
    const calls = (fetcher as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
    await waitFor(() => expect(calls.some(([path]) => path.endsWith("/repair"))).toBe(true));
    expect(screen.queryByRole("tab", { name: "Sequence (UML)" })).not.toBeInTheDocument();
    const repairCall = calls.find(([path]) => path.endsWith("/repair"));
    expect(repairCall?.[0]).toBe("/v1/designs/d1/diagrams/repair");
    expect(JSON.parse(String(repairCall?.[1]?.body))).toEqual({ type: "sequence", error: "Parse error on line 2" });
  });

  it("shows the repaired diagram when the coordinator fixes it", async () => {
    const FIXED: DesignDiagram = { ...FLOW, mermaid: "flowchart LR\n  x[Fixed] --> y[Ok]" };
    mermaid.parse.mockImplementation(async (text: string) => {
      if (text.includes("a[A]")) throw new Error("bad");
      return true;
    });
    render(<DesignDiagrams apiFetch={fetcherFor([FLOW], FIXED)} designId="d1" />);
    expect(await screen.findByRole("tab", { name: "Flow" })).toBeInTheDocument();
    await waitFor(() => expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), FIXED.mermaid));
  });
});
