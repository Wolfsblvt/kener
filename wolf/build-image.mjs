import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Refuse the wrong repository or uncommitted source, then archive the captured commit.
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
const contextHome = join(root, "artifacts", "build");
mkdirSync(contextHome, { recursive: true });
const contextDirectory = mkdtempSync(join(contextHome, "image-context-"));
let context;
try {
  const archive = join(contextDirectory, "source.tar");
  git("archive", "--format=tar", `--output=${archive}`, revision);
  context = openSync(archive, "r");
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
      "-",
    ],
    { stdio: [context, "inherit", "inherit"], windowsHide: true },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (context !== undefined) closeSync(context);
  rmSync(contextDirectory, { recursive: true, force: true });
}
