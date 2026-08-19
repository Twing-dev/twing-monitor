import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerProvider } from "./ServerContext.js";
import { useAuth } from "./useAuth.js";
import { LoginScreen } from "./LoginScreen.js";

function Probe() {
  const { auth } = useAuth();
  return <div data-testid="auth-state">{auth ? auth.serverUrl : "signed-out"}</div>;
}

function renderLogin() {
  return render(
    <ServerProvider>
      <LoginScreen />
      <Probe />
    </ServerProvider>,
  );
}

describe("LoginScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a valid PAT: validates via whoami first, then persists and flips auth state", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ developerId: "alice@example.com", orgs: [], projects: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderLogin();

    await user.type(screen.getByLabelText("Personal access token"), "a-real-pat");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByTestId("auth-state")).not.toHaveTextContent("signed-out"));
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url.endsWith("/v1/auth/whoami")).toBe(true);
  });

  it("a rejected PAT shows an error and never signs in", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })));
    renderLogin();

    await user.type(screen.getByLabelText("Personal access token"), "a-bad-pat");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/rejected/i));
    expect(screen.getByTestId("auth-state")).toHaveTextContent("signed-out");
  });
});
