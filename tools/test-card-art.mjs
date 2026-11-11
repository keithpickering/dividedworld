/**
 * Tests for the guard in tools/check-card-art.mjs.
 *
 *   node tools/test-card-art.mjs
 *
 * The guard fails a card-art folder (instances/<name>/ui/cards/<key>/), or an instance's card back
 * folder (instances/<name>/ui/card-back/, docs/plans/2026-11-11-rendered-card-back-plan.md, Task 1), that lacks a file, has no
 * canvas or two, the wrong canvas (an SVG off its viewBox; a WebP that is not one, is the wrong size
 * or is animated), a bad manifest, an oversize file, or an SVG that runs or reaches out
 * (docs/plans/2026-11-05-card-template-plan.md, Task 2; docs/plans/2026-11-11-rendered-card-art-plan.md,
 * Task 1). This reads no file in the repository: each
 * case writes a repository-shaped scratch folder in os.tmpdir() and runs the check over it through
 * its function and through the command, whose exit code is what the build reads.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardArtFaults } from './check-card-art.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-card-art.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'card-art-'));
let pass = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    failures.push(name + (detail ? '  <- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  <- ' + detail : ''));
  }
  return Boolean(condition);
}

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const ART = (inner = '', attrs = '') => `<svg ${NS} viewBox="0 0 540 840"${attrs}>${inner}<rect width="540" height="840"/></svg>`;
const MARK = `<svg ${NS} viewBox="0 0 120 120"><circle cx="60" cy="60" r="50"/></svg>`;
const JSON_OK = JSON.stringify({ credit: 'An Artist', license: 'CC BY 4.0' });

// Real WebP images, made once with Pillow (libwebp) and held as base64: a flat gray, at 1080 by 1680 saved lossy
// (a "VP8 " chunk), lossless ("VP8L") and lossy with a partly transparent alpha channel ("VP8X"), and at 540 by 840.
const b64 = (s) => Buffer.from(s, 'base64');
const WEBP_LOSSY = b64('UklGRuYMAABXRUJQVlA4INoMAABwgwGdASo4BJAGPm02m0mkIyKhIAgAgA2JaW7hd2EbQAwwi5OQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ9YAA/ooAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==');
const WEBP_LOSSLESS = b64('UklGRnAAAABXRUJQVlA4TGMAAAAvN8SjAQdQwAIWsP8BAUnS//9hRP8z/vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c9//vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c9//vOf//znP//5fwkA');
const WEBP_EXT = b64('UklGRl4NAABXRUJQVlA4WAoAAAAQAAAANwQAjwYAQUxQSF0AAAABB1DAiAgISJL+/w8j+p/xn//85z//+c9//vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c9//vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c//SwAAVlA4INoMAABwgwGdASo4BJAGPm02m0mkIyKhIAgAgA2JaW7hd2EbQAwwi5OQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ9YAA/ooAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==');
const WEBP_SMALL = b64('UklGRmgDAABXRUJQVlA4IFwDAAAwZACdASocAkgDPm02m0mkIyKhIAgAgA2JaW7hd2EbQAwwi5OQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIbwAA/ooAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
/** A copy of a buffer with `edit(copy)` applied. */
const altered = (buf, edit) => {
  const c = Buffer.from(buf);
  edit(c);
  return c;
};

let n = 0;
/**
 * A repository-shaped folder with one clean card folder, then `poison(files)` applied: `files` maps
 * a name in the card folder to its content (a string or a Buffer), or to null for no file.
 * @param {(files: Record<string, string | Buffer | null>) => void} [poison]
 */
function repo(poison = () => {}) {
  /** @type {Record<string, string | Buffer | null>} */
  const files = { 'art.svg': ART(), 'mark.svg': MARK, 'art.json': JSON_OK };
  poison(files);
  const dir = path.join(root, `r${n++}`);
  const card = path.join(dir, 'instances/demo/ui/cards/demo-card');
  fs.mkdirSync(card, { recursive: true });
  for (const [f, body] of Object.entries(files)) if (body !== null) fs.writeFileSync(path.join(card, f), body);
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [script, '--root', dir], { encoding: 'utf8' });

/** One poison: the function names it (matching `want`), and the command exits 1 saying so. */
function red(name, poison, want) {
  const dir = repo(poison);
  const faults = cardArtFaults(dir);
  const hit = faults.some((f) => want.test(f));
  check(name, hit, JSON.stringify(faults));
  const c = run(dir);
  check('  and the command exits 1 naming it', c.status === 1 && want.test(c.stderr), `${c.status} ${c.stderr}`);
}
/** A file that must pass. */
function green(name, poison) {
  const dir = repo(poison);
  const faults = cardArtFaults(dir);
  check(name, faults.length === 0, JSON.stringify(faults));
  const c = run(dir);
  check('  and the command exits 0', c.status === 0, `${c.status} ${c.stderr}`);
}
const art = (inner, attrs) => (f) => { f['art.svg'] = ART(inner, attrs); };

try {
  green('a clean card folder has no fault', () => {});

  /* ---- the real shape of a repository with none ---- */
  {
    const dir = path.join(root, 'empty');
    fs.mkdirSync(path.join(dir, 'instances/demo/ui/cards'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'instances/demo/ui/cards/stick-around.svg'), '<svg onload="x()"/>');
    check('no card folder (a plain file in ui/cards/ is ignored) has no fault', cardArtFaults(dir).length === 0);
    check('  and the command exits 0', run(dir).status === 0);
    const none = path.join(root, 'no-instances');
    fs.mkdirSync(none);
    check('a repository with no instances has no fault', cardArtFaults(none).length === 0);
  }

  /* ---- (1) files ---- */
  red('mark.svg missing', (f) => { f['mark.svg'] = null; }, /mark\.svg.*missing/);
  red('art.json missing', (f) => { f['art.json'] = null; }, /art\.json.*missing/);
  red('no canvas at all', (f) => { f['art.svg'] = null; }, /missing a canvas; a card's art folder holds art\.svg or art\.webp/);

  /* ---- (2), (3) canvases ---- */
  red('a canvas at 0 0 120 110', (f) => { f['art.svg'] = `<svg ${NS} viewBox="0 0 120 110"/>`; }, /art\.svg.*viewBox/);
  red('a canvas with no viewBox', (f) => { f['art.svg'] = `<svg ${NS}/>`; }, /art\.svg.*viewBox/);
  red('a mark at 0 0 120 110', (f) => { f['mark.svg'] = `<svg ${NS} viewBox="0 0 120 110"/>`; }, /mark\.svg.*square/);
  green('a canvas viewBox with any whitespace passes', (f) => { f['art.svg'] = `<svg ${NS} viewBox=" 0\t0  540\n840 "/>`; });

  /* ---- (4) manifest ---- */
  red('a manifest with an empty credit', (f) => { f['art.json'] = JSON.stringify({ credit: '', license: 'x' }); }, /art\.json.*credit/);
  red('a manifest with no license', (f) => { f['art.json'] = JSON.stringify({ credit: 'x' }); }, /art\.json.*license/);
  red('a manifest that is not JSON', (f) => { f['art.json'] = '{credit:'; }, /art\.json.*JSON/);

  /* ---- (5) sizes ---- */
  red('a canvas of 201 KB', (f) => { f['art.svg'] = ART(`<!--${'a'.repeat(201 * 1024)}-->`); }, /art\.svg.*200 KB/);
  red('a mark over 20 KB', (f) => { f['mark.svg'] = `<svg ${NS} viewBox="0 0 1 1"><!--${'a'.repeat(21 * 1024)}--></svg>`; }, /mark\.svg.*20 KB/);
  red('a manifest over 2 KB', (f) => { f['art.json'] = JSON.stringify({ credit: 'x'.repeat(3000), license: 'y' }); }, /art\.json.*2 KB/);

  /* ---- (6) nothing runs or reaches out ---- */
  red('a canvas holding <SCRIPT>', art('<SCRIPT>alert(1)</SCRIPT>'), /art\.svg.*<script/i);
  red('a canvas holding <foreignObject>', art('<foreignObject width="1" height="1"/>'), /art\.svg.*foreignObject/i);
  red('a canvas holding <image href="data:...">', art('<image href="data:image/png;base64,AAAA"/>'), /art\.svg.*<image/i);
  red('a canvas with onload', art('', ' onload="alert(1)"'), /art\.svg.*on/i);
  red('a canvas with an ONCLICK attribute in another case', art('<g ONCLICK="x()"/>'), /art\.svg.*on/i);
  red('a canvas with <style>@import</style>', art('<style>@import "x.css";</style>'), /art\.svg.*@import/i);
  red('a canvas with fill="url(https://example.com/a#b)"', art('<rect fill="url(https://example.com/a#b)"/>'), /art\.svg.*url\(/);
  red('a canvas with <use href="https://example.com/a.svg#b"/>', art('<use href="https://example.com/a.svg#b"/>'), /art\.svg.*href/);
  red('a canvas with xlink:href to a URL', art('<use xlink:href="https://example.com/a.svg#b"/>'), /art\.svg.*href/);
  red('a mark holding <script>', (f) => { f['mark.svg'] = `<svg ${NS} viewBox="0 0 1 1"><script/></svg>`; }, /mark\.svg.*<script/i);
  red('a CSS url( outside an attribute', art('<style>.a{fill:url(https://x/y)}</style>'), /art\.svg.*url\(/);
  {
    // The reading is linear in the file: a canvas just under its cap, one long run of text with no "=" in it (a
    // comment, a title), is read in well under a second, not retried from every character of the run.
    const dir = repo(art(`<!--${'a'.repeat(190 * 1024)}-->`));
    const t0 = performance.now();
    const faults = cardArtFaults(dir);
    const ms = performance.now() - t0;
    check('a canvas just under its cap, one long run of text, is read in under a second', faults.length === 0 && ms < 1000, `${Math.round(ms)} ms ${JSON.stringify(faults)}`);
  }
  green('a fragment fill="url(#g)" passes', art('<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/>'));
  green('a fragment <use href="#p"/> passes', art('<path id="p" d="M0 0"/><use href="#p"/><use xlink:href="#p"/>'));
  green('attributes that merely contain "on" later (e.g. d, stroke-linecap) pass', art('<path d="M0 0" stroke-linecap="round" font-size="3"/>'));

  /* ---- the hostile cases beyond the plan's list ---- */
  red('an entity-encoded href (&#x6a;avascript:)', art('<a href="&#x6a;avascript:alert(1)"/>'), /art\.svg.*(character reference|href)/);
  red('a decimal-encoded href (&#106;avascript:)', art('<a href="&#106;avascript:alert(1)"/>'), /art\.svg.*(character reference|href)/);
  red('an encoded fragment-looking href (&#35; is #, but rejected)', art('<use href="&#35;p"/>'), /art\.svg.*character reference/);
  red('a <set> writing an href', art('<a><set attributeName="href" to="https://x/"/></a>'), /art\.svg.*(<set|<animate)/i);
  red('an <animate> writing xlink:href', art('<a><animate attributeName="xlink:href" values="https://x/"/></a>'), /art\.svg.*(<set|<animate)/i);
  red('an <animate> with attributeName spelled in upper case', art('<a><ANIMATE ATTRIBUTENAME="HREF" values="https://x/"/></a>'), /art\.svg.*(<set|<animate)/i);
  red('an <animate> writing xml:base', art('<a><animate attributeName="xml:base" values="https://x/"/></a>'), /art\.svg.*(<set|<animate)/i);
  red('a decoy <svg viewBox> inside a comment before the real root', (f) => { f['art.svg'] = `<!-- <svg viewBox="0 0 540 840"> --><svg ${NS} viewBox="0 0 1 1"/>`; }, /art\.svg.*viewBox/);
  red('a DOCTYPE fault says to delete the line', (f) => { f['art.svg'] = `<!DOCTYPE svg>${ART()}`; }, /art\.svg.*delete the DOCTYPE line/);
  green('an <animate> of an ordinary attribute passes', art('<rect><animate attributeName="opacity" values="0;1" dur="1s"/></rect>'));
  red('an xml:base', art('', ' xml:base="https://example.com/"'), /art\.svg.*xml:base/i);
  red('a <!DOCTYPE with an entity', (f) => { f['art.svg'] = `<!DOCTYPE svg [<!ENTITY u "https://x/">]>${ART('<use href="&u;"/>')}`; }, /art\.svg.*(<!DOCTYPE|<!ENTITY)/i);
  red('an <!ENTITY alone', art('<!ENTITY u "https://x/">'), /art\.svg.*<!ENTITY/i);
  red('an href with a leading space before #', art('<use href=" https://x/"/>'), /art\.svg.*href/);
  red('an unquoted href to a URL', art('<use href=https://x/a.svg />'), /art\.svg.*href/);

  /* ---- a raster canvas (specs/card-art.md, docs/plans/2026-11-11-rendered-card-art-design.md section 3) ---- */
  const webp = (buf) => (f) => { f['art.svg'] = null; f['art.webp'] = buf; };
  green('a canvas of art.webp, lossy (VP8 ), with no art.svg', webp(WEBP_LOSSY));
  green('a canvas of art.webp, lossless (VP8L), with no art.svg', webp(WEBP_LOSSLESS));
  green('a canvas of art.webp, extended (VP8X), with no art.svg', webp(WEBP_EXT));
  green('an art.webp with a file the guard does not read beside it', (f) => { webp(WEBP_LOSSY)(f); f['scene.py'] = 'print(1)'; });
  red('both art.svg and art.webp', (f) => { f['art.webp'] = WEBP_LOSSY; }, /holds art\.svg and art\.webp; a card has one canvas/);
  red('a PNG named art.webp', webp(PNG), /art\.webp.*is not a WebP image$/m);
  red('a WebP of 540 by 840', webp(WEBP_SMALL), /art\.webp.*is 540 by 840; a raster canvas is exactly 1080 by 1680/);
  red('a lossy WebP whose width bytes say 1081', webp(altered(WEBP_LOSSY, (c) => { c.writeUInt16LE(1081, 26); })), /art\.webp.*is 1081 by 1680/);
  red('an extended WebP with its animation flag set', webp(altered(WEBP_EXT, (c) => { c[20] |= 2; })), /art\.webp.*is animated; a card's art is a still image/);
  red('a valid WebP padded past 400 KB', webp(Buffer.concat([WEBP_LOSSY, Buffer.alloc(401 * 1024)])), /art\.webp.*400 KB/);
  red('a WebP cut to 20 bytes', webp(WEBP_LOSSY.subarray(0, 20)), /art\.webp.*is not a WebP image$/m);
  red('an art.webp whose first chunk is ALPH', webp(altered(WEBP_LOSSY, (c) => { c.write('ALPH', 12, 'latin1'); })), /art\.webp.*is not a WebP image this guard can read/);
  // Each header check on its own: a file wrong in one place only, so no other check can catch it instead.
  red('a WebP whose first four bytes are not RIFF', webp(altered(WEBP_LOSSY, (c) => { c.write('RIFX', 0, 'latin1'); })), /art\.webp.*is not a WebP image$/m);
  red('a RIFF file that is not a WebP (WAVE)', webp(altered(WEBP_LOSSY, (c) => { c.write('WAVE', 8, 'latin1'); })), /art\.webp.*is not a WebP image$/m);
  red('a lossy WebP with no start code', webp(altered(WEBP_LOSSY, (c) => { c[23] = 0; })), /art\.webp.*is not a WebP image this guard can read/);
  red('a lossless WebP with no signature byte', webp(altered(WEBP_LOSSLESS, (c) => { c[20] = 0; })), /art\.webp.*is not a WebP image this guard can read/);
  red('a lossy WebP cut to 27 bytes, inside its size', webp(WEBP_LOSSY.subarray(0, 27)), /art\.webp.*is not a WebP image$/m);
  // A lossy frame's width and height are 14 bits each; the two bits above them are a scale, which is not the size.
  green('a lossy WebP with scale bits set above its width and height', webp(altered(WEBP_LOSSY, (c) => { c.writeUInt16LE(1080 | 0x4000, 26); c.writeUInt16LE(1680 | 0x8000, 28); })));

  // A folder beside the card folders whose name could not be a card's key is not a card: a tool's leavings, such as
  // Python's __pycache__ when a scene is run, or a dot-folder. A folder named as a key could be is still read.
  const beside = (name, file) => { const dir = repo(); const d = path.join(dir, 'instances/demo/ui/cards', name); fs.mkdirSync(d, { recursive: true }); if (file) fs.writeFileSync(path.join(d, file), 'x'); return dir; };
  for (const name of ['__pycache__', '.cache', 'Notes', 'old_art']) {
    const dir = beside(name, 'rig.cpython-313.pyc');
    check(`a folder named ${name} beside the card folders is not read as a card`, cardArtFaults(dir).length === 0, JSON.stringify(cardArtFaults(dir)));
    const c = run(dir);
    check('  and the command exits 0', c.status === 0, `${c.status} ${c.stderr}`);
  }
  {
    const dir = beside('second-card', null);
    const faults = cardArtFaults(dir);
    check('an empty folder named as a card key could be is still read, and fails', faults.some((f) => /second-card.*missing a canvas/.test(f)), JSON.stringify(faults));
    const c = run(dir);
    check('  and the command exits 1 naming it', c.status === 1 && /second-card.*missing a canvas/.test(c.stderr), `${c.status} ${c.stderr}`);
  }

  /* ---- a back folder (docs/plans/2026-11-11-rendered-card-back-design.md section 3) ---- */
  // A repository with the clean card folder and, beside the cards, `instances/demo/ui/card-back/` holding `files`
  // (the same shape as repo()'s: a name to its content, or null for no file) after `poison(files)` is applied.
  /** @param {(files: Record<string, string | Buffer | null>) => void} [poison] */
  const backRepo = (poison = () => {}) => {
    /** @type {Record<string, string | Buffer | null>} */
    const files = { 'art.webp': WEBP_LOSSY, 'art.json': JSON_OK };
    poison(files);
    const dir = repo();
    const back = path.join(dir, 'instances/demo/ui/card-back');
    fs.mkdirSync(back, { recursive: true });
    for (const [f, body] of Object.entries(files)) if (body !== null) fs.writeFileSync(path.join(back, f), body);
    return dir;
  };
  const backGreen = (name, poison) => {
    const dir = backRepo(poison);
    const faults = cardArtFaults(dir);
    check(name, faults.length === 0, JSON.stringify(faults));
    const c = run(dir);
    check('  and the command exits 0', c.status === 0, `${c.status} ${c.stderr}`);
  };
  const backRed = (name, poison, want) => {
    const dir = backRepo(poison);
    const faults = cardArtFaults(dir);
    check(name, faults.some((f) => want.test(f)), JSON.stringify(faults));
    const c = run(dir);
    check('  and the command exits 1 naming it', c.status === 1 && want.test(c.stderr), `${c.status} ${c.stderr}`);
  };

  backGreen('a back with art.webp and art.json', () => {});
  backGreen('a back with art.webp, hit.webp and art.json', (f) => { f['hit.webp'] = WEBP_LOSSLESS; });
  backGreen('a back with art.svg and hit.svg (no mark.svg asked for)', (f) => { f['art.webp'] = null; f['art.svg'] = ART(); f['hit.svg'] = ART(); });
  backGreen('a back with a scene.py beside its pictures', (f) => { f['scene.py'] = 'print(1)'; });
  {
    const dir = backRepo();
    const c = run(dir);
    check('the passing line counts the card folder and the back folder', c.status === 0 && /1 card folder\(s\).*1 card back folder\(s\)/.test(c.stdout), c.stdout);
  }

  backRed('a back folder with no art.*', (f) => { f['art.webp'] = null; }, /card-back.*missing a canvas; a card back's folder holds art\.svg or art\.webp, optionally hit\.svg or hit\.webp, and art\.json/);
  backRed('a back with art.svg and art.webp', (f) => { f['art.svg'] = ART(); }, /card-back.*holds art\.svg and art\.webp/);
  backRed('a back with hit.svg and hit.webp', (f) => { f['hit.svg'] = ART(); f['hit.webp'] = WEBP_LOSSY; }, /card-back.*holds hit\.svg and hit\.webp/);
  backRed('a hit.webp of 540 by 840', (f) => { f['hit.webp'] = WEBP_SMALL; }, /hit\.webp.*is 540 by 840; a raster canvas is exactly 1080 by 1680/);
  backRed('a hit.webp that is a PNG', (f) => { f['hit.webp'] = PNG; }, /hit\.webp.*is not a WebP image$/m);
  backRed('an art.svg in a back holding <script', (f) => { f['art.webp'] = null; f['art.svg'] = ART('<script/>'); }, /card-back.*art\.svg.*<script/i);
  backRed('a back with no art.json', (f) => { f['art.json'] = null; }, /card-back.*art\.json.*missing/);
  backRed('a back with an art.json with an empty credit', (f) => { f['art.json'] = JSON.stringify({ credit: '', license: 'x' }); }, /card-back.*art\.json.*credit/);
  backRed('a hit.webp padded past 400 KB', (f) => { f['hit.webp'] = Buffer.concat([WEBP_LOSSY, Buffer.alloc(401 * 1024)]); }, /hit\.webp.*400 KB/);
  backRed('a hit.svg over 200 KB', (f) => { f['art.webp'] = null; f['art.svg'] = ART(); f['hit.svg'] = ART(`<!--${'a'.repeat(201 * 1024)}-->`); }, /hit\.svg.*200 KB/);
  backRed('a hit.svg off the canvas', (f) => { f['hit.svg'] = `<svg ${NS} viewBox="0 0 120 110"/>`; }, /hit\.svg.*viewBox/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n  card art: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('  test-card-art: FAILED\n    ' + failures.join('\n    '));
  process.exit(1);
}
