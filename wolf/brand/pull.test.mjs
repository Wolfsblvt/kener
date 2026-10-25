// node --test wolf/brand/pull.test.mjs
//
// The offline check the image build runs must refuse a vendored bundle that is valid on its own but is not the bundle
// its pin names. Each test runs the real pull.mjs --check against a disposable copy of wolf/brand and vendor/brand.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleSha256, validateBrandBundle } from './scripts/validate-brand-bundle.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kener-brand-check-'));
  cpSync(join(repositoryRoot, 'wolf', 'brand'), join(root, 'wolf', 'brand'), { recursive: true });
  cpSync(join(repositoryRoot, 'vendor', 'brand'), join(root, 'vendor', 'brand'), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function check() {
  try {
    const stdout = execFileSync(process.execPath, [join(root, 'wolf', 'brand', 'pull.mjs'), '--check'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.status, output: `${error.stdout}${error.stderr}` };
  }
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const pinsPath = () => join(root, 'wolf', 'brand', 'pins.json');

/** Change one SVG and update every hash in its manifest, as someone editing the vendored copy would. */
function rewriteWorksMark() {
  const bundle = join(root, 'vendor', 'brand', 'works');
  const manifest = readJson(join(bundle, 'manifest.json'));
  const reference = manifest.assets[0].variants[0].representations.find((r) => r.format === 'svg').file;
  const path = join(bundle, ...reference.path.split('/'));
  const bytes = Buffer.concat([readFileSync(path), Buffer.from('<!-- changed outside the owning repository -->\n')]);
  writeFileSync(path, bytes);
  reference.byteCount = bytes.byteLength;
  reference.sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest.bundleSha256 = bundleSha256(manifest);
  writeFileSync(join(bundle, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { bundle, identity: manifest.bundleSha256 };
}

test('the committed bundles match their pins', () => {
  const result = check();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /works: valid, .* matches pin/);
});

test('a self-consistent bundle that is not the pinned one fails the check', async () => {
  const { bundle, identity } = rewriteWorksMark();
  await validateBrandBundle(bundle); // valid on its own: every internal hash agrees

  const result = check();
  assert.equal(result.code, 1);
  assert.match(result.output, new RegExp(`works: vendored bundle is ${identity}, but the bundle at Wolfsblvt/wolfsblvt\\.works@`));
});

test('the changed bundle passes only once its pin is deliberately advanced', () => {
  const { identity } = rewriteWorksMark();
  const pins = readJson(pinsPath());
  pins.bundles.find((pin) => pin.id === 'works').bundleSha256 = identity;
  writeFileSync(pinsPath(), JSON.stringify(pins));

  assert.equal(check().code, 0);
});

test('a pin without a recorded bundleSha256 fails the check', () => {
  const pins = readJson(pinsPath());
  delete pins.bundles.find((pin) => pin.id === 'diffdevil').bundleSha256;
  writeFileSync(pinsPath(), JSON.stringify(pins));

  const result = check();
  assert.equal(result.code, 1);
  assert.match(result.output, /diffdevil: pin has no bundleSha256/);
});
