import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch } from "./client.js";

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins serverUrl + path and attaches the bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ items: unknown[] }>("https://example.com", "my-token", "/v1/projects");

    expect(result).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/v1/projects");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer my-token");
  });

  it("throws ApiError carrying the status and the server's own error field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "not a member of this project" }), { status: 403 })),
    );

    await expect(apiFetch("https://example.com", "t", "/v1/projects")).rejects.toMatchObject({
      status: 403,
      message: "not a member of this project",
    });
  });

  it("a 401 (expired/revoked token) still surfaces as a normal ApiError -- reacting to it is the caller's job (useApiFetch)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })));

    await expect(apiFetch("https://example.com", "stale-token", "/v1/projects")).rejects.toMatchObject({ status: 401 });
  });

  it("falls back to statusText when the error body isn't JSON (e.g. a proxy-level 502)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" })));

    await expect(apiFetch("https://example.com", "t", "/v1/projects")).rejects.toMatchObject({ status: 502, message: "Bad Gateway" });
  });
});
