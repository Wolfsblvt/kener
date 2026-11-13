import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// The label identifies committed build inputs, so refuse a dirty or different context.
const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  options: {
    tag: { type: "string" },
    variant: { type: "string", default: "debian" },
    "with-docs": { type: "boolean", default: false },
  },
});
if (!values.tag || !["alpine", "debian"].includes(values.variant)) {
  throw new Error("Use --tag <local-image-tag> [--variant debian|alpine] [--with-docs]");
}
const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
if (realpathSync(git("rev-parse", "--show-toplevel")) !== realpathSync(root)) {
  throw new Error("The image build context must be this Git repository's root.");
}
if (git("status", "--porcelain")) {
  throw new Error("Commit or preserve working changes before building a revision-labelled image.");
}
const revision = git("rev-parse", "HEAD");
const result = spawnSync(
  "docker",
  [
    "build",
    "--platform",
    "linux/amd64",
    "--build-arg",
    `SOURCE_REVISION=${revision}`,
    "--build-arg",
    `VARIANT=${values.variant}`,
    "--build-arg",
    `WITH_DOCS=${values["with-docs"]}`,
    "--tag",
    values.tag,
    root,
  ],
  { stdio: "inherit", windowsHide: true },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
