/**
 * Every theme an instance offers holds the contrast floor, laid over the engine's defaults as the page loads them.
 * It lives in web/ (the composition root) because the engine never reads an instance, by import or by the
 * filesystem (tools/check-engine-boundary.mjs); the pure check it calls, engine/ui/contrast.ts, stays in the engine.
 *
 * The themes checked are the ones each instance's `InstanceUi.themes` list names, since that list is what a player
 * can pick (engine/ui/appearance.ts). tools/check-theme.mjs holds every href in that list to a `*.css?url` import
 * of a file in the instance's own ui/ folder, so each href is matched here to that file's text through the same
 * `?url` transform; a theme whose text cannot be found fails rather than going unchecked.
 */
import { describe, expect, test } from 'vitest';
import { contrastFailures, darkBlocksDisagree, tokensOf, type Mode } from '../engine/ui/contrast.ts';
import type { InstanceUi, ThemeOption } from '../engine/ui/types.ts';
import engine from '../engine/ui/tokens.css?raw';

const uis = import.meta.glob<InstanceUi>('../instances/*/ui/index.ts', { eager: true, import: 'instanceUi' });
const raws = import.meta.glob<string>('../instances/*/ui/*.css', { eager: true, query: '?raw', import: 'default' });
const urls = import.meta.glob<string>('../instances/*/ui/*.css', { eager: true, query: '?url', import: 'default' });

/** The modes a page can show a theme in: a theme fixed to one mode is shown only in it (appearance.ts). */
const MODES: Record<ThemeOption['modes'], readonly Mode[]> = {
  both: ['light', 'light (chosen)', 'dark', 'dark (device)'],
  light: ['light (chosen)'],
  dark: ['dark'],
};

/** Each theme an instance's list names, with the text of the stylesheet its href loads, or null when none is found. */
function themesOf(instances: Record<string, InstanceUi>, text: Record<string, string>, url: Record<string, string>) {
  const byUrl = new Map(Object.entries(url).map(([file, href]) => [href, text[file] ?? null]));
  return Object.entries(instances).flatMap(([file, ui]) => ui.themes.map((t) => ({
    label: `${file.split('/')[2]}: ${t.key}`, theme: t, css: byUrl.get(t.href) ?? null,
  })));
}

/** The contrast failures of one theme over the engine's defaults, in the modes it can be shown in. */
function themeFailures(theme: ThemeOption, css: string): string[] {
  return contrastFailures(engine, css).filter((f) => MODES[theme.modes].some((m) => f.startsWith(`${m}: `)));
}

const themes = themesOf(uis, raws, urls);

describe('color contrast of each theme an instance offers, light and dark', () => {
  test('there is an instance with a theme to check', () => {
    expect(Object.keys(uis).length).toBeGreaterThan(0);
    expect(themes.length).toBeGreaterThan(0);
  });

  test.each(themes)('$label, laid over the engine defaults as the page loads it, holds in every mode it is shown in', ({ theme, css }) => {
    expect(css, `no stylesheet in an instance's ui/ folder is loaded by href ${theme.href}`).not.toBeNull();
    const seen = tokensOf(engine, css!);
    expect(Object.keys(seen.dark).length).toBeGreaterThan(10);
    if (theme.modes === 'both') {
      expect(seen['dark (device)']).toEqual(seen.dark);
      expect(darkBlocksDisagree(css!)).toEqual([]);
    }
    expect(themeFailures(theme, css!)).toEqual([]);
  });

  test.each(themes.filter((t) => t.theme.modes === 'both'))('$label, with a later block over its real ones in each selector form, is read as the browser reads it and fails', ({ css }) => {
    const poisoned = `${css!}
:root { --kb-fg: #fefefe; }
@media (prefers-color-scheme: dark) {
  :root:not([data-kb-mode="light"]) { --kb-fg: #000001; }
}
:root[data-kb-mode="dark"] { --kb-fg: #000001; }
`;
    const failures = contrastFailures(engine, poisoned);
    for (const mode of ['light', 'dark', 'dark (device)']) {
      expect(failures.some((f) => f.startsWith(`${mode}: body text`)), `${mode} reads the later --kb-fg`).toBe(true);
    }
  });
});

describe('the sweep reads every theme in the list, not only the first', () => {
  const HOUSE = `:root { --kb-fg: #000; --kb-bg: #fff; }
@media (prefers-color-scheme: dark) { :root:not([data-kb-mode="light"]) { --kb-fg: #fff; --kb-bg: #000; } }
:root[data-kb-mode="dark"] { --kb-fg: #fff; --kb-bg: #000; }`;
  const ui = (list: ThemeOption[]) => ({ '../instances/x/ui/index.ts': { themes: list } as unknown as InstanceUi });
  const text = { '../instances/x/ui/theme.css': HOUSE, '../instances/x/ui/sepia.css': ':root { --kb-fg: #c8c8c8; }' };
  const url = { '../instances/x/ui/theme.css': '/x/theme.css', '../instances/x/ui/sepia.css': '/x/sepia.css' };
  const list: ThemeOption[] = [
    { key: 'house', name: 'House', href: '/x/theme.css', modes: 'both' },
    { key: 'sepia', name: 'Sepia', href: '/x/sepia.css', modes: 'light' },
  ];

  test('a second theme file is found by its href and checked, and its poor contrast fails', () => {
    const found = themesOf(ui(list), text, url);
    expect(found.map((t) => t.label)).toEqual(['x: house', 'x: sepia']);
    const sepia = found[1]!;
    expect(sepia.css).toBe(text['../instances/x/ui/sepia.css']);
    expect(themeFailures(sepia.theme, sepia.css!).some((f) => f.startsWith('light (chosen): body text'))).toBe(true);
  });

  test('a theme whose href loads no stylesheet in an instance\'s ui/ folder is reported, not skipped', () => {
    const found = themesOf(ui([...list, { key: 'gone', name: 'Gone', href: '/x/gone.css', modes: 'both' }]), text, url);
    expect(found[2]!.css).toBeNull();
  });
});
