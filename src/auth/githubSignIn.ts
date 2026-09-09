/**
 * "Continue with GitHub" for twing-monitor.
 *
 * Signing in used to mean pasting a PAT you obtained by running `twing init`
 * and then `twing servers --show-token` -- a CLI round trip to log into a web
 * page, and the reason a person's dashboard identity could end up different
 * from the one their CLI authors work under (an admin once saw zero alignment
 * threads they were actually a party to, for exactly that reason).
 *
 * **Why this goes through the coordinator rather than straight to GitHub.**
 * GitHub's device-flow endpoints (`/login/device/code`,
 * `/login/oauth/access_token`) send no `Access-Control-Allow-Origin`, so a
 * browser cannot call them at all -- verified against both. The coordinator
 * forwards them (`/v1/auth/github/device`, `/v1/auth/github/poll`), which it
 * is well placed to do since it already talks to GitHub.
 *
 * The PAT itself is still generated *here* and only its hash is ever sent,
 * exactly as `twing keygen` does on the CLI side: the coordinator stores a
 * hash and never sees the secret, not even at issuing time.
 */

/** Matches the CLI's `generateToken` (keygen.ts): 32 random bytes, hex. */
function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Matches the CLI's `hashToken`: sha256, hex. */
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DeviceCode {
  /** Shown to the person; they type it into GitHub. */
  userCode: string;
  /** Where they type it. */
  verificationUri: string;
  deviceCode: string;
  /** Seconds GitHub asks us to wait between polls. Honoured, not guessed --
   * polling faster earns a `slow_down` and a longer wait than behaving
   * would have. */
  interval: number;
  expiresIn: number;
}

async function postJson(serverUrl: string, path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof parsed.error === "string" ? parsed.error : `${res.status} from ${path}`);
  return parsed;
}

export async function startDeviceFlow(serverUrl: string): Promise<DeviceCode> {
  const body = await postJson(serverUrl, "/v1/auth/github/device", {});
  const deviceCode = body.device_code as string | undefined;
  const userCode = body.user_code as string | undefined;
  if (!deviceCode || !userCode) throw new Error("GitHub didn't return a device code");
  return {
    deviceCode,
    userCode,
    verificationUri: (body.verification_uri as string) ?? "https://github.com/login/device",
    interval: (body.interval as number) ?? 5,
    expiresIn: (body.expires_in as number) ?? 900,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the person to approve, then exchanges the result for a twing PAT.
 *
 * `signal` lets the UI abandon a flow the user walked away from -- otherwise
 * a component that unmounted would keep polling for the full fifteen minutes.
 */
export async function completeDeviceFlow(
  serverUrl: string,
  device: DeviceCode,
  signal?: AbortSignal,
): Promise<{ token: string; developerId: string }> {
  const deadline = Date.now() + device.expiresIn * 1000;
  let intervalMs = device.interval * 1000;

  for (;;) {
    if (signal?.aborted) throw new Error("sign-in cancelled");
    if (Date.now() > deadline) throw new Error("That code expired. Start again.");
    await sleep(intervalMs);
    if (signal?.aborted) throw new Error("sign-in cancelled");

    const body = await postJson(serverUrl, "/v1/auth/github/poll", { deviceCode: device.deviceCode });
    const accessToken = body.access_token as string | undefined;
    if (accessToken) return exchangeForPat(serverUrl, accessToken);

    // GitHub reports "still waiting" as a 200 with an `error` field, so the
    // status code is not the signal here.
    const error = body.error as string | undefined;
    if (error === "authorization_pending") continue;
    if (error === "slow_down") {
      intervalMs += 5000; // GitHub's documented penalty; keep it rather than reset
      continue;
    }
    if (error === "expired_token") throw new Error("That code expired. Start again.");
    if (error === "access_denied") throw new Error("Sign-in was declined on GitHub.");
    throw new Error(error ?? "GitHub sign-in failed");
  }
}

async function exchangeForPat(serverUrl: string, githubToken: string): Promise<{ token: string; developerId: string }> {
  const token = generateToken();
  const body = await postJson(serverUrl, "/v1/auth/github/session", {
    githubToken,
    tokenHash: await hashToken(token),
    label: "twing-monitor",
  });
  const developerId = body.developerId as string | undefined;
  if (!developerId) throw new Error("The coordinator didn't return an identity");
  return { token, developerId };
}
