import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import Captcha, { loadScript } from "./Captcha.svelte";

const providerScripts = [
  "https://js.hcaptcha.com/1/api.js",
  "https://www.google.com/recaptcha/api.js",
  "https://challenges.cloudflare.com/turnstile/v0/api.js",
];

function interceptProviderScriptRequests() {
  const scripts: HTMLScriptElement[] = [];
  const appendChild = document.head.appendChild.bind(document.head);

  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    if (node instanceof HTMLScriptElement && providerScripts.includes(node.src)) {
      scripts.push(node);
      return node;
    }

    return appendChild(node);
  });

  return scripts;
}

async function finishProviderScriptLoad(scripts: HTMLScriptElement[], sdkAlreadyUsed: () => boolean) {
  await vi.waitFor(() => expect(scripts.length === 1 || sdkAlreadyUsed()).toBe(true));
  const script = scripts[0];
  if (!script) return;

  expect(script.isConnected).toBe(false);
  script.dispatchEvent(new Event("load"));
}

function expectNoProviderScriptRequests() {
  const requests = performance.getEntriesByType("resource").map((entry) => entry.name);
  expect(requests.some((request) => providerScripts.some((src) => request.startsWith(src)))).toBe(false);
}

describe("Captcha", () => {
  beforeEach(() => {
    performance.clearResourceTimings();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).grecaptcha;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).hcaptcha;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).turnstile;
  });

  it("renders nothing and reports not-required when no provider is configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ provider: null, siteKey: null }) }));
    const onReady = vi.fn();
    const onVerify = vi.fn();

    const screen = await render(Captcha, { onVerify, onReady });
    await expect.element(screen.getByTestId("captcha-widget")).not.toBeInTheDocument();

    expect(onReady).toHaveBeenCalledWith(false);
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("reports required and explains itself when a provider is enabled without its keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ provider: null, siteKey: null, misconfigured: true }) }),
    );
    const onReady = vi.fn();
    const onVerify = vi.fn();

    const screen = await render(Captcha, { onVerify, onReady });
    await expect.element(screen.getByTestId("captcha-misconfigured")).toBeInTheDocument();
    await expect.element(screen.getByTestId("captcha-widget")).not.toBeInTheDocument();

    // Required, not off: the server rejects every token in this state, so the
    // parent must keep the submit blocked rather than letting it fail silently.
    expect(onReady).toHaveBeenCalledWith(true);
    expect(onReady).not.toHaveBeenCalledWith(false);
    expect(onVerify).not.toHaveBeenCalled();
  });

  it("renders the widget container and reports required when a provider is configured", async () => {
    const scripts = interceptProviderScriptRequests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ provider: "recaptcha", siteKey: "site-key-123" }) }),
    );
    const widgetRender = vi.fn(() => "widget-1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).grecaptcha = { render: widgetRender };
    const onReady = vi.fn();
    const onVerify = vi.fn();

    const screen = await render(Captcha, { onVerify, onReady });
    await finishProviderScriptLoad(scripts, () => widgetRender.mock.calls.length > 0);
    await expect.element(screen.getByTestId("captcha-widget")).toBeInTheDocument();

    expect(onReady).toHaveBeenCalledWith(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(widgetRender).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ sitekey: "site-key-123" }),
    );
    expectNoProviderScriptRequests();
  });

  it("reports null when a solved token expires or errors, so the parent re-disables submit", async () => {
    const scripts = interceptProviderScriptRequests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ provider: "hcaptcha", siteKey: "site-key-123" }) }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let opts: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).hcaptcha = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render: (_container: HTMLElement, options: any) => {
        opts = options;
        return "widget-1";
      },
    };

    const onVerify = vi.fn();
    await render(Captcha, { onVerify, onReady: vi.fn() });
    await finishProviderScriptLoad(scripts, () => opts !== undefined);

    await vi.waitFor(() => expect(opts).toBeDefined());

    opts.callback("solved-token");
    expect(onVerify).toHaveBeenLastCalledWith("solved-token");

    // The token expires while the email form is still open. Without this the
    // stale token stayed set and Continue stayed enabled until the server
    // rejected it a round-trip later.
    opts["expired-callback"]();
    expect(onVerify).toHaveBeenLastCalledWith(null);

    opts.callback("solved-again");
    opts["error-callback"]();
    expect(onVerify).toHaveBeenLastCalledWith(null);
    expectNoProviderScriptRequests();
  });

  it("does not walk back the required state when the provider SDK fails after being detected", async () => {
    const scripts = interceptProviderScriptRequests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ provider: "hcaptcha", siteKey: "site-key-123" }) }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const widgetRender = vi.fn(() => {
      throw new Error("provider SDK init failed");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).hcaptcha = { render: widgetRender };

    const onReady = vi.fn();
    await render(Captcha, { onVerify: vi.fn(), onReady });
    await finishProviderScriptLoad(scripts, () => widgetRender.mock.calls.length > 0);

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith(true));
    // Give the (failing) render attempt a chance to run and hit the catch
    // block before asserting it never reported not-required afterwards.
    await new Promise((r) => setTimeout(r, 50));
    expect(onReady).not.toHaveBeenCalledWith(false);
    expectNoProviderScriptRequests();
  });

  it("waits for the late Turnstile SDK and renders without calling ready()", async () => {
    const scripts = interceptProviderScriptRequests();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: async () => ({ provider: "turnstile", siteKey: "site-key-123" }) }),
    );

    // Mirrors the real api.js: `ready()` throws whenever its <script> tag is
    // async or defer — which a dynamically inserted script always is — while
    // `render` is usable as soon as the script has loaded.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let opts: any;
    const ready = vi.fn(() => {
      throw new Error(
        "[Cloudflare Turnstile] Remove async/defer from the Turnstile api.js script tag before using turnstile.ready().",
      );
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const widgetRender = vi.fn((_container: HTMLElement, options: any) => {
      opts = options;
      return "widget-1";
    });
    const turnstile = {
      ready,
      render: widgetRender,
    };

    const onVerify = vi.fn();
    await render(Captcha, { onVerify, onReady: vi.fn() });
    await vi.waitFor(() => expect(scripts).toHaveLength(1));
    const script = scripts[0];
    expect(script.isConnected).toBe(false);
    expect(widgetRender).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();

    // The SDK global becomes available as the detached script fixture settles,
    // matching the browser's real async-load ordering without attaching a URL.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).turnstile = turnstile;
    script.dispatchEvent(new Event("load"));

    await vi.waitFor(() => expect(opts).toBeDefined());
    expect(opts.sitekey).toBe("site-key-123");
    expect(widgetRender).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();

    opts.callback("solved-token");
    expect(onVerify).toHaveBeenLastCalledWith("solved-token");
    expectNoProviderScriptRequests();
  });
});

describe("loadScript", () => {
  const src = "https://example.com/captcha-test-script.js";

  afterEach(() => {
    document.head.querySelectorAll(`script[src="${src}"]`).forEach((el) => el.remove());
  });

  it("shares one in-flight load across concurrent callers instead of resolving early", async () => {
    const onload1 = vi.fn();
    const onload2 = vi.fn();

    const p1 = loadScript(src).then(onload1);
    const p2 = loadScript(src).then(onload2);

    const scripts = document.head.querySelectorAll(`script[src="${src}"]`);
    expect(scripts.length).toBe(1);

    // Neither caller should resolve just because a second call saw the
    // first call's still-loading <script> tag.
    await Promise.resolve();
    await Promise.resolve();
    expect(onload1).not.toHaveBeenCalled();
    expect(onload2).not.toHaveBeenCalled();

    scripts[0].dispatchEvent(new Event("load"));
    await Promise.all([p1, p2]);

    expect(onload1).toHaveBeenCalled();
    expect(onload2).toHaveBeenCalled();
  });

  it("removes a failed script tag so a retry creates a fresh one instead of hanging on stale listeners", async () => {
    // Own URL, distinct from `src` above -- the module-level cache is a
    // singleton shared across tests in this file, so reusing `src` here
    // would just return the already-resolved promise the earlier test left
    // behind instead of exercising a fresh load.
    const failSrc = "https://example.com/captcha-test-script-retry.js";

    const failedLoad = loadScript(failSrc);
    const scriptsAfterFirstAttempt = document.head.querySelectorAll(`script[src="${failSrc}"]`);
    expect(scriptsAfterFirstAttempt.length).toBe(1);

    scriptsAfterFirstAttempt[0].dispatchEvent(new Event("error"));
    await expect(failedLoad).rejects.toThrow();

    // The failed tag must be gone -- otherwise a retry would find a dead
    // script whose error event already fired (and never will again),
    // attach listeners that never trigger, and hang forever.
    expect(document.head.querySelectorAll(`script[src="${failSrc}"]`).length).toBe(0);

    const retryLoad = loadScript(failSrc);
    const scriptsAfterRetry = document.head.querySelectorAll(`script[src="${failSrc}"]`);
    expect(scriptsAfterRetry.length).toBe(1);

    scriptsAfterRetry[0].dispatchEvent(new Event("load"));
    await expect(retryLoad).resolves.toBeUndefined();

    document.head.querySelectorAll(`script[src="${failSrc}"]`).forEach((el) => el.remove());
  });

  it("resolves immediately when it finds a script tag already marked as loaded", async () => {
    // Simulates the module-level cache having been reset (e.g. a dev-mode
    // hot reload) while a previously-loaded <script> tag survives in the
    // DOM -- loadScript must recognize it's already done rather than
    // attaching listeners and waiting on a load event that already fired.
    const preloadedSrc = "https://example.com/captcha-test-script-preloaded.js";
    const preloadedScript = document.createElement("script");
    preloadedScript.src = preloadedSrc;
    preloadedScript.setAttribute("data-kener-script-loaded", "true");
    document.head.appendChild(preloadedScript);

    const onload = vi.fn();
    await loadScript(preloadedSrc).then(onload);

    expect(onload).toHaveBeenCalled();
    expect(document.head.querySelectorAll(`script[src="${preloadedSrc}"]`).length).toBe(1);

    preloadedScript.remove();
  });

  it("replaces a script tag already marked as failed instead of waiting on a dead element", async () => {
    const preDeadSrc = "https://example.com/captcha-test-script-predead.js";
    const deadScript = document.createElement("script");
    deadScript.src = preDeadSrc;
    deadScript.setAttribute("data-kener-script-failed", "true");
    document.head.appendChild(deadScript);

    const loadPromise = loadScript(preDeadSrc);

    const scripts = document.head.querySelectorAll(`script[src="${preDeadSrc}"]`);
    expect(scripts.length).toBe(1);
    expect(scripts[0]).not.toBe(deadScript);

    scripts[0].dispatchEvent(new Event("load"));
    await expect(loadPromise).resolves.toBeUndefined();

    document.head.querySelectorAll(`script[src="${preDeadSrc}"]`).forEach((el) => el.remove());
  });
});
