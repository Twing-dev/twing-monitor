import { describe, it, expect, vi, afterEach } from "vitest";
import { startDeviceFlow, completeDeviceFlow, type DeviceCode } from "./githubSignIn.js";

const SERVER = "https://coordinator.example";

/** A device code with no wait between polls, so these run at test speed
 * rather than GitHub's five-second cadence. */
function device(overrides: Partial<DeviceCode> = {}): DeviceCode {
  return { deviceCode: "dev-code", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", interval: 0, expiresIn: 900, ...overrides };
}

/** Answers each POST in order, recording what was sent. */
function mockFetch(responses: unknown[]) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    calls.push({ path: href.replace(SERVER, ""), body: JSON.parse(String(init?.body ?? "{}")) });
    const body = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("auth/githubSignIn", () => {
  it("starts the device flow through the coordinator, not against GitHub directly", async () => {
    // GitHub's device endpoints send no Access-Control-Allow-Origin, so a
    // browser cannot call them at all -- the coordinator has to forward.
    const calls = mockFetch([{ device_code: "dc", user_code: "WXYZ-9999", verification_uri: "https://github.com/login/device", interval: 5, expires_in: 900 }]);

    const started = await startDeviceFlow(SERVER);

    expect(calls[0].path).toBe("/v1/auth/github/device");
    expect(calls.every((c) => !c.path.includes("github.com"))).toBe(true);
    expect(started.userCode).toBe("WXYZ-9999");
    expect(started.interval).toBe(5);
  });

  it("keeps polling while GitHub says authorization_pending, then exchanges for a PAT", async () => {
    const calls = mockFetch([
      { error: "authorization_pending" },
      { error: "authorization_pending" },
      { access_token: "gh-token" },
      { developerId: "juliancarax" },
    ]);

    const result = await completeDeviceFlow(SERVER, device());

    expect(result.developerId).toBe("juliancarax");
    expect(calls.filter((c) => c.path === "/v1/auth/github/poll")).toHaveLength(3);
    expect(calls.at(-1)?.path).toBe("/v1/auth/github/session");
  });

  it("sends only the hash of the new PAT, never the PAT itself", async () => {
    // Same contract as `twing keygen` on the CLI: the coordinator stores a
    // hash and never sees the secret, not even at issuing time.
    const calls = mockFetch([{ access_token: "gh-token" }, { developerId: "juliancarax" }]);

    const { token } = await completeDeviceFlow(SERVER, device());

    const session = calls.find((c) => c.path === "/v1/auth/github/session")!;
    expect(session.body.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.body.tokenHash).not.toBe(token);
    expect(JSON.stringify(session.body)).not.toContain(token);
    expect(token).toMatch(/^[0-9a-f]{64}$/); // matches the CLI's 32-random-byte format
  });

  it("backs off further when GitHub says slow_down", async () => {
    // Polling faster than asked earns a longer penalty than behaving would.
    const calls = mockFetch([{ error: "slow_down" }, { access_token: "gh-token" }, { developerId: "x" }]);
    const started = Date.now();

    await completeDeviceFlow(SERVER, device({ interval: 0 }));

    expect(calls.filter((c) => c.path === "/v1/auth/github/poll")).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(5000);
  }, 20_000);

  it("reports a declined approval in words a person can act on", async () => {
    mockFetch([{ error: "access_denied" }]);
    await expect(completeDeviceFlow(SERVER, device())).rejects.toThrow(/declined on GitHub/);
  });

  it("reports an expired code rather than polling forever", async () => {
    mockFetch([{ error: "expired_token" }]);
    await expect(completeDeviceFlow(SERVER, device())).rejects.toThrow(/expired/);
  });

  it("surfaces the coordinator's refusal when the account isn't linked yet", async () => {
    // The one case a person has to do something about: sign in on the CLI
    // once so the account gets attached to their identity.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
        if (href.endsWith("/session")) {
          return new Response(JSON.stringify({ error: "@stranger isn't linked to a twing identity on this coordinator yet." }), { status: 403 });
        }
        return new Response(JSON.stringify({ access_token: "gh-token" }), { status: 200 });
      }),
    );

    await expect(completeDeviceFlow(SERVER, device())).rejects.toThrow(/isn't linked to a twing identity/);
  });

  it("stops polling once aborted", async () => {
    // A screen the user navigated away from must not keep talking to GitHub
    // for the full fifteen minutes.
    const calls = mockFetch([{ error: "authorization_pending" }]);
    const controller = new AbortController();
    controller.abort();

    await expect(completeDeviceFlow(SERVER, device(), controller.signal)).rejects.toThrow(/cancelled/);
    expect(calls).toHaveLength(0);
  });
});
