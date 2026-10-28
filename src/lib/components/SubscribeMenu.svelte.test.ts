import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import SubscribeMenu from "./SubscribeMenu.svelte";

const turnstileScript = "https://challenges.cloudflare.com/turnstile/v0/api.js";

function interceptProviderScriptRequests() {
  const scripts: HTMLScriptElement[] = [];
  const appendChild = document.head.appendChild.bind(document.head);

  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    if (node instanceof HTMLScriptElement && node.src === turnstileScript) {
      scripts.push(node);
      return node;
    }

    return appendChild(node);
  });

  return scripts;
}

async function finishTurnstileScriptLoad(scripts: HTMLScriptElement[], render: ReturnType<typeof vi.fn>) {
  await vi.waitFor(() => expect(scripts.length === 1 || render.mock.calls.length > 0).toBe(true));
  const script = scripts[0];
  if (script) {
    expect(script.isConnected).toBe(false);
    script.dispatchEvent(new Event("load"));
  }
}

function expectNoTurnstileRequests() {
  const requests = performance.getEntriesByType("resource").map((entry) => entry.name);
  expect(requests.some((request) => request.startsWith(turnstileScript))).toBe(false);
}

function mockFetchByUrl(handlers: Record<string, () => Promise<unknown>>) {
  return vi.fn(async (url: string) => {
    const match = Object.keys(handlers).find((key) => url.includes(key));
    if (!match) throw new Error(`Unhandled fetch in test: ${url}`);
    const body = await handlers[match]();
    return { ok: true, json: async () => body } as Response;
  });
}

describe("SubscribeMenu — captcha gating", () => {
  beforeEach(() => {
    localStorage.clear();
    performance.clearResourceTimings();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.querySelectorAll(`script[src="${turnstileScript}"]`).forEach((script) => script.remove());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).turnstile;
  });

  it("disables Continue until the captcha reports a token when a provider is configured", async () => {
    const scripts = interceptProviderScriptRequests();
    const renderSpy = vi.fn(() => "widget-id");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).turnstile = { render: renderSpy };
    vi.stubGlobal(
      "fetch",
      mockFetchByUrl({ "captcha-config.json": async () => ({ provider: "turnstile", siteKey: "site-key-123" }) }),
    );
    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();
    await finishTurnstileScriptLoad(scripts, renderSpy);

    await expect.element(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expectNoTurnstileRequests();
  });

  it("leaves Continue enabled when no captcha provider is configured", async () => {
    vi.stubGlobal("fetch", mockFetchByUrl({ "captcha-config.json": async () => ({ provider: null, siteKey: null }) }));

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    await expect.element(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled();
  });

  it("shows the server's specific error message instead of a generic one when login fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("captcha-config.json")) {
        return { ok: true, json: async () => ({ provider: null, siteKey: null }) } as Response;
      }
      if (url.includes("dashboard-apis/subscription")) {
        return { ok: false, json: async () => ({ message: "Captcha verification failed" }) } as Response;
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();

    await screen.getByLabelText("Email address").fill("test@example.com");
    await screen.getByRole("button", { name: "Continue" }).click();

    await expect.element(screen.getByText("Captcha verification failed")).toBeInTheDocument();
  });

  it("resets the captcha widget after a rejected token so the user can solve it again", async () => {
    const scripts = interceptProviderScriptRequests();
    const resetSpy = vi.fn();
    const renderSpy = vi.fn((_container: HTMLElement, opts: { callback: (t: string) => void }) => {
      opts.callback("solved-token-1");
      return "widget-id-1";
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).turnstile = { render: renderSpy, reset: resetSpy };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("captcha-config.json")) {
        return { ok: true, json: async () => ({ provider: "turnstile", siteKey: "site-key-123" }) } as Response;
      }
      if (url.includes("dashboard-apis/subscription")) {
        return { ok: false, json: async () => ({ message: "Captcha verification failed" }) } as Response;
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();
    await finishTurnstileScriptLoad(scripts, renderSpy);

    const continueButton = screen.getByRole("button", { name: "Continue" });
    // Widget "solves" immediately per the renderSpy mock above.
    await expect.element(continueButton).not.toBeDisabled();

    await screen.getByLabelText("Email address").fill("test@example.com");
    await continueButton.click();

    await vi.waitFor(() => expect(resetSpy).toHaveBeenCalledWith("widget-id-1"));
    expectNoTurnstileRequests();
  });

  it("sends the user back to solve a fresh captcha on Resend instead of replaying the consumed token", async () => {
    const scripts = interceptProviderScriptRequests();
    const renderSpy = vi.fn((_container: HTMLElement, opts: { callback: (t: string) => void }) => {
      opts.callback("solved-token-1");
      return "widget-id-1";
    });
    const turnstile = { render: renderSpy, reset: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).turnstile = turnstile;

    const loginCalls: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("captcha-config.json")) {
        return { ok: true, json: async () => ({ provider: "turnstile", siteKey: "site-key-123" }) } as Response;
      }
      if (url.includes("dashboard-apis/subscription")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        loginCalls.push(body);
        return { ok: true, json: async () => ({ success: true, message: "Verification code sent" }) } as Response;
      }
      throw new Error(`Unhandled fetch in test: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const screen = await render(SubscribeMenu, {});
    await screen.getByRole("button", { name: "Subscribe" }).click();
    await finishTurnstileScriptLoad(scripts, renderSpy);

    const continueButton = screen.getByRole("button", { name: "Continue" });
    await expect.element(continueButton).not.toBeDisabled();

    await screen.getByLabelText("Email address").fill("test@example.com");
    await continueButton.click();

    // Now on the OTP view -- Resend has no captcha widget to solve here.
    const resendButton = screen.getByRole("button", { name: /resend/i });
    await expect.element(resendButton).toBeInTheDocument();
    await resendButton.click();

    // Should go back to the login view for a fresh solve, not silently
    // replay the already-consumed token from the first submission.
    await expect.element(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(loginCalls.length).toBe(1);
    expectNoTurnstileRequests();
  });
});
