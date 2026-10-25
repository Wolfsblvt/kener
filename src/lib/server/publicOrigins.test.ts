import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/server/db/db.js", () => ({
  default: { getPageByPath: vi.fn(), getActivePageMonitors: vi.fn() },
}));

import db from "$lib/server/db/db.js";
import {
  ParsePublicOrigins,
  PublicOriginForHost,
  PublicOriginForMonitors,
  SubscriberMailSiteURL,
} from "./publicOrigins";

const mockedDb = vi.mocked(db);
const PRODUCT = { origin: "https://status.product.example", pagePath: "product" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("ParsePublicOrigins", () => {
  it("admits each <origin>=<page path> entry by host", () => {
    const admitted = ParsePublicOrigins(" https://status.product.example=product , http://other.example:8080/=other ");
    expect([...admitted]).toEqual([
      ["status.product.example", PRODUCT],
      ["other.example:8080", { origin: "http://other.example:8080", pagePath: "other" }],
    ]);
  });

  it("admits nothing when unset or empty", () => {
    expect(ParsePublicOrigins(undefined).size).toBe(0);
    expect(ParsePublicOrigins(" , ").size).toBe(0);
  });

  it.each([
    "status.product.example=product",
    "https://status.product.example/status=product",
    "https://status.product.example/?x=1=product",
    "https://status.product.example/#top=product",
    "https://user:pass@status.product.example=product",
    "ftp://status.product.example=product",
    "javascript:alert(1)=product",
    "https://status.product.example=",
    "https://status.product.example=~home",
    "https://status.product.example=Product",
    "https://status.product.example=../admin",
    "https://status.product.example",
    "=product",
  ])("skips the malformed entry %s without admitting anything", (entry) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(ParsePublicOrigins(entry).size).toBe(0);
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("keeps the first entry for a host or a page and skips the repeat", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const admitted = ParsePublicOrigins(
      "https://status.product.example=product,https://STATUS.product.example=second,https://alias.example=product",
    );
    expect([...admitted.values()]).toEqual([PRODUCT]);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe("PublicOriginForHost", () => {
  it("returns the origin only for the exact admitted host, in any letter case", () => {
    vi.stubEnv("KENER_PUBLIC_ORIGINS", "https://status.product.example=product");
    expect(PublicOriginForHost("status.product.example")).toEqual(PRODUCT);
    expect(PublicOriginForHost("Status.Product.Example")).toEqual(PRODUCT);
  });

  it.each([
    null,
    "",
    "evil.example",
    "status.product.example.",
    "status.product.example:8443",
    "status.product.example.evil.example",
    "evil.example/status.product.example",
    "user@status.product.example",
  ])("returns null for host %s", (host) => {
    vi.stubEnv("KENER_PUBLIC_ORIGINS", "https://status.product.example=product");
    expect(PublicOriginForHost(host)).toBeNull();
  });

  it("returns null for every host when nothing is admitted", () => {
    vi.stubEnv("KENER_PUBLIC_ORIGINS", "");
    expect(PublicOriginForHost("status.product.example")).toBeNull();
  });

  it("follows a changed variable instead of keeping the first value", () => {
    vi.stubEnv("KENER_PUBLIC_ORIGINS", "https://status.product.example=product");
    expect(PublicOriginForHost("status.product.example")).toEqual(PRODUCT);
    vi.stubEnv("KENER_PUBLIC_ORIGINS", "https://status.other.example=other");
    expect(PublicOriginForHost("status.product.example")).toBeNull();
  });
});

describe("PublicOriginForMonitors", () => {
  const pages: Record<string, { id: number; tags: string[] }> = {
    product: { id: 1, tags: ["product-site", "product-docs"] },
    other: { id: 2, tags: ["other-api", "product-site"] },
  };

  function stubPages() {
    vi.stubEnv("KENER_PUBLIC_ORIGINS", "https://status.product.example=product,https://status.other.example=other");
    mockedDb.getPageByPath.mockImplementation(async (path: string) =>
      pages[path] ? ({ id: pages[path].id } as Awaited<ReturnType<typeof db.getPageByPath>>) : undefined,
    );
    mockedDb.getActivePageMonitors.mockImplementation(
      async (pageId: number) =>
        Object.values(pages)
          .find((p) => p.id === pageId)!
          .tags.map((monitor_tag) => ({ monitor_tag })) as Awaited<ReturnType<typeof db.getActivePageMonitors>>,
    );
  }

  it("returns the one admitted page's origin that shows every monitor", async () => {
    stubPages();
    expect(await PublicOriginForMonitors(["product-docs", "product-site"])).toEqual(PRODUCT);
  });

  it("returns null when monitors span pages, two pages show them all, or there are none", async () => {
    stubPages();
    expect(await PublicOriginForMonitors(["product-docs", "other-api"])).toBeNull();
    expect(await PublicOriginForMonitors(["product-site"])).toBeNull();
    expect(await PublicOriginForMonitors([])).toBeNull();
  });

  it("does not read the database when nothing is admitted", async () => {
    vi.stubEnv("KENER_PUBLIC_ORIGINS", "");
    expect(await PublicOriginForMonitors(["product-site"])).toBeNull();
    expect(mockedDb.getPageByPath).not.toHaveBeenCalled();
  });

  it("gives subscriber mail the page origin, and keeps the site URL for global events and failed lookups", async () => {
    stubPages();
    const siteUrl = "https://status.example/";
    expect(await SubscriberMailSiteURL(siteUrl, false, ["product-docs"])).toBe("https://status.product.example/");
    expect(await SubscriberMailSiteURL(siteUrl, true, ["product-docs"])).toBe(siteUrl);

    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedDb.getPageByPath.mockRejectedValue(new Error("database down"));
    expect(await SubscriberMailSiteURL(siteUrl, false, ["product-docs"])).toBe(siteUrl);
  });
});
