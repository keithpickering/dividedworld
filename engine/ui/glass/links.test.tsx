/**
 * A link on the glass takes the glass's ink, never the board's. The board's link colors (engine/ui/base.css) are the board theme's, set
 * for the board's ground, and the glass draws its own dark ground whatever the board theme is. In the house theme's light mode a
 * visited link was #3a3a3a, and `a:visited` outranked every one-class rule, so the glass menu's visited tabs and its Back link drew
 * dark gray on near-black while the current tab, at two classes, stayed white.
 *
 * Two things hold it. The board's link rules sit at an element's weight, so any rule that names a link by its class sets that link's
 * color, visited or not. And the glass gives the link tokens its own ink, so a link on it that no rule colors still reads.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const sheet = (f: string) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Every rule in `css` as [selector, declarations], one entry per selector in a list. */
function rules(css: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) for (const s of m[1]!.split(',')) out.push([squash(s), squash(m[2]!)]);
  return out;
}

/** A selector's specificity as [ids, classes, elements]. `:where()` counts nothing; the selectors this reads use no other functional pseudo-class. */
function specificity(selector: string): [number, number, number] {
  const s = selector.replace(/:where\([^()]*\)/g, '');
  if (/:(is|not|has)\(/.test(s)) throw new Error(`specificity() cannot weigh ${selector}`);
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const elements = (s.match(/(?:^|[\s>+~])[a-z][\w-]*|::[\w-]+/gi) ?? []).length;
  return [ids, classes, elements];
}

describe('specificity()', () => {
  it.each([
    ['a', [0, 0, 1]], ['a:visited', [0, 1, 1]], ['a:where(:visited)', [0, 0, 1]], ['.kb-glass-menu-tab', [0, 1, 0]],
    [".kb-glass-menu-tab[aria-current='page']", [0, 2, 0]], ['.kb-nav a:visited', [0, 2, 1]], ['p::before', [0, 0, 2]],
  ])('weighs %s as %j', (sel, w) => {
    expect(specificity(sel)).toEqual(w);
  });
});

describe("the board's link rules", () => {
  const link = rules(sheet('engine/ui/base.css')).filter(([sel]) => /(^|[\s>+~])a($|[:.[])/.test(sel));

  it('are found', () => {
    expect(link.map(([sel]) => sel).length).toBeGreaterThan(0);
  });

  it("weigh no more than an element, so a link's own class sets its color, visited or not", () => {
    const heavy = link.filter(([sel]) => { const [i, c] = specificity(sel); return i > 0 || c > 0; }).map(([sel]) => sel);
    expect(heavy).toEqual([]);
  });

  it('still color a visited link, after the plain link rule', () => {
    const sels = link.map(([sel]) => sel);
    const visited = sels.findIndex((sel) => sel.includes(':visited'));
    expect(visited).toBeGreaterThan(sels.indexOf('a'));
    expect(link[visited]![1]).toMatch(/color:\s*var\(--kb-link-visited\)/);
  });
});

describe('the glass', () => {
  const glass = rules(sheet('engine/ui/glass/base.css')).filter(([sel]) => sel === '.kb-glass').map(([, d]) => d).join(';');

  it.each(['--kb-link', '--kb-link-visited'])('gives %s its own ink', (token) => {
    expect(glass).toMatch(new RegExp(`${token}:\\s*var\\(--kb-glass-pale\\)`));
  });
});
