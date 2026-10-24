// Shared validator for the Brand Bundle Contract, schemaVersion 1.
//
// One acceptance boundary: the validator executes the bundled JSON Schema itself and then applies the contract's
// cross-field rules, so it can never accept a manifest the schema rejects. Keep `../assets/brand-bundle.schema.json`
// beside this script when copying it. Dependency-free by design: consumers vendor a single file pair.
//
// Usage: node validate-brand-bundle.mjs <bundle-directory>

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA_URL = new URL('../assets/brand-bundle.schema.json', import.meta.url);
const SUPPORTED_SCHEMA_VERSION = 1;
const CORE_ROLES = new Set([
  'mark.primary', 'mark.compact', 'wordmark', 'lockup.default',
  'lockup.compact', 'icon.application', 'icon.favicon', 'icon.touch', 'icon.maskable', 'sponsor.banner',
]);
const RASTER_FORMATS = new Set(['png', 'gif', 'apng', 'ico', 'webp']);
const ANIMATABLE_FORMATS = new Set(['svg', 'gif', 'apng']);
const ANIMATED_SET = ['svg:animated', 'gif:animated', 'svg:static', 'png:static'];
const MOTION_FIELDS = ['durationMs', 'loop', 'playCount'];
// Canonical layout: fixed paths for the design inputs; every other path is derived from manifest meaning.
const FIXED_PATHS = {
  'tokens.reference': 'tokens/reference.json',
  'tokens.semantic': 'tokens/semantic.json',
  'tokens.css': 'css/tokens.css',
  'styles.fonts': 'css/fonts.css',
  'styles.foundation': 'css/foundation.css',
};

export class BrandBundleValidationError extends Error {
  constructor(findings) {
    super(['Brand bundle validation failed:', ...findings.map((finding) => `- ${finding}`)].join('\n'));
    this.name = 'BrandBundleValidationError';
    this.findings = findings;
  }
}

export function loadBrandBundleSchema() {
  return JSON.parse(readFileSync(SCHEMA_URL, 'utf8'));
}

/** RFC 8785 JSON Canonicalization Scheme for parsed JSON values. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    // Default sort compares UTF-16 code units, which is exactly RFC 8785's member order. No locale participates.
    const members = Object.keys(value).sort().map((key) => `${canonicalJson(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  if (typeof value === 'string' && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw new BrandBundleValidationError(['JSON strings must not contain unpaired Unicode surrogates']);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new BrandBundleValidationError(['JSON numbers must be finite IEEE 754 values']);
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new BrandBundleValidationError(['Only JSON values can be canonicalized']);
  return encoded;
}

/** Admit raw manifest bytes before duplicate names or malformed Unicode can be lost by parsing. */
export function parseBrandManifest(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const manifest = JSON.parse(text); // Establish JSON grammar; the original text remains available below.
  const containers = [];
  for (const token of text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]]/gu)) {
    const value = token[0];
    if (value === '{') containers.push(new Set());
    else if (value === '[') containers.push(null);
    else if (value === '}' || value === ']') containers.pop();
    else if (/^\s*:/u.test(text.slice(token.index + value.length))) {
      const key = JSON.parse(value);
      const members = containers.at(-1);
      if (members.has(key)) throw new BrandBundleValidationError([`Duplicate JSON member ${JSON.stringify(key)}`]);
      members.add(key);
    }
  }
  canonicalJson(manifest);
  return manifest;
}

/** SHA-256 of the canonical manifest without its own `bundleSha256` member. */
export function bundleSha256(manifest) {
  const { bundleSha256: _ignored, ...identity } = manifest;
  return createHash('sha256').update(canonicalJson(identity), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------------------------------------------
// Structural layer: a strict interpreter for the JSON Schema 2020-12 keywords the bundled schema uses. An unknown
// keyword is a schema defect rather than something to ignore, so the schema cannot silently outgrow its executor.

const ANNOTATION_KEYWORDS = new Set(['$schema', '$id', '$defs', 'title', 'description']);
const ASSERTION_KEYWORDS = new Set([
  '$ref', 'type', 'const', 'enum', 'oneOf', 'properties', 'required', 'additionalProperties', 'minProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum',
]);

export function validateAgainstSchema(value, schema = loadBrandBundleSchema()) {
  const findings = [];
  checkSchemaNode(value, schema, schema, '$', findings);
  return findings;
}

function checkSchemaNode(value, node, root, at, findings) {
  for (const keyword of Object.keys(node)) {
    if (!ANNOTATION_KEYWORDS.has(keyword) && !ASSERTION_KEYWORDS.has(keyword)) {
      throw new Error(`brand bundle schema uses unsupported keyword ${keyword}`);
    }
  }
  if (node.$ref !== undefined) checkSchemaNode(value, resolveReference(root, node.$ref), root, at, findings);
  if (node.type !== undefined && !hasType(value, node.type)) {
    findings.push(`${at} must be ${node.type}`);
    return;
  }
  if ('const' in node && canonicalJson(value) !== canonicalJson(node.const)) findings.push(`${at} must be ${JSON.stringify(node.const)}`);
  if (node.enum !== undefined && !node.enum.some((option) => canonicalJson(option) === canonicalJson(value))) {
    findings.push(`${at} must be one of ${node.enum.map((option) => JSON.stringify(option)).join(', ')}`);
  }
  if (node.oneOf !== undefined) {
    const matches = node.oneOf.filter((option) => {
      const optionFindings = [];
      checkSchemaNode(value, option, root, at, optionFindings);
      return optionFindings.length === 0;
    }).length;
    if (matches !== 1) findings.push(`${at} must match exactly one allowed form (matched ${matches})`);
  }
  if (typeof value === 'string') checkString(value, node, at, findings);
  if (typeof value === 'number') checkNumber(value, node, at, findings);
  if (Array.isArray(value)) checkArray(value, node, root, at, findings);
  else if (isObject(value)) checkObject(value, node, root, at, findings);
}

function checkString(value, node, at, findings) {
  if (node.minLength !== undefined && [...value].length < node.minLength) findings.push(`${at} must not be empty`);
  if (node.pattern !== undefined && !new RegExp(node.pattern, 'u').test(value)) findings.push(`${at} has an invalid form`);
}

function checkNumber(value, node, at, findings) {
  if (node.minimum !== undefined && value < node.minimum) findings.push(`${at} must be at least ${node.minimum}`);
  if (node.maximum !== undefined && value > node.maximum) findings.push(`${at} must be at most ${node.maximum}`);
  if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) findings.push(`${at} must be greater than ${node.exclusiveMinimum}`);
}

function checkArray(value, node, root, at, findings) {
  if (node.minItems !== undefined && value.length < node.minItems) findings.push(`${at} must have at least ${node.minItems} item(s)`);
  if (node.maxItems !== undefined && value.length > node.maxItems) findings.push(`${at} must have at most ${node.maxItems} item(s)`);
  if (node.uniqueItems === true && new Set(value.map(canonicalJson)).size !== value.length) findings.push(`${at} must not repeat items`);
  if (node.items !== undefined) value.forEach((item, index) => checkSchemaNode(item, node.items, root, `${at}[${index}]`, findings));
}

function checkObject(value, node, root, at, findings) {
  const properties = node.properties ?? {};
  for (const key of node.required ?? []) if (!Object.hasOwn(value, key)) findings.push(`${at}.${key} is required`);
  if (node.minProperties !== undefined && Object.keys(value).length < node.minProperties) findings.push(`${at} must not be empty`);
  for (const [key, member] of Object.entries(value)) {
    if (Object.hasOwn(properties, key)) checkSchemaNode(member, properties[key], root, `${at}.${key}`, findings);
    else if (node.additionalProperties === false) findings.push(`${at}.${key} is not part of schemaVersion 1`);
    else if (isObject(node.additionalProperties)) checkSchemaNode(member, node.additionalProperties, root, `${at}.${key}`, findings);
  }
}

function resolveReference(root, reference) {
  if (!reference.startsWith('#/')) throw new Error(`brand bundle schema reference ${reference} is not local`);
  const target = reference.slice(2).split('/').reduce((node, part) => node?.[part], root);
  if (!isObject(target)) throw new Error(`brand bundle schema reference ${reference} does not resolve`);
  return target;
}

function hasType(value, type) {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    default: throw new Error(`brand bundle schema uses unsupported type ${type}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Contract layer: cross-field rules JSON Schema 2020-12 cannot express without unreadable conditionals.

export function validateBrandManifest(manifest, { schema = loadBrandBundleSchema() } = {}) {
  if (isObject(manifest) && manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION && Number.isInteger(manifest.schemaVersion)) {
    throw new BrandBundleValidationError([
      `schemaVersion ${manifest.schemaVersion} is not implemented by this validator (supports ${SUPPORTED_SCHEMA_VERSION})`,
    ]);
  }
  const structural = validateAgainstSchema(manifest, schema);
  if (structural.length) throw new BrandBundleValidationError(structural);

  const findings = [];
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/u.test(manifest.brand.id)) findings.push('brand.id must be a Windows-portable directory name');
  const files = collectFileReferences(manifest, findings);
  checkLicences(manifest, findings);
  checkAssets(manifest.assets, findings);
  if (manifest.components?.worksSponsor && (manifest.brand.id !== 'works'
      || manifest.source.repository !== 'Wolfsblvt/wolfsblvt.works'
      || !manifest.assets.some((asset) => asset.role === 'sponsor.banner'))) {
    findings.push('components.worksSponsor belongs to brand.id works from Wolfsblvt/wolfsblvt.works and requires sponsor.banner artwork');
  }
  checkLayout(manifest, findings);
  const expected = bundleSha256(manifest);
  if (manifest.bundleSha256 !== expected) findings.push(`bundleSha256 must be ${expected}`);
  if (findings.length) throw new BrandBundleValidationError(findings);
  return { manifest, files: [...files.values()].sort(byPath) };
}

function collectFileReferences(manifest, findings) {
  const files = new Map();
  const add = (file, label) => {
    for (const segment of file.path.split('/')) {
      if (segment.endsWith('.') || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)) {
        findings.push(`${label}.path contains a Windows-reserved segment ${segment}`);
      }
    }
    if (file.path === 'manifest.json') findings.push(`${label}.path must not name manifest.json`);
    const existing = files.get(file.path);
    if (!existing) files.set(file.path, file);
    else if (existing.byteCount !== file.byteCount || existing.sha256 !== file.sha256) {
      findings.push(`${label} conflicts with another reference to ${file.path}`);
    }
  };
  for (const [group, entries] of [['tokens', manifest.tokens], ['styles', manifest.styles]]) {
    for (const [key, file] of Object.entries(entries ?? {})) add(file, `${group}.${key}`);
  }
  for (const [key, file] of Object.entries(manifest.components?.worksSponsor ?? {})) add(file, `components.worksSponsor.${key}`);
  manifest.fonts?.forEach((font, index) => add(font.file, `fonts[${index}].file`));
  manifest.licences?.forEach((licence, index) => add(licence.file, `licences[${index}].file`));
  manifest.assets.forEach((asset, assetIndex) => asset.variants.forEach((variant, variantIndex) => {
    const label = `assets[${assetIndex}].variants[${variantIndex}]`;
    if (variant.qualificationEvidence.bundleFile) add(variant.qualificationEvidence.bundleFile, `${label}.qualificationEvidence.bundleFile`);
    variant.representations.forEach((representation, index) => add(representation.file, `${label}.representations[${index}].file`));
  }));
  return files;
}

function checkLicences(manifest, findings) {
  const licenceIds = new Set();
  manifest.licences?.forEach((licence, index) => {
    if (licenceIds.has(licence.id)) findings.push(`licences[${index}].id ${licence.id} is duplicated`);
    licenceIds.add(licence.id);
  });
  manifest.fonts?.forEach((font, index) => {
    if (!licenceIds.has(font.licenceId)) findings.push(`fonts[${index}].licenceId ${font.licenceId} names no delivered licence`);
    if (font.weight.min > font.weight.max) findings.push(`fonts[${index}].weight range is inverted`);
  });
}

function checkAssets(assets, findings) {
  const roles = new Set();
  assets.forEach((asset, assetIndex) => {
    const label = `assets[${assetIndex}]`;
    if (asset.titleCompatible && !['lockup.default', 'lockup.compact'].includes(asset.role)) {
      findings.push(`${label}.titleCompatible is only valid for an approved title lockup`);
    }
    if (roles.has(asset.role)) findings.push(`${label}.role ${asset.role} is duplicated; a bundle carries one asset per role`);
    roles.add(asset.role);

    const variantKeys = new Set();
    const animatedAppearances = new Set();
    asset.variants.forEach((variant, variantIndex) => {
      const variantLabel = `${label}.variants[${variantIndex}]`;
      const key = variantStem(variant);
      if (variantKeys.has(key)) findings.push(`${variantLabel} repeats appearance and colorMode ${key}`);
      variantKeys.add(key);
      if (checkVariant(variant, variantLabel, asset.role, findings)) animatedAppearances.add(variant.appearance);
    });

    if (!coversBackgrounds(asset.variants.map((variant) => variant.appearance))) {
      findings.push(`${label} (${asset.role}) needs a universal variant or both on-light and on-dark variants`);
    }
    if (animatedAppearances.size && !coversBackgrounds(animatedAppearances)) {
      findings.push(`${label} (${asset.role}) animates, so its animated variants need universal or both on-light and on-dark`);
    }
  });
}

/** Returns whether the variant carries animation. */
function checkVariant(variant, label, role, findings) {
  const backgrounds = new Set(variant.qualifiedBackgrounds);
  const requiredBackgrounds = { universal: ['light', 'dark'], 'on-light': ['light'], 'on-dark': ['dark'] }[variant.appearance];
  for (const background of requiredBackgrounds) {
    if (!backgrounds.has(background)) findings.push(`${label} is ${variant.appearance} but was not qualified on a ${background} background`);
  }

  const tintable = variant.colorMode === 'tintable';
  if (tintable && variant.allowedTintTokens === undefined) findings.push(`${label} is tintable and must list allowedTintTokens`);
  if (!tintable && variant.allowedTintTokens !== undefined) findings.push(`${label}.allowedTintTokens is only valid for tintable variants`);

  const present = new Set();
  const renditions = new Set();
  let authoredMotion;
  variant.representations.forEach((representation, index) => {
    const representationLabel = `${label}.representations[${index}]`;
    const key = `${representation.format}:${representation.motion}`;
    const path = canonicalAssetPath(role, variant, representation);
    if (renditions.has(path)) findings.push(`${representationLabel} repeats rendition ${path}`);
    renditions.add(path);
    if (!representation.adaptive) present.add(key);
    if (representation.adaptive && (representation.format !== 'svg' || !backgrounds.has('light') || !backgrounds.has('dark'))) {
      findings.push(`${representationLabel}: adaptive is SVG-only and requires qualification on both backgrounds`);
    }
    if (representation.motion === 'animated') {
      const motion = MOTION_FIELDS.map((field) => representation[field]);
      if (authoredMotion && motion.some((value, index) => value !== authoredMotion[index])) {
        findings.push(`${representationLabel} must share durationMs, loop and playCount with the authored animation`);
      }
      authoredMotion = motion;
    }
    checkRepresentation(representation, representationLabel, findings);
  });

  if (CORE_ROLES.has(role)) {
    for (const required of ['svg:static', 'png:static']) if (!present.has(required)) findings.push(`${label} (${role}) lacks ${required}`);
  }
  const animated = variant.representations.some((representation) => representation.motion === 'animated');
  if (animated) {
    for (const required of ANIMATED_SET) if (!present.has(required)) findings.push(`${label} animates and lacks ${required}`);
  }
  return animated;
}

function checkRepresentation(representation, label, findings) {
  const raster = RASTER_FORMATS.has(representation.format);
  for (const field of ['width', 'height', 'pixelDensity']) {
    if (raster && representation[field] === undefined) findings.push(`${label}.${field} is required for ${representation.format}`);
    if (!raster && representation[field] !== undefined) findings.push(`${label}.${field} is raster-only`);
  }

  if (representation.motion === 'static') {
    if (representation.format === 'apng') findings.push(`${label}: APNG is an optional animated projection, not a static fallback`);
    for (const field of MOTION_FIELDS) if (representation[field] !== undefined) findings.push(`${label}.${field} is only valid for animation`);
    return;
  }
  if (!ANIMATABLE_FORMATS.has(representation.format)) findings.push(`${label}: ${representation.format} cannot be animated in schemaVersion 1`);
  if (representation.durationMs === undefined) findings.push(`${label}.durationMs is required for animation`);
  if (representation.loop === undefined) findings.push(`${label}.loop is required for animation`);
  if (representation.loop === 'finite' && representation.playCount === undefined) findings.push(`${label}.playCount is required for finite animation`);
  if (representation.loop === 'infinite' && representation.playCount !== undefined) findings.push(`${label}.playCount is forbidden for infinite animation`);
}

/** Canonical role/appearance path, including adaptive, motion and intrinsic raster-size suffixes. */
export function canonicalAssetPath(role, variant, representation) {
  const motion = representation.motion === 'animated' ? '-animated' : '';
  const adaptive = representation.adaptive ? '-adaptive' : '';
  const size = RASTER_FORMATS.has(representation.format) ? `-${representation.width}x${representation.height}` : '';
  return `assets/${roleDirectory(role)}/${variantStem(variant)}${adaptive}${motion}${size}.${representation.format}`;
}

function roleDirectory(role) {
  return role.replace('.', '-');
}

/** `full-color` is the ordinary treatment, so only other colour modes appear in a filename. */
function variantStem(variant) {
  return variant.colorMode === 'full-color' ? variant.appearance : `${variant.appearance}-${variant.colorMode}`;
}

function checkLayout(manifest, findings) {
  const expectPath = (file, expected, label) => {
    const matches = expected instanceof RegExp ? expected.test(file.path) : file.path === expected;
    if (!matches) findings.push(`${label}.path ${file.path} must be ${expected instanceof RegExp ? `of the form ${expected.source}` : expected}`);
  };
  for (const [group, entries] of [['tokens', manifest.tokens], ['styles', manifest.styles]]) {
    for (const [key, file] of Object.entries(entries ?? {})) expectPath(file, FIXED_PATHS[`${group}.${key}`], `${group}.${key}`);
  }
  const sponsorPaths = { template: 'components/works-sponsor.html', stylesheet: 'css/works-sponsor.css', behavior: 'components/works-sponsor.mjs' };
  for (const [key, file] of Object.entries(manifest.components?.worksSponsor ?? {})) {
    expectPath(file, sponsorPaths[key], `components.worksSponsor.${key}`);
  }
  manifest.fonts?.forEach((font, index) => expectPath(font.file, new RegExp(String.raw`^fonts/[a-z0-9][a-z0-9._-]*\.${font.format}$`, 'u'), `fonts[${index}].file`));
  manifest.licences?.forEach((licence, index) => expectPath(licence.file, new RegExp(String.raw`^licences/${licence.id}\.(?:txt|md)$`, 'u'), `licences[${index}].file`));
  manifest.assets.forEach((asset, assetIndex) => asset.variants.forEach((variant, variantIndex) => {
    const label = `assets[${assetIndex}].variants[${variantIndex}]`;
    const evidence = variant.qualificationEvidence.bundleFile;
    if (evidence) {
      const stem = `qualification/${roleDirectory(asset.role)}/${variantStem(variant)}`;
      expectPath(evidence, new RegExp(String.raw`^${stem}\.[a-z0-9]+$`, 'u'), `${label}.qualificationEvidence.bundleFile`);
    }
    variant.representations.forEach((representation, index) => {
      expectPath(representation.file, canonicalAssetPath(asset.role, variant, representation), `${label}.representations[${index}].file`);
    });
  }));
}

function coversBackgrounds(appearances) {
  const set = new Set(appearances);
  return set.has('universal') || (set.has('on-light') && set.has('on-dark'));
}

// ---------------------------------------------------------------------------------------------------------------
// Directory layer: the delivered bytes, their hashes, the complete file set, and what cheap byte sniffing can prove.

export async function validateBrandBundle(bundleDirectory, options = {}) {
  const root = await realpath(resolve(bundleDirectory));
  let manifest;
  try {
    manifest = parseBrandManifest(await readFile(join(root, 'manifest.json')));
  } catch (error) {
    throw new BrandBundleValidationError([`manifest.json could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`]);
  }

  const validated = validateBrandManifest(manifest, options);
  const findings = [];
  const expectedBrandId = options.expectedBrandId ?? basename(root);
  if (manifest.brand.id !== expectedBrandId) findings.push(`brand.id ${manifest.brand.id} does not match bundle directory brand id ${expectedBrandId}`);
  const unreferenced = new Set(await collectFiles(root, root, findings));
  unreferenced.delete('manifest.json');

  const bytesByPath = new Map();
  for (const file of validated.files) {
    unreferenced.delete(file.path);
    const target = join(root, ...file.path.split('/'));
    let bytes;
    try {
      bytes = await readFile(target);
    } catch {
      findings.push(`${file.path} does not exist`);
      continue;
    }
    if (bytes.byteLength !== file.byteCount) findings.push(`${file.path} is ${bytes.byteLength} bytes, not ${file.byteCount}`);
    if (sha256Hex(bytes) !== file.sha256) findings.push(`${file.path} sha256 does not match`);
    bytesByPath.set(file.path, bytes);
  }
  for (const path of [...unreferenced].sort()) findings.push(`${path} exists but manifest.json does not reference it`);

  forEachRepresentation(manifest, (representation, label) => {
    const bytes = bytesByPath.get(representation.file.path);
    if (bytes) sniffRepresentation(bytes, representation, label, findings);
  });
  manifest.fonts?.forEach((font, index) => {
    const bytes = bytesByPath.get(font.file.path);
    if (bytes && !hasFontSignature(bytes, font.format)) findings.push(`fonts[${index}].file is not ${font.format} data`);
  });

  if (findings.length) throw new BrandBundleValidationError(findings);
  return validated;
}

async function collectFiles(root, directory, findings) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).split(sep).join('/');
    if ((await lstat(path)).isSymbolicLink()) findings.push(`${relativePath} is a symbolic link`);
    else if (entry.isDirectory()) files.push(...await collectFiles(root, path, findings));
    else if (entry.isFile()) files.push(relativePath);
    else findings.push(`${relativePath} is not a regular file`);
  }
  return files;
}

function forEachRepresentation(manifest, visit) {
  manifest.assets.forEach((asset, assetIndex) => asset.variants.forEach((variant, variantIndex) => {
    variant.representations.forEach((representation, index) => {
      visit(representation, `assets[${assetIndex}].variants[${variantIndex}].representations[${index}]`);
    });
  }));
}

function sniffRepresentation(bytes, representation, label, findings) {
  switch (representation.format) {
    case 'svg': {
      const text = bytes.toString('utf8');
      if (!/<svg\b[^>]*\bviewBox\s*=/u.test(text)) findings.push(`${label} is not an SVG with a viewBox`);
      return;
    }
    case 'png':
    case 'apng': {
      const png = readPngHeader(bytes);
      if (!png) return findings.push(`${label} is not PNG data`);
      checkDimensions(png, representation, label, findings);
      return;
    }
    case 'gif': {
      const gif = readGif(bytes);
      if (!gif) return findings.push(`${label} is not readable GIF data`);
      checkDimensions(gif, representation, label, findings);
      checkGifMotion(gif, representation, label, findings);
      return;
    }
    case 'ico':
      if (!startsWith(bytes, [0, 0, 1, 0])) findings.push(`${label} is not ICO data`);
      return;
    case 'webp':
      if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') findings.push(`${label} is not WebP data`);
      return;
    case 'pdf':
      if (bytes.toString('latin1', 0, 5) !== '%PDF-') findings.push(`${label} is not PDF data`);
      return;
  }
}

function checkDimensions(actual, representation, label, findings) {
  if (actual.width !== representation.width || actual.height !== representation.height) {
    findings.push(`${label} is ${actual.width}x${actual.height}, not ${representation.width}x${representation.height}`);
  }
}

function checkGifMotion(gif, representation, label, findings) {
  if (representation.motion === 'static') {
    if (gif.frames !== 1) findings.push(`${label} is static but has ${gif.frames} frames`);
    return;
  }
  if (gif.frames < 2) findings.push(`${label} is animated but has ${gif.frames} frame`);
  // GIF stores repetitions after the first play in the NETSCAPE2.0 extension: absent means one play, 0 means forever.
  const loop = gif.loopCount === 0 ? 'infinite' : 'finite';
  const playCount = gif.loopCount === undefined ? 1 : gif.loopCount + 1;
  if (loop !== representation.loop) findings.push(`${label} GIF loops ${loop}, not ${representation.loop}`);
  else if (loop === 'finite' && playCount !== representation.playCount) findings.push(`${label} GIF plays ${playCount} time(s), not ${representation.playCount}`);
  if (gif.durationMs !== representation.durationMs) findings.push(`${label} GIF frame delays total ${gif.durationMs} ms, not ${representation.durationMs}`);
}

function readPngHeader(bytes) {
  if (bytes.length < 24 || !startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return undefined;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readGif(bytes) {
  const signature = bytes.toString('latin1', 0, 6);
  if (bytes.length < 13 || (signature !== 'GIF87a' && signature !== 'GIF89a')) return undefined;
  const gif = { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8), frames: 0, durationMs: 0, loopCount: undefined };
  let offset = 13 + colorTableSize(bytes[10]);
  while (offset < bytes.length) {
    const introducer = bytes[offset];
    if (introducer === 0x3b) return gif;
    if (introducer === 0x21) {
      const label = bytes[offset + 1];
      const firstBlock = offset + 2;
      if (label === 0xf9 && bytes[firstBlock] === 4) gif.durationMs += bytes.readUInt16LE(firstBlock + 2) * 10;
      if (label === 0xff && bytes.toString('latin1', firstBlock + 1, firstBlock + 12) === 'NETSCAPE2.0') {
        const data = firstBlock + 12;
        if (bytes[data] === 3 && bytes[data + 1] === 1) gif.loopCount = bytes.readUInt16LE(data + 2);
      }
      offset = skipSubBlocks(bytes, firstBlock);
    } else if (introducer === 0x2c) {
      gif.frames += 1;
      offset = skipSubBlocks(bytes, offset + 10 + colorTableSize(bytes[offset + 9]) + 1);
    } else return undefined;
    if (offset === undefined) return undefined;
  }
  return undefined;
}

function colorTableSize(packed) {
  return packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
}

function skipSubBlocks(bytes, offset) {
  while (offset < bytes.length) {
    const size = bytes[offset];
    offset += 1 + size;
    if (size === 0) return offset;
  }
  return undefined;
}

function hasFontSignature(bytes, format) {
  const tag = bytes.toString('latin1', 0, 4);
  switch (format) {
    case 'woff2': return tag === 'wOF2';
    case 'woff': return tag === 'wOFF';
    case 'otf': return tag === 'OTTO';
    case 'ttf': return startsWith(bytes, [0, 1, 0, 0]) || tag === 'true';
    default: return false;
  }
}

function startsWith(bytes, prefix) {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function byPath(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  const directory = process.argv[2];
  const explicitId = process.argv[3] === '--brand-id' && process.argv[4];
  if (!directory || !(process.argv.length === 3 || (process.argv.length === 5 && explicitId))) {
    console.error('Usage: node validate-brand-bundle.mjs <bundle-directory> [--brand-id <id-for-temporary-extraction>]');
    process.exitCode = 2;
  } else {
    try {
      const result = await validateBrandBundle(directory, explicitId ? { expectedBrandId: explicitId } : {});
      console.log(`Brand bundle valid: ${result.manifest.brand.displayName} (bundleSha256 ${result.manifest.bundleSha256})`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
