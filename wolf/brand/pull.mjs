// Vendor pinned product brand bundles into vendor/brand/<id>/ and validate them (Brand Bundle Contract v1).
//
//   node wolf/brand/pull.mjs           fetch every pin from its owning repository, replace the vendored copy, validate,
//                                      and record the fetched bundle's bundleSha256 in its pin
//   node wolf/brand/pull.mjs --check   validate the committed copies against their pins without network (used by the image build)
//
// Bundles are only ever copied byte for byte from the owning repository at the pinned commit. A bundle's own hashes
// only prove it is self-consistent, so each pin also records the bundleSha256 of the bundle fetched from that commit.
// The check fails when the vendored bundle is not that bundle, even if it is valid on its own. Kener serves the
// bundles same-origin at /brand/<id>/ because the image build copies vendor/brand into static/brand.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateBrandBundle } from './scripts/validate-brand-bundle.mjs';

const root = resolve(import.meta.dirname, '../..');
const pinsPath = join(import.meta.dirname, 'pins.json');
const pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
const { bundles } = pins;
const checkOnly = process.argv.includes('--check');
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fetchBundle({ id, repository, commit }) {
  const work = mkdtempSync(join(tmpdir(), `kener-brand-${id}-`));
  try {
    git(work, 'init', '--quiet');
    // Transported bytes must not be converted on checkout, whatever the machine's Git defaults are.
    git(work, 'config', 'core.autocrlf', 'false');
    git(work, 'sparse-checkout', 'set', '--no-cone', `/brand/bundle/${id}/`);
    git(work, 'fetch', '--quiet', '--depth', '1', `https://github.com/${repository}.git`, commit);
    git(work, 'checkout', '--quiet', 'FETCH_HEAD');
    if (git(work, 'rev-parse', 'HEAD') !== commit) throw new Error(`${id}: fetched commit does not match pin`);
    const source = join(work, 'brand', 'bundle', id);
    if (!existsSync(join(source, 'manifest.json'))) throw new Error(`${id}: ${repository}@${commit} has no brand/bundle/${id}/manifest.json`);
    const target = join(root, 'vendor', 'brand', id);
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

let failed = false;
for (const pin of bundles) {
  if (!COMMIT.test(pin.commit)) throw new Error(`${pin.id}: pin must be a full 40-character commit`);
  if (!checkOnly) fetchBundle(pin);
  const directory = join(root, 'vendor', 'brand', pin.id);
  try {
    const { manifest } = await validateBrandBundle(directory);
    if (manifest.source.repository !== pin.repository) throw new Error(`manifest names ${manifest.source.repository}, pin names ${pin.repository}`);
    if (!checkOnly) pin.bundleSha256 = manifest.bundleSha256;
    if (!SHA256.test(pin.bundleSha256 ?? '')) throw new Error('pin has no bundleSha256; run node wolf/brand/pull.mjs to record it from the pinned commit');
    if (manifest.bundleSha256 !== pin.bundleSha256) {
      throw new Error(`vendored bundle is ${manifest.bundleSha256}, but the bundle at ${pin.repository}@${pin.commit} is ${pin.bundleSha256}; vendor/brand must come from the pin (node wolf/brand/pull.mjs)`);
    }
    console.log(`${pin.id}: valid, ${pin.repository}@${pin.commit.slice(0, 12)}, bundleSha256 ${manifest.bundleSha256.slice(0, 12)} matches pin`);
  } catch (error) {
    failed = true;
    console.error(`${pin.id}: ${error.message}`);
  }
}
if (failed) process.exit(1);
if (!checkOnly) writeFileSync(pinsPath, `${JSON.stringify(pins, null, 2)}\n`);
