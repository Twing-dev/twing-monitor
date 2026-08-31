import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ObserveApp } from "./ObserveApp.js";

const project = { projectId: "proj-1", orgId: "", role: "member" as const };

describe("ObserveApp", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the one allowed project (no picker, no LoginScreen) and renders it read-only, without an Authorization bearer value", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/projects")) {
        // ObserveContext's fixed authToken: "" -- apiFetch (§17 Phase 4)
        // omits the authorization header entirely for an empty token rather
        // than sending an empty bearer value. The coordinator's
        // public-viewer branch treats a missing header identically to an
        // empty one either way (both strip to token === ""), so this is
        // still the same "no real token" identity server-side.
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBeNull();
        return new Response(JSON.stringify({ items: [project] }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ObserveApp />);

    expect(await screen.findByRole("heading", { name: "proj-1" })).toBeInTheDocument();
    // No repo picker (RepoListView is skipped entirely) and no sign-in form.
    expect(screen.queryByRole("heading", { name: "Repos" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/token/i)).not.toBeInTheDocument();
    // Reviews is excluded from the tab bar for this identity.
    expect(screen.queryByRole("tab", { name: "Reviews" })).not.toBeInTheDocument();
    expect(await screen.findByRole("tab", { name: "Designs" })).toBeInTheDocument();
  });

  it("never touches localStorage -- a real admin's cached session in the same browser is left alone", async () => {
    localStorage.setItem("twing-monitor:auth", JSON.stringify({ servers: { "https://real.example": { authToken: "real-pat", developerId: "admin@example.com" } }, activeServerUrl: "https://real.example" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [project] }), { status: 200 })));

    render(<ObserveApp />);
    await screen.findByRole("heading", { name: "proj-1" });

    // Untouched: still exactly the real admin's own cached session.
    const raw = localStorage.getItem("twing-monitor:auth");
    expect(raw && JSON.parse(raw).activeServerUrl).toBe("https://real.example");
  });

  it("shows an empty state, not a crash, when the coordinator has no public project configured (TWING_PUBLIC_PROJECT_IDS pointing nowhere)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));

    render(<ObserveApp />);

    expect(await screen.findByText(/no public demo project is configured/i)).toBeInTheDocument();
  });

  // Pagination (monitor UI load-time fix, 2026-08-29): /observe mounts the
  // same DesignsView/AlignmentThreadsView every authenticated dashboard
  // does -- confirms that inheritance explicitly rather than assuming it,
  // per this change's own plan.
  it("shows a 'Load older' button on the Designs tab when the server returns a next page, same as the authenticated dashboard", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/projects")) return new Response(JSON.stringify({ items: [project] }), { status: 200 });
        if (url.includes("/v1/designs")) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: "design-1",
                  projectId: "proj-1",
                  developerId: "erin@example.com",
                  sessionId: "s1",
                  status: "open",
                  createdAt: Date.now(),
                  summary: "A public design",
                  creates: [],
                  touches: [],
                  dependsOn: [],
                  ttlMs: 1,
                  scopeVersion: 1,
                  lastActivityAt: Date.now(),
                  justifiedConstraintIds: [],
                  justifiedOverlaps: [],
                },
              ],
              nextBefore: 500,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );

    render(<ObserveApp />);

    expect(await screen.findByRole("tab", { name: "Designs" })).toBeInTheDocument();
    expect(await screen.findByText("A public design")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load older" })).toBeInTheDocument();
  });

  // TWING_PUBLIC_PROJECT_IDS generalization (2026-08-28): more than one
  // publicly-viewable project (e.g. twing-cli and twing-monitor's own repos
  // both) renders as RepoDetailLayout's existing multi-repo aggregate view
  // -- no separate picker built for this page, just handing it every
  // project GET /v1/projects returns for this identity.
  it("shows every public project at once as the multi-repo aggregate view when more than one is configured", async () => {
    const other = { projectId: "proj-2", orgId: "", role: "member" as const };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [project, other] }), { status: 200 })));

    render(<ObserveApp />);

    expect(await screen.findByRole("heading", { name: "2 repos" })).toBeInTheDocument();
    expect(screen.getByText("proj-1")).toBeInTheDocument();
    expect(screen.getByText("proj-2")).toBeInTheDocument();
  });
});
