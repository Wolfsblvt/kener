import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Handle, RequestEvent, ResolveOptions } from "@sveltejs/kit";

const { db, GetMonitorsParsed } = vi.hoisted(() => ({
  db: {
    getApiKeyByHashedKey: vi.fn(async (_hashedKey: string): Promise<{ status: string } | undefined> => undefined),
    getIncidentById: vi.fn(async (_id: number): Promise<{ id: number } | undefined> => undefined),
    getMaintenanceById: vi.fn(async (_id: number): Promise<{ id: number } | undefined> => undefined),
    getPageByPath: vi.fn(async (_path: string): Promise<{ id: number } | undefined> => undefined),
  },
  GetMonitorsParsed: vi.fn(async (_query: { tag?: string }): Promise<Array<{ tag: string }>> => []),
}));
vi.mock("$lib/server/db/db", () => ({ default: db }));
vi.mock("$lib/server/controllers/monitorsController", () => ({ GetMonitorsParsed }));
// SvelteKit's sequence() needs a request store that only its server runtime sets up.
vi.mock("@sveltejs/kit/hooks", () => ({
  sequence:
    (...handlers: Handle[]): Handle =>
    ({ event, resolve }) =>
      handlers.reduceRight<(event: RequestEvent, opts?: ResolveOptions) => ReturnType<Handle>>(
        (next, handle) => (event) => handle({ event, resolve: next }),
        resolve,
      )(event),
}));

import { handle } from "./hooks.server";

const VALID_KEY = { authorization: "Bearer kener_valid" };

async function send(opts: {
  url: string;
  routeId: string | null;
  params?: Partial<Record<string, string>>;
  method?: string;
  headers?: Record<string, string>;
}) {
  const resolve = vi.fn(async () => new Response("reached the route", { status: 200 }));
  const url = new URL(opts.url);
  const event = {
    url,
    request: new Request(url, {
      method: opts.method ?? "GET",
      headers: { "content-type": "application/json", ...opts.headers },
    }),
    route: { id: opts.routeId },
    params: opts.params ?? {},
    cookies: { get: () => undefined },
    locals: {},
  } as unknown as RequestEvent;
  const response = await handle({ event, resolve });
  return { response, resolve, locals: event.locals };
}

function postImage(headers: Record<string, string>) {
  return send({ url: "http://localhost/api/v4/images", routeId: "/(api)/api/v4/images", method: "POST", headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/v4/images through the hooks", () => {
  it.each([
    ["no Authorization header", {}, "Missing or invalid authorization header"],
    ["an unknown API key", { authorization: "Bearer kener_unknown" }, "Invalid API key"],
  ])("returns 401 UNAUTHORIZED for %s and never reaches the route", async (_case, headers, message) => {
    const { response, resolve } = await postImage(headers);

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({ error: { code: "UNAUTHORIZED", message } });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("reaches the route with an active API key", async () => {
    db.getApiKeyByHashedKey.mockResolvedValueOnce({ status: "ACTIVE" });

    const { response, resolve } = await postImage(VALID_KEY);

    expect(resolve).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });
});

describe("which requests need an API key", () => {
  it("requires a key when the path is percent-encoded but SvelteKit matched an API route", async () => {
    const { response, resolve } = await send({
      url: "http://localhost/%61pi/v4/monitors",
      routeId: "/(api)/api/v4/monitors",
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toStrictEqual({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid authorization header" },
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("requires a key for an /api/ path that matches no route", async () => {
    const { response, resolve } = await send({ url: "http://localhost/api/v4/nothing", routeId: null });

    expect(response.status).toBe(401);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("returns JSON 404 for an /api/ path that matches no route when the key is valid", async () => {
    db.getApiKeyByHashedKey.mockResolvedValueOnce({ status: "ACTIVE" });

    const { response, resolve } = await send({
      url: "http://localhost/api/v4/nothing",
      routeId: null,
      headers: VALID_KEY,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: { code: "NOT_FOUND", message: "No API route matches '/api/v4/nothing'" },
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("lets a non-API route through without checking a key", async () => {
    const { response, resolve } = await send({
      url: "http://localhost/badge/mon1/status",
      routeId: "/badge/[tag]/status",
    });

    expect(resolve).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(db.getApiKeyByHashedKey).not.toHaveBeenCalled();
  });
});

describe("route params fill event.locals", () => {
  const url = "http://localhost/api/v4/resource/from-url";

  it.each([
    {
      param: "monitor_tag",
      routeId: "/(api)/api/v4/monitors/[monitor_tag]",
      params: { monitor_tag: "mon1" },
      lookup: GetMonitorsParsed,
      lookupArg: { tag: "mon1" },
      found: [{ tag: "mon1" }],
      local: "monitor",
      localValue: { tag: "mon1" },
      missing: "Monitor with tag 'mon1' not found",
    },
    {
      param: "incident_id",
      routeId: "/(api)/api/v4/incidents/[incident_id]/comments",
      params: { incident_id: "12" },
      lookup: db.getIncidentById,
      lookupArg: 12,
      found: { id: 12 },
      local: "incident",
      localValue: { id: 12 },
      missing: "Incident with id '12' not found",
    },
    {
      param: "maintenance_id",
      routeId: "/(api)/api/v4/maintenances/[maintenance_id]",
      params: { maintenance_id: "7" },
      lookup: db.getMaintenanceById,
      lookupArg: 7,
      found: { id: 7 },
      local: "maintenance",
      localValue: { id: 7 },
      missing: "Maintenance with id '7' not found",
    },
    {
      param: "page_path",
      routeId: "/(api)/api/v4/pages/[page_path]",
      params: { page_path: "infra" },
      lookup: db.getPageByPath,
      lookupArg: "infra",
      found: { id: 3 },
      local: "page",
      localValue: { id: 3 },
      missing: "Page with path 'infra' not found",
    },
    {
      param: "page_path ~home",
      routeId: "/(api)/api/v4/pages/[page_path]",
      params: { page_path: "~home" },
      lookup: db.getPageByPath,
      lookupArg: "",
      found: { id: 1 },
      local: "page",
      localValue: { id: 1 },
      missing: "Page with path '~home' not found",
    },
  ])("$param: looks up event.params, not the URL, and stores the record", async (row) => {
    db.getApiKeyByHashedKey.mockResolvedValueOnce({ status: "ACTIVE" });
    (row.lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce(row.found);

    const { response, resolve, locals } = await send({
      url,
      routeId: row.routeId,
      params: row.params,
      headers: VALID_KEY,
    });

    expect(row.lookup).toHaveBeenCalledExactlyOnceWith(row.lookupArg);
    expect(resolve).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(locals[row.local as keyof App.Locals]).toStrictEqual(row.localValue);
  });

  it.each([
    [
      "monitor_tag",
      "/(api)/api/v4/monitors/[monitor_tag]",
      { monitor_tag: "mon1" },
      "Monitor with tag 'mon1' not found",
    ],
    ["incident_id", "/(api)/api/v4/incidents/[incident_id]", { incident_id: "12" }, "Incident with id '12' not found"],
    [
      "maintenance_id",
      "/(api)/api/v4/maintenances/[maintenance_id]",
      { maintenance_id: "7" },
      "Maintenance with id '7' not found",
    ],
    ["page_path", "/(api)/api/v4/pages/[page_path]", { page_path: "infra" }, "Page with path 'infra' not found"],
  ])("%s: returns JSON 404 when the record does not exist", async (_param, routeId, params, message) => {
    db.getApiKeyByHashedKey.mockResolvedValueOnce({ status: "ACTIVE" });

    const { response, resolve } = await send({ url, routeId, params, headers: VALID_KEY });

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({ error: { code: "NOT_FOUND", message } });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(["abc", "12abc", "12.9", "1e3", "-1", "2147483648", "99999999999999999999"])(
    "returns JSON 404 for the malformed id %s without querying the database",
    async (incident_id) => {
      db.getApiKeyByHashedKey.mockResolvedValueOnce({ status: "ACTIVE" });

      const { response, resolve } = await send({
        url,
        routeId: "/(api)/api/v4/incidents/[incident_id]",
        params: { incident_id },
        headers: VALID_KEY,
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toStrictEqual({
        error: { code: "NOT_FOUND", message: `Incident with id '${incident_id}' not found` },
      });
      expect(db.getIncidentById).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
    },
  );
});

describe("the admitted public origin in event.locals", () => {
  const PRODUCT = { origin: "https://status.product.example", pagePath: "product" };

  beforeEach(() => vi.stubEnv("KENER_PUBLIC_ORIGINS", `${PRODUCT.origin}=product`));
  afterEach(() => vi.unstubAllEnvs());

  const localsFor = async (headers: Record<string, string>) =>
    (await send({ url: "http://127.0.0.1:3000/", routeId: "/(kener)", headers })).locals;

  it("comes from a Host header that names an admitted origin", async () => {
    expect((await localsFor({ host: "status.product.example" })).publicOrigin).toStrictEqual(PRODUCT);
  });

  it.each<Record<string, string>>([
    { host: "status.portfolio.example" },
    { host: "evil.example", "x-forwarded-host": "status.product.example" },
    { host: "evil.example", forwarded: "host=status.product.example;proto=https" },
    { host: "evil.example", "x-original-host": "status.product.example" },
  ])("is null for %o: only the exact Host header is read", async (headers) => {
    expect((await localsFor(headers)).publicOrigin).toBeNull();
  });
});

describe("CSRF on an admitted public origin", () => {
  const PRODUCT = "https://status.product.example";
  // With adapter-node and ORIGIN set, event.url is always the site URL, whatever Host the visitor sent
  const SITE = "https://status.portfolio.example/";

  const submit = (headers: Record<string, string>, url = SITE) =>
    send({
      url,
      routeId: "/(kener)",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    });

  describe("with KENER_PUBLIC_ORIGINS", () => {
    beforeEach(() => vi.stubEnv("KENER_PUBLIC_ORIGINS", `${PRODUCT}=product`));
    afterEach(() => vi.unstubAllEnvs());

    it("accepts a form whose Origin is the admitted origin", async () => {
      const { response, resolve } = await submit({ host: "status.product.example", origin: PRODUCT });
      expect(response.status).toBe(200);
      expect(resolve).toHaveBeenCalledOnce();
    });

    it.each([
      ["the site URL", "https://status.portfolio.example"],
      ["a foreign origin", "https://evil.example"],
      ["the wrong scheme", "http://status.product.example"],
      ["the wrong port", "https://status.product.example:8443"],
      ["an unparseable value", "not an origin"],
    ])("refuses a form on the admitted host whose Origin is %s", async (_case, origin) => {
      const { response, resolve } = await submit({ host: "status.product.example", origin });
      expect(response.status).toBe(403);
      expect(resolve).not.toHaveBeenCalled();
    });

    it("judges a spoofed forwarding header by upstream's host comparison", async () => {
      const spoofed = { host: "evil.example", "x-forwarded-host": "status.product.example", origin: PRODUCT };
      expect((await submit(spoofed)).response.status).toBe(403);
      const site = { host: "status.portfolio.example", "x-forwarded-host": "status.product.example" };
      expect((await submit({ ...site, origin: "https://status.portfolio.example" })).response.status).toBe(200);
      expect((await submit({ ...site, origin: PRODUCT })).response.status).toBe(403);
    });
  });

  it("keeps upstream's comparison with event.url when nothing is admitted", async () => {
    vi.stubEnv("KENER_PUBLIC_ORIGINS", "");
    try {
      expect((await submit({ host: "status.product.example", origin: PRODUCT })).response.status).toBe(403);
      const portfolio = { host: "status.product.example", origin: "https://status.portfolio.example" };
      expect((await submit(portfolio)).response.status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
