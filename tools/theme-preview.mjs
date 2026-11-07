/**
 * A theme's preview, read from its file: the tokens the theme picker's miniature draws, per mode.
 *
 * A theme file imported as `theme.css?preview` becomes, at build time, a module whose default export is
 * `{ light?, dark? }`, each a record of the PREVIEW_TOKENS' values. It is read by `themeBlocks`, the same parse
 * tools/check-theme.mjs holds the theme to, so the miniature and the theme are one list and a preview cannot drift
 * from the stylesheet it shows (CLAUDE.md, "Two lists that must agree are one list").
 *
 * Values are RESOLVED here, not carried as `var()`: a theme's `--kb-head-bg` may point at another token, and the
 * engine's tokens.css points many defaults at `--kb-bg` and `--kb-fg`; a miniature drawn on the Settings page, under the
 * player's current theme, would resolve each against the wrong theme. So a `var(--x)` is followed through the theme's
 * blocks for the mode and then engine/ui/tokens.css, as the browser would on a page wearing that theme, and the preview
 * holds literals. A reference that resolves to nothing, or loops, is a fault.
 *
 * The preview's keys ARE the modes the theme holds. `light` is the `:root` block (with `[data-kb-mode="light"]` laid over
 * it); `dark` is that with the dark blocks laid over it. A theme with no dark blocks holds light only, so the preview has
 * `light` alone. A theme whose resolved light tokens equal its resolved dark tokens (a dark-only theme sets its tokens on
 * `:root` and in both dark blocks alike) holds dark only, so the preview has `dark` alone. The instance's `modes` must agree
 * with these keys: `instanceUiProblems` (engine/ui/tips/problems.ts) holds it to that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeBlocks, THEME_FILE } from './check-theme.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Tokens a theme must set itself in the mode it holds: the miniature's whole look. Without one it would show the engine's default. */
export const REQUIRED_TOKENS = [
  '--kb-bg', '--kb-fg', '--kb-link', '--kb-grid', '--kb-frame',
  '--kb-banner-bg', '--kb-logo-fg', '--kb-nav-bg', '--kb-nav-fg',
  '--kb-head-bg', '--kb-head-fg', '--kb-row-1', '--kb-row-2', '--kb-row-3',
];
/** Tokens the miniature also draws, which a theme may leave to the engine's default. */
export const OPTIONAL_TOKENS = ['--kb-button-bg', '--kb-button-edge', '--kb-button-fg'];
export const PREVIEW_TOKENS = [...REQUIRED_TOKENS, ...OPTIONAL_TOKENS];

/* A fallback may itself hold a var() (`var(--a, var(--b))`): one nesting level is read, and resolve() follows it. */
const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/;

/** `value` with every var() followed through `scope` (name to value), or null if one resolves to nothing or loops. */
function resolve(value, scope, seen = []) {
  let out = value;
  for (let guard = 0; guard < 50; guard++) {
    const m = out.match(VAR);
    if (!m) return out;
    const [whole, name, fallback] = m;
    let replacement;
    if (scope.has(name) && !seen.includes(name)) {
      replacement = resolve(scope.get(name), scope, [...seen, name]);
    } else if (fallback !== undefined) replacement = resolve(fallback.trim(), scope, seen);
    else return null;
    if (replacement === null) return null;
    out = out.replace(whole, () => replacement);
  }
  return null;
}

/** The engine's defaults: tokens.css's `:root`, read each time (a cache would go stale in a watch rebuild). */
function engineTokens() {
  return themeBlocks(fs.readFileSync(path.join(repoRoot, 'engine/ui/tokens.css'), 'utf8')).root;
}

/**
 * A theme's preview and its faults.
 * @param {string} text the theme stylesheet
 * @param {Map<string,string>} [defaults] the engine's tokens (default: engine/ui/tokens.css)
 * @returns {{ light?: Record<string,string>, dark?: Record<string,string>, faults: string[] }}
 */
export function previewOf(text, defaults = engineTokens()) {
  const b = themeBlocks(text);
  const faults = [];
  const mode = (name, own, faults) => {
    const scope = new Map([...defaults, ...own]);
    const tokens = {};
    for (const t of PREVIEW_TOKENS) {
      if (REQUIRED_TOKENS.includes(t) && !own.has(t)) faults.push(`${name}: the theme sets no ${t}, so its preview would show the engine's default`);
      const v = scope.has(t) ? resolve(scope.get(t), scope, [t]) : null;
      if (v === null) faults.push(`${name}: ${t} resolves to nothing (a var() with no value, or a loop)`);
      else tokens[t] = v;
    }
    return tokens;
  };
  const light = new Map([...b.root, ...b.light]);
  const dark = new Map([...b.root, ...b.dark]);
  const lightFaults = [];
  const hasLight = b.root.size > 0 || b.light.size > 0;
  const lightTokens = hasLight ? mode('light', light, lightFaults) : undefined;
  const darkTokens = b.dark.size > 0 ? mode('dark', dark, faults) : undefined;
  const out = { faults };
  /* A dark-only theme writes the same tokens in :root and in the dark blocks, so its light is not a mode it holds. */
  const sameAsDark = lightTokens !== undefined && darkTokens !== undefined && JSON.stringify(lightTokens) === JSON.stringify(darkTokens);
  if (lightTokens !== undefined && !sameAsDark) { out.light = lightTokens; faults.unshift(...lightFaults); }
  if (darkTokens !== undefined) out.dark = darkTokens;
  return out;
}

/** Faults of every preview in `files` (repository path to text) that is a theme stylesheet; [] is clean. */
export function previewFaults(files, defaults) {
  const out = [];
  for (const [file, text] of Object.entries(files)) {
    if (!THEME_FILE.test(file)) continue;
    for (const why of previewOf(text, defaults).faults) out.push({ file, why });
  }
  return out;
}

/** The module's source for a theme file: its preview as JSON; a fault throws, so a bad preview fails the build. */
export function previewModule(file, text) {
  const { faults, ...preview } = previewOf(text);
  if (faults.length) throw new Error(`${file}: ${faults.join('; ')}`);
  return `export default ${JSON.stringify(preview)};\n`;
}

/** A Vite plugin: `x.css?preview` is the preview module of `x.css`. Rebuilt when the theme or tokens.css changes. */
export function themePreviewPlugin() {
  const PREFIX = '\0theme-preview:';
  return {
    name: 'kayfabb-theme-preview',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('.css?preview')) return null;
      const r = await this.resolve(source.slice(0, -'?preview'.length), importer, { skipSelf: true });
      /* The id must not read as a stylesheet (Vite treats `.css` followed by `?` or the end as CSS), so the path is encoded. */
      return r ? PREFIX + encodeURIComponent(r.id) + '.js' : null;
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const file = decodeURIComponent(id.slice(PREFIX.length, -'.js'.length));
      this.addWatchFile(file);
      this.addWatchFile(path.join(repoRoot, 'engine/ui/tokens.css'));
      return previewModule(path.relative(repoRoot, file), fs.readFileSync(file, 'utf8'));
    },
  };
}
