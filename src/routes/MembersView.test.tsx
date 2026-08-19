import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ServerProvider } from "../auth/ServerContext.js";
import { saveAuth } from "../auth/storage.js";
import { MembersView } from "./MembersView.js";

function renderWithAuth() {
  saveAuth("https://coordination-server.twing.dev", "a-pat", "alice@example.com");
  return render(
    <ServerProvider>
      <MembersView projectId="proj-1" />
    </ServerProvider>,
  );
}

describe("MembersView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders an empty state when there are no members", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderWithAuth();

    await waitFor(() => expect(screen.getByText(/no members found/i)).toBeInTheDocument());
  });

  it("renders one row per member with a role badge", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                { projectId: "proj-1", developerId: "alice@example.com", role: "admin" },
                { projectId: "proj-1", developerId: "bob@example.com", role: "member" },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    renderWithAuth();

    await waitFor(() => expect(screen.getByText("alice@example.com")).toBeInTheDocument());
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });
});
