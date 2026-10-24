// Vendor pinned product brand bundles into vendor/brand/<id>/ and validate them (Brand Bundle Contract v1).
//
//   node wolf/brand/pull.mjs           fetch every pin from its owning repository, replace the vendored copy, validate
//   node wolf/brand/pull.mjs --check   validate the committed copies against their pins without network (used by the image build)
//
// Bundles are only ever copied byte for byte from the owning repository at the pinned commit. Kener serves them
// same-origin at /brand/<id>/ because the image build copies vendor/brand into static/brand.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateBrandBundle } from './scripts/validate-brand-bundle.mjs';

const root = resolve(import.meta.dirname, '../..');
const { bundles } = JSON.parse(readFileSync(join(import.meta.dirname, 'pins.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');
const COMMIT = /^[0-9a-f]{40}$/;

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
    console.log(`${pin.id}: valid, ${pin.repository}@${pin.commit.slice(0, 12)}, bundleSha256 ${manifest.bundleSha256.slice(0, 12)}`);
  } catch (error) {
    failed = true;
    console.error(`${pin.id}: ${error.message}`);
  }
}
if (failed) process.exit(1);
