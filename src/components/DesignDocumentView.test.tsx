import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { DesignDocumentView } from "./DesignDocumentView.js";
import type { DesignDocumentResponse } from "../api/types.js";

const ready: DesignDocumentResponse = { groupId: "shared", status: "ready", revision: 1, stale: false,
  content: { schemaVersion: 1, title: "Preserve concurrent updates", sections: {
    problemStatement: "An old save can erase newer work.", solutionAbstract: "Check source versions.", fullSolution: "Keep the draft for reconciliation.", validation: " ",
  } },
};

function stub(response: unknown = ready, status = 200) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(response), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function renderDocument(readOnly = false, designId = "design-1") {
  saveAuth("https://coordinator.example", "token", "alice");
  return render(<ServerProvider><DesignDocumentView designId={designId} readOnly={readOnly}>
    {(hasDocument) => <p>{hasDocument ? "Expandable original designs" : "Original designs fallback"}</p>}
  </DesignDocumentView></ServerProvider>);
}

describe("DesignDocumentView", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("renders populated sections once in order and omits unsupported sections", async () => {
    const fetch = stub();
    renderDocument();
    await screen.findByRole("heading", { name: "Problem statement" });
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Preserve concurrent updates", "Problem statement", "Solution abstract", "Full solution",
    ]);
    expect(screen.queryByRole("heading", { name: "Validation" })).not.toBeInTheDocument();
    expect(screen.getByText("Expandable original designs")).toBeInTheDocument();
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it("preserves original designs on older servers without showing generation controls", async () => {
    const fetch = stub({ error: "not found" }, 404);
    renderDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText("Original designs fallback")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Design document" })).not.toBeInTheDocument();
  });

  it("explains restricted access and keeps accessible originals", async () => {
    stub({ error: "restricted" }, 403);
    renderDocument();
    await screen.findByText(/requires access to every source repository/);
    expect(screen.getByText("Original designs fallback")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows stale content with a pending refresh instead of replacing it with a spinner", async () => {
    stub({ ...ready, status: "pending", stale: true });
    renderDocument();
    await screen.findByText(/earlier version/);
    expect(screen.getByRole("heading", { name: ready.content!.title })).toBeInTheDocument();
    expect(screen.getByText("Preparing the design document…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("requests generation for an existing design and refreshes its status", async () => {
    let requested = false;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") { requested = true; return new Response("{}", { status: 202 }); }
      return new Response(JSON.stringify(requested ? { ...ready, status: "pending", content: undefined } : { ...ready, status: "missing", content: undefined }));
    });
    vi.stubGlobal("fetch", fetch);
    renderDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Generate design document" }));
    await screen.findByText("Preparing the design document…");
    expect(fetch.mock.calls.some(([url, init]) => String(url).endsWith("/document/regenerate") && init?.method === "POST")).toBe(true);
  });

  it("keeps prior content on generation failure and offers retry only to members", async () => {
    stub({ ...ready, status: "failed", stale: true });
    const { unmount } = renderDocument();
    await screen.findByRole("button", { name: "Retry document generation" });
    expect(screen.getByText(/couldn't be prepared/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: ready.content!.title })).toBeInTheDocument();
    unmount();
    renderDocument(true);
    await screen.findByRole("heading", { name: ready.content!.title });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("polls a pending document to completion", async () => {
    vi.useFakeTimers();
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(++reads === 1 ? { ...ready, status: "running", content: undefined } : ready))));
    renderDocument();
    await act(async () => {});
    expect(screen.getByText("Preparing the design document…")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole("heading", { name: "Problem statement" })).toBeInTheDocument();
    expect(screen.queryByText("Preparing the design document…")).not.toBeInTheDocument();
  });

  it("does not interpret generated prose as HTML or attach original-design anchors", async () => {
    stub({ ...ready, content: { ...ready.content, sections: { problemStatement: '<script>alert("x")</script>' } } });
    const { container } = renderDocument();
    await screen.findByText('<script>alert("x")</script>');
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[data-review-field]")).toBeNull();
  });

  it("does not show a late document from the previous selection", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("design-1")
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : new Response(JSON.stringify({ ...ready, content: { ...ready.content, title: "Second design" } }))));
    const { rerender } = renderDocument();
    rerender(<ServerProvider><DesignDocumentView designId="design-2" /></ServerProvider>);
    await screen.findByRole("heading", { name: "Second design" });
    await act(async () => { finish(new Response(JSON.stringify(ready))); });
    expect(screen.queryByRole("heading", { name: ready.content!.title })).not.toBeInTheDocument();
  });
});
