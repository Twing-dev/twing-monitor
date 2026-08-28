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
        // ObserveContext's fixed authToken: "" -- the same "no real token"
        // wire shape apiFetch always sends as a plain empty bearer value.
        // (Headers trims the trailing space off "Bearer " per the Fetch
        // spec, so the stored value reads as the bare word.)
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer");
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

  it("shows an empty state, not a crash, when the coordinator has no public project configured (TWING_PUBLIC_PROJECT_ID pointing nowhere)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));

    render(<ObserveApp />);

    expect(await screen.findByText(/no public demo project is configured/i)).toBeInTheDocument();
  });
});
