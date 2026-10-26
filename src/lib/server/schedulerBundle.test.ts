import { describe, expect, it } from "vitest";
import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";

// The production entry (scripts/main.ts) runs the scheduler and serves the SvelteKit handler. It is bundled by
// esbuild (scripts/build-server.js), not Vite, so Vite-only syntax in any module it reaches is copied verbatim
// into build/main.js and stops the server at startup. Same entry, externals and alias as that build.
describe("production server bundle", () => {
  it("reaches no Vite-only import.meta.glob", async () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const result = await esbuild.build({
      entryPoints: ["scripts/main.ts"],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      write: false,
      logLevel: "silent",
      external: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].filter(
        (dep) => dep !== "rrule",
      ),
      alias: { $lib: "./src/lib" },
      plugins: [
        {
          name: "sveltekit-build-output",
          setup(build) {
            build.onResolve({ filter: /^\.\.\/build\// }, (args) => ({ path: args.path, external: true }));
          },
        },
      ],
    });
    const bundle = result.outputFiles.map((file) => file.text).join("\n");
    expect(bundle.length).toBeGreaterThan(0);
    expect(bundle.match(/import\.meta\.glob\s*[(<]/g) ?? []).toEqual([]);
  }, 60000);
});
