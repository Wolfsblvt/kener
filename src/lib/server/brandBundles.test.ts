import { describe, expect, it } from "vitest";
import { BrandFavicon, BrandWordmarkName } from "./brandBundles";

describe("BrandFavicon", () => {
  it("takes the favicon of the vendored bundle a logo comes from, in the logo's appearance", () => {
    expect(BrandFavicon("/brand/diffdevil/assets/wordmark/on-dark.svg")).toBe(
      "/brand/diffdevil/assets/icon-favicon/on-dark.svg",
    );
    expect(BrandFavicon("/brand/diffdevil/assets/lockup-compact/on-light-600x508.png")).toBe(
      "/brand/diffdevil/assets/icon-favicon/on-light.svg",
    );
  });

  it.each([
    null,
    undefined,
    "",
    "/uploads/logo.png",
    "https://cdn.example/brand/diffdevil/assets/wordmark/on-dark.svg",
  ])("has none for a logo outside a vendored bundle: %o", (logo) => {
    expect(BrandFavicon(logo)).toBeUndefined();
  });

  it("has none for a bundle this fork does not vendor", () => {
    expect(BrandFavicon("/brand/unknown/assets/wordmark/on-dark.svg")).toBeUndefined();
  });
});

describe("BrandWordmarkName", () => {
  it("names the brand a vendored wordmark or lockup spells", () => {
    expect(BrandWordmarkName("/brand/diffdevil/assets/wordmark/on-dark.svg")).toBe("diffdevil");
    expect(BrandWordmarkName("/brand/works/assets/lockup-compact/on-dark.svg")).toBe("Wolfsblvt Works");
    expect(BrandWordmarkName("/brand/diffdevil/assets/lockup-default/on-light-600x149.png")).toBe("diffdevil");
  });

  it.each([
    "/brand/works/assets/mark-primary/on-dark.svg",
    "/brand/diffdevil/assets/icon-favicon/on-dark.svg",
    "/brand/diffdevil/assets/wordmark/missing.svg",
    "/brand/unknown/assets/wordmark/on-dark.svg",
    "/uploads/logo.png",
    null,
  ])("has none for a mark, an unknown file or a logo outside a vendored bundle: %o", (logo) => {
    expect(BrandWordmarkName(logo)).toBeUndefined();
  });
});
