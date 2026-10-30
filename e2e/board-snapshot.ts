/**
 * The Playwright side of the board match: reads a manifest's landmarks out of a page as a
 * snapshot (e2e/board-match.ts compares two of them), and gives the board's page the faces the
 * build uses. Nothing here decides a match; it only reads.
 *
 * A landmark is found by role and accessible name (`getByRole`), the name matched whole and
 * without case; the build's side searches for `buildName ?? name`, and picks `buildNth ?? nth`. The role `text` is the one
 * that is not ARIA's: a part a board drew with no role at all (the HUD's clock label, a legend, a
 * class tag) is found by its own words (`getByText`), matched the same way. What a landmark's type is
 * is read from its first text-bearing element: the element itself, or its first descendant that
 * holds a non-blank text node, skipping any `aria-hidden` (below the landmark), `display:none` or
 * visually hidden (a clipped 1px box) subtree and any `visibility:hidden` text, so a decorative
 * glyph, a hidden span or a heading only a screen reader hears is not the text. The boards
 * load Anton and Barlow Condensed from Google Fonts, which an offline run cannot reach and a
 * fallback face could pass or fail by luck, so `routeBoardFonts` answers those requests from the
 * instance's own files, described in instances/divided-world/ui/glass.json. The system faces both
 * sides name first are set in one stand-in where the machine lacks them (`standInFaces`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { BoardManifest, Box, Landmark, Shot, Snapshot, TypeRead } from './board-match.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_DIR = path.join(repoRoot, 'instances', 'divided-world', 'ui');

/** One face `glass.json` names: the file is relative to `instances/divided-world/ui/`. */
export interface GlassFont { readonly family: string; readonly file: string; readonly weight: number; readonly style: string; readonly ink?: unknown }

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The faces `glass.json` names (in `root`, the instance's `ui/` folder by default); throws a plain error when the file or its `fonts` list is not there. */
export function glassFonts(root: string = UI_DIR): GlassFont[] {
  const glassJson = path.join(root, 'glass.json');
  if (!fs.existsSync(glassJson)) {
    throw new Error(`instances/divided-world/ui/glass.json does not exist yet, so the board's fonts cannot be served from the instance's own files (the glass's tokens, shapes and fonts task writes it)`);
  }
  const parsed = JSON.parse(fs.readFileSync(glassJson, 'utf8')) as { fonts?: GlassFont[] };
  if (!Array.isArray(parsed.fonts) || parsed.fonts.length === 0) throw new Error('instances/divided-world/ui/glass.json has no `fonts` list');
  return parsed.fonts;
}

/** A font file's media type and its `format()` hint, by extension; anything else is read as TrueType. */
const FORMATS: Readonly<Record<string, { type: string; format: string }>> = {
  '.woff2': { type: 'font/woff2', format: 'woff2' },
  '.otf': { type: 'font/otf', format: 'opentype' },
  '.ttf': { type: 'font/ttf', format: 'truetype' },
};

/** The host the stylesheet below points its faces at; the route answers it from disk, so it is never resolved. */
const FONT_HOST = 'http://glass-fonts.test';

/**
 * Answer the board's Google Fonts requests offline: the stylesheet is `@font-face` rules for the
 * faces `glass.json` names, each pointing at a route that serves the file from disk; the font
 * files' own host is refused. `root` is the folder `glass.json` and the files are read from; the
 * instance's `ui/` folder unless a self-test gives it a scratch one.
 */
export async function routeBoardFonts(page: Page, root: string = UI_DIR): Promise<void> {
  const fonts = glassFonts(root);
  const css = fonts.map((f) => `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(${FONT_HOST}/${encodeURI(f.file)}) format('${FORMATS[path.extname(f.file)]?.format ?? 'truetype'}');}`).join('\n');
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', headers: { 'access-control-allow-origin': '*' }, body: css }));
  await page.route(`${FONT_HOST}/**`, async (route) => {
    const file = path.join(root, decodeURIComponent(new URL(route.request().url()).pathname.slice(1)));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: FORMATS[path.extname(file)]?.type ?? 'font/ttf', body: fs.readFileSync(file) });
  });
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
}

/**
 * The system faces the boards and the theme both name first (Verdana, Courier New), each with the
 * free face of its metrics after it: the machine's own where it has one, the stand-in where it has
 * not. Both sides then set the same words in the same face. Without it, a machine with neither (CI's
 * Linux) sets each side by the rest of its own list, the board's falling to `sans-serif` and the
 * theme's to DejaVu Sans, and a row of links lands a dozen pixels apart for no fault of the build's.
 */
const STAND_INS: readonly { family: string; weight: number; local: readonly string[] }[] = [
  { family: 'Verdana', weight: 400, local: ['Verdana', 'DejaVu Sans'] },
  { family: 'Verdana', weight: 700, local: ['Verdana Bold', 'DejaVu Sans Bold'] },
  { family: 'Courier New', weight: 400, local: ['Courier New', 'Liberation Mono'] },
  { family: 'Courier New', weight: 700, local: ['Courier New Bold', 'Liberation Mono Bold'] },
];

/** Gives every page the context opens the stand-ins above, before its own styles load. */
export async function standInFaces(context: BrowserContext): Promise<void> {
  const css = STAND_INS.map((f) => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};src:${f.local.map((n) => `local('${n}')`).join(',')};}`).join('\n');
  await context.addInitScript((text) => {
    const add = () => {
      const style = document.createElement('style');
      style.dataset.kbStandIn = '';
      style.textContent = text;
      document.documentElement.prepend(style);
    };
    if (document.documentElement) add();
    else document.addEventListener('readystatechange', add, { once: true });
  }, css);
}

/** The locator for a landmark, inside its `within` landmark's locator when it names one. */
function locate(page: Page, landmark: Landmark, side: 'board' | 'build', found: ReadonlyMap<string, Locator>): Locator {
  const name = side === 'build' ? landmark.buildName ?? landmark.name : landmark.name;
  const root: Page | Locator = landmark.within ? found.get(landmark.within) ?? page.locator(':not(*)') : page;
  const whole = new RegExp(`^${escapeRegExp(name)}$`, 'i');
  const nth = side === 'build' ? landmark.buildNth ?? landmark.nth ?? 0 : landmark.nth ?? 0;
  /* A text's own words are read raw, so the markup's line breaks and indents around and between them are spaces. */
  if (landmark.role === 'text') return root.getByText(new RegExp(`^\\s*${name.trim().split(/\s+/).map(escapeRegExp).join('\\s+')}\\s*$`, 'i')).nth(nth);
  return root.getByRole(landmark.role as Parameters<Page['getByRole']>[0], { name: whole }).nth(nth);
}

/** The computed type of an element's first text-bearing element, in the page; null when it holds no text. */
async function readType(locator: Locator): Promise<TypeRead | null> {
  return locator.evaluate((el): TypeRead | null => {
    const hasText = (e: Element) => [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && /\S/.test(n.textContent ?? ''));
    /* The landmark itself is read whatever its aria-hidden: a text found by its own words is on screen. */
    const first = (e: Element, root = false): Element | null => {
      if ((!root && e.getAttribute('aria-hidden') === 'true') || getComputedStyle(e).display === 'none') return null;
      /* Visually hidden (a 1px box that clips what it holds): read by a screen reader, seen by no eye. */
      const box = e.getBoundingClientRect();
      if (!root && box.width <= 1 && box.height <= 1 && getComputedStyle(e).overflow === 'hidden') return null;
      /* A hidden element's own text is not seen, but a child may show itself again. */
      if (hasText(e) && getComputedStyle(e).visibility === 'visible') return e;
      for (const child of e.children) {
        const found = first(child);
        if (found) return found;
      }
      return null;
    };
    const text = first(el, true);
    if (!text) return null;
    const s = getComputedStyle(text);
    return {
      family: (s.fontFamily.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, ''),
      size: parseFloat(s.fontSize),
      weight: Number(s.fontWeight),
      color: s.color,
      letterSpacing: s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing),
    };
  });
}

/** Every landmark of the manifest as this page shows it. A landmark with no visible match is `found: false`. */
export async function snapshotPage(page: Page, manifest: BoardManifest, side: 'board' | 'build'): Promise<Snapshot> {
  const shots: Shot[] = [];
  const found = new Map<string, Locator>();
  for (const landmark of manifest.landmarks) {
    const locator = locate(page, landmark, side, found);
    const box = (await locator.count()) > 0 ? await locator.boundingBox() : null;
    if (!box) {
      shots.push({ id: landmark.id, found: false });
      continue;
    }
    found.set(landmark.id, locator);
    const type = landmark.type === false ? null : await readType(locator);
    const rect: Box = { x: box.x, y: box.y, width: box.width, height: box.height };
    shots.push(type ? { id: landmark.id, found: true, box: rect, type } : { id: landmark.id, found: true, box: rect });
  }
  return { shots };
}

/**
 * Press the manifest's controls on the build's page, in order, each found by role and whole name
 * as a landmark is. A control that does not come within `timeout` fails by name, since a state the
 * board draws that the build cannot reach is the finding.
 */
export async function pressControls(page: Page, controls: BoardManifest['press'] = [], timeout = 5000): Promise<void> {
  for (const control of controls) {
    const target = page.getByRole(control.role as Parameters<Page['getByRole']>[0], { name: new RegExp(`^${escapeRegExp(control.name)}$`, 'i') }).first();
    try {
      await target.click({ timeout });
    } catch {
      throw new Error(`the build has no ${control.role} named "${control.name}" to press`);
    }
  }
}

const sameSnapshot = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The app renders after its page loads (the fixture answers, then the thread lands), so the build
 * is read once every landmark is found and two reads a frame's breath apart agree; when `timeout`
 * runs out first it is read as it stands, and what is missing is reported as missing.
 */
export async function settledSnapshot(page: Page, manifest: BoardManifest, side: 'board' | 'build', timeout = 5000): Promise<Snapshot> {
  const until = Date.now() + timeout;
  let last = await snapshotPage(page, manifest, side);
  for (;;) {
    await page.waitForTimeout(100);
    const next = await snapshotPage(page, manifest, side);
    if ((next.shots.every((s) => s.found) && sameSnapshot(last, next)) || Date.now() > until) return next;
    last = next;
  }
}
