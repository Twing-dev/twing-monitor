import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { ConstraintsView } from "./ConstraintsView.js";

function renderWithAuth() {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <ConstraintsView projectId="proj-1" />
    </ServerProvider>,
  );
}

describe("ConstraintsView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when no constraints are registered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no constraints registered/i)).toBeInTheDocument());
  });

  it("renders one card per constraint with its statement, type badge, and scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  id: "constraint-1",
                  projectId: "proj-1",
                  type: "review_required",
                  statement: "hook/main.go carries the capture edge and must stay a trivial socket client",
                  scope: ["hook/main.go", "hook/socket.go"],
                  source: "twing.yml",
                  createdAt: Date.now(),
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/hook\/main\.go carries the capture edge/)).toBeInTheDocument());
    expect(screen.getByText("review required")).toBeInTheDocument();
    expect(screen.getByText("hook/main.go, hook/socket.go")).toBeInTheDocument();
  });
});
