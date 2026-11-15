/**
 * THIS's ink (docs/plans/2026-11-13-this-plan.md, Task 7; the pattern is cards/autocorrect/paper.test.ts). The note's two inks and the highlighter's two swipes
 * are constants, `this.css` holds exactly those values in the places the theme contract allows (`:root`, the device's dark, a chosen dark), and each ink
 * holds 4.5:1 against both post rows (`--kb-row-1`, `--kb-row-2`) of every theme the instance lists, in the mode the theme is shown in; the post's own words
 * hold 4.5:1 over the swipe. `failures` is the check and the last test drives it red on a poisoned stylesheet.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ratio, resolveToken, tokensOf, worstRatio, parseColor, type Mode, type Tokens } from '../../../../engine/ui/contrast.ts';
import { INK, SWIPE } from './ink.ts';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const engine = read('engine/ui/tokens.css');
const ui = 'instances/divided-world/ui';
const css = read(`${ui}/this/this.css`);

/** The instance's themes as `InstanceUi.themes` lists them, read from its source (a node test cannot import a stylesheet's `?url`): the theme's stylesheet and its modes. */
function themes(): { key: string; sheet: string; modes: 'both' | 'light' | 'dark' }[] {
  const source = read(`${ui}/index.ts`);
  const files = new Map([...source.matchAll(/import (\w+) from '\.\/((?:themes\/)?[\w-]+\.css)\?url';/gu)].map((m) => [m[1]!, m[2]!]));
  return [...source.matchAll(/\{ key: '([\w-]+)', name: '[^']*', href: (\w+), modes: '(both|light|dark)'/gu)].map((m) => ({ key: m[1]!, sheet: read(`${ui}/${files.get(m[2]!)!}`), modes: m[3] as 'both' | 'light' | 'dark' }));
}
/** The modes a theme is shown in: both of a theme with both, the chosen light of a light one, the chosen dark of a dark one (the board sets `data-kb-mode` to it). */
const shown = (modes: 'both' | 'light' | 'dark'): readonly Mode[] => (modes === 'both' ? ['light', 'light (chosen)', 'dark', 'dark (device)'] : modes === 'light' ? ['light (chosen)'] : ['dark']);

/** `this.css`'s own tokens by mode, read the way the browser reads them: its `--dw-this-*` as `--kb-this-*`, which `tokensOf` knows how to place. */
const own = (sheet: string) => tokensOf(sheet.replaceAll('--dw-this-', '--kb-this-'));

/** Composite `swipe` (rgb with an alpha) over an opaque color, as an opaque rgb(). */
function over(swipe: string, ground: string): string {
  const m = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/u.exec(swipe);
  if (!m) throw new Error(`not a swipe this check can read: ${swipe}`);
  const [a, g] = [Number(m[4]), parseColor(ground)];
  return `rgb(${[1, 2, 3].map((i, c) => Math.round(a * Number(m[i]) + (1 - a) * g[c]!)).join(', ')})`;
}

/** What is wrong with a `this.css` (or a stand-in) against the constants and every theme; empty when it is sound. */
function failures(sheet: string, listed = themes()): string[] {
  const out: string[] = [];
  const mine = own(sheet);
  for (const mode of ['light', 'light (chosen)', 'dark', 'dark (device)'] as const) {
    const dark = mode.startsWith('dark');
    for (const [name, want] of [['ink', INK], ['swipe', SWIPE]] as const) {
      const got = mine[mode][`--kb-this-${name}`];
      if (got !== want[dark ? 'dark' : 'light']) out.push(`${mode}: --dw-this-${name} is ${got ?? 'unset'}, the constant is ${want[dark ? 'dark' : 'light']}`);
    }
  }
  for (const theme of listed) {
    const base = tokensOf(engine, theme.sheet);
    for (const mode of shown(theme.modes)) {
      const tokens: Tokens = { ...base[mode], ...mine[mode] };
      for (const row of ['--kb-row-1', '--kb-row-2']) {
        let got: number;
        try { got = worstRatio(tokens, '--kb-this-ink', row); } catch (e) { out.push(`${theme.key} ${mode}: ${(e as Error).message}`); continue; }
        if (got < 4.5) out.push(`${theme.key} ${mode}: the note's ink on ${row} is ${got.toFixed(2)}:1, needs 4.5:1`);
        try {
          const words = ratio(resolveToken(tokens, '--kb-fg'), over(resolveToken(tokens, '--kb-this-swipe'), resolveToken(tokens, row)));
          if (words < 4.5) out.push(`${theme.key} ${mode}: the post's words over the swipe on ${row} are ${words.toFixed(2)}:1, needs 4.5:1`);
        } catch (e) { out.push(`${theme.key} ${mode}: ${(e as Error).message}`); }
      }
    }
  }
  return out;
}

describe('THIS\'s ink', () => {
  test('the instance lists its themes and the check read all of them', () => {
    assert.deepEqual(themes().map((t) => t.key), ['house', 'blue-steel', 'midnight', 'hot-rod', 'fan-site']);
  });
  test('this.css holds the constants, and every theme holds the ink and the words at 4.5:1 in the mode it is shown in', () => {
    assert.deepEqual(failures(css), []);
  });
  test('the check goes red on a stylesheet whose dark ink is the light one, and on one that sets none', () => {
    const poisoned = css.replace(new RegExp(INK.dark.replace('#', '#'), 'giu'), INK.light);
    assert.notEqual(poisoned, css, 'the poison changed nothing');
    const found = failures(poisoned);
    assert.ok(found.some((f) => /dark: --dw-this-ink/u.test(f)), found.join('\n'));
    assert.ok(found.some((f) => /midnight dark: the note's ink/u.test(f)), found.join('\n'));
    assert.ok(failures('').length > 0);
  });
  test('the inks are written as plain hex, and the swipes as rgb with an alpha', () => {
    assert.match(INK.light, /^#[0-9a-f]{6}$/u);
    assert.match(INK.dark, /^#[0-9a-f]{6}$/u);
    for (const s of Object.values(SWIPE)) assert.match(s, /^rgb\(\d+ \d+ \d+ \/ [\d.]+\)$/u);
  });
});
