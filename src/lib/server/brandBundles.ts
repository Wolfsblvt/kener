/**
 * Wolfsblvt fork: the product brand bundles this fork vendors (wolf/brand) and serves same-origin at
 * /brand/<id>/. Their manifests are read at build time through Vite's import.meta.glob, so only code that Vite
 * builds may import this module, such as the layout. The production entry is bundled by esbuild, which copies
 * import.meta.glob verbatim and fails at startup; schedulerBundle.test.ts keeps this module out of it.
 */
interface BrandManifest {
  assets?: Array<{
    role?: string;
    variants?: Array<{ appearance?: string; representations?: Array<{ format?: string; file?: { path?: string } }> }>;
  }>;
}

const brandManifests = import.meta.glob<BrandManifest>("/vendor/brand/*/manifest.json", {
  eager: true,
  import: "default",
});

/**
 * The SVG favicon of the brand bundle a logo is served from, in the logo's appearance: for
 * "/brand/<id>/assets/wordmark/on-dark.svg", that bundle's `icon.favicon` on-dark SVG. Undefined for a
 * logo outside a vendored bundle, or a bundle without a favicon.
 */
export function BrandFavicon(logo: string | null | undefined): string | undefined {
  const match = logo?.match(/^\/brand\/([a-z0-9-]+)\/assets\/[^/]+\/([^/]+)$/);
  if (!match) return undefined;
  const [, id, file] = match;
  const favicon = brandManifests[`/vendor/brand/${id}/manifest.json`]?.assets?.find((a) => a.role === "icon.favicon");
  const variants = favicon?.variants ?? [];
  const variant = variants.find((v) => v.appearance && file.startsWith(v.appearance)) ?? variants[0];
  const path = variant?.representations?.find((r) => r.format === "svg")?.file?.path;
  return path ? `/brand/${id}/${path}` : undefined;
}
