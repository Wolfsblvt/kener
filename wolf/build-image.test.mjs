import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, test } from "node:test";

const repository = resolve(import.meta.dirname, "..");
const fixtures = join(repository, "artifacts", "test", "build-image");
let home;
let root;

function git(...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

beforeEach(() => {
  mkdirSync(fixtures, { recursive: true });
  home = mkdtempSync(join(fixtures, "fixture-"));
  root = join(home, "repository");
  mkdirSync(join(root, "wolf"), { recursive: true });
  copyFileSync(join(repository, "wolf", "build-image.mjs"), join(root, "wolf", "build-image.mjs"));
  writeFileSync(join(root, ".gitignore"), "/artifacts/\n/static/uploads/\n");
  writeFileSync(join(root, ".gitattributes"), "* text=auto eol=lf\n");
  writeFileSync(join(root, "source.txt"), "committed source\n");
  git("init");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture");

  // Intercept only Docker; the real helper, Git checks and archive run unchanged.
  writeFileSync(
    join(home, "docker-double.mjs"),
    `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { readFileSync, writeFileSync } from 'node:fs';
    const original = childProcess.spawnSync;
    childProcess.spawnSync = (command, args, options) => {
      if (command !== 'docker') return original(command, args, options);
      writeFileSync(process.env.BUILD_CALL, JSON.stringify(args));
      writeFileSync(process.env.BUILD_SOURCE, 'changed after source checks\\n');
      if (args.at(-1) === '-') writeFileSync(process.env.BUILD_CAPTURE, readFileSync(options.stdio[0]));
      return { status: Number(process.env.BUILD_EXIT || 0) };
    };
    syncBuiltinESMExports();
  `,
  );
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

function build(extraArgs = [], exit = 0) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(join(home, "docker-double.mjs")).href,
      join(root, "wolf", "build-image.mjs"),
      "--tag",
      "fixture:local",
      ...extraArgs,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        BUILD_CALL: join(home, "call.json"),
        BUILD_SOURCE: join(root, "source.txt"),
        BUILD_CAPTURE: join(home, "context.tar"),
        BUILD_EXIT: String(exit),
      },
    },
  );
}

test("Docker consumes the captured commit and excludes ignored local state", () => {
  const revision = git("rev-parse", "HEAD");
  mkdirSync(join(root, "static", "uploads"), { recursive: true });
  writeFileSync(join(root, "static", "uploads", "ignored-local.txt"), "private sentinel");
  assert.equal(git("status", "--porcelain"), "");
  const result = build(["--variant", "alpine", "--with-docs"]);
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(readFileSync(join(home, "call.json"), "utf8"));
  assert.equal(args.at(-1), "-");
  for (const value of [`SOURCE_REVISION=${revision}`, "VARIANT=alpine", "WITH_DOCS=true"])
    assert.ok(args.includes(value));
  const archive = join(home, "context.tar");
  const files = execFileSync("tar", ["-tf", archive], { encoding: "utf8", windowsHide: true });
  assert.doesNotMatch(files, /ignored-local|artifacts\/|\.git\//);
  assert.equal(
    execFileSync("tar", ["-xOf", archive, "source.txt"], { encoding: "utf8", windowsHide: true }),
    "committed source\n",
  );
  assert.equal(readFileSync(join(root, "source.txt"), "utf8"), "changed after source checks\n");
  assert.deepEqual(readdirSync(join(root, "artifacts", "build")), []);
});

test("tracked and untracked source changes refuse before Docker", () => {
  for (const filename of ["source.txt", "untracked.txt"]) {
    writeFileSync(join(root, filename), "uncommitted\n");
    const result = build();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Commit or preserve working changes/);
    assert.equal(existsSync(join(home, "call.json")), false);
    if (filename === "source.txt") git("restore", "source.txt");
  }
});

test("a missing repository marker cannot select a parent repository", () => {
  execFileSync("git", ["-C", home, "init"], { windowsHide: true });
  rmSync(join(root, ".git"), { recursive: true, force: true });
  const result = build();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be this Git repository's root/);
  assert.equal(existsSync(join(home, "call.json")), false);
});

test("a failed Docker build preserves its exit status and removes its temporary context", () => {
  const result = build([], 23);
  assert.equal(result.status, 23, result.stderr);
  assert.deepEqual(readdirSync(join(root, "artifacts", "build")), []);
});
