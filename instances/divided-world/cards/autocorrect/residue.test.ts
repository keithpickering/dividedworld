import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf, type Mode, type Tokens } from '../../../../engine/ui/contrast.ts';
import { LIGHT_GRID, bandOf, shineIsReadable, toHex, toLinear, type Band, type Light } from '../../../../engine/ui/shine/band.ts';
import { endJags } from './paper.ts';
import { EDGE_HALF, FILM_MAX, GLOSS_ALPHA, filmAlpha, fibersAt, residueInk, type ResidueInk } from './residue.ts';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
/* Both boards' tokens: the engine's, then Divided World's theme over them. */
const tokens = tokensOf(read('engine/ui/tokens.css'), read('instances/divided-world/ui/theme.css'));

/** sRGB channels of a #rrggbb. */
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** `top` over `under` at `alpha`, per channel in sRGB as a canvas blends, rounded to 8 bits. */
const over = (under: string, top: string, alpha: number) => {
  const u = rgb(under), t = rgb(top);
  return `#${u.map((c, i) => Math.round(c + (t[i]! - c) * alpha).toString(16).padStart(2, '0')).join('')}`;
};

/** The colors the residue draws on a board: bare ground, the thickest film, and the thickest film with the brightest gloss. */
function composite(mode: Mode, light: Light, inkOf: (band: Band, light: Light) => ResidueInk): string[] {
  const t: Tokens = tokens[mode];
  const ground = toHex(toLinear(t['--kb-bg']!));
  const ink = inkOf(bandOf(t), light);
  const film = over(ground, ink.tint, FILM_MAX);
  return [film, over(film, ink.gloss, GLOSS_ALPHA), over(film, ink.gloss, 1)];
}

describe('the residue stays readable', () => {
  test('its thickest film plus its brightest gloss holds 4.5:1 against every post ink, at every light, on both boards', () => {
    assert.deepEqual(shineIsReadable(tokens, (mode, light) => composite(mode, light, residueInk)), []);
  });

  test('POISON: the same check with a residueInk that skips the clamp fails', () => {
    const unclamped = (band: Band, light: Light): ResidueInk => {
      /* The colors as they come before the clamp: the board's own tint and the warm white gloss at full strength. */
      void light;
      return { tint: band.board === 'dark' ? '#c4a662' : '#ba923a', gloss: '#fff1c4' };
    };
    const failures = shineIsReadable(tokens, (mode, light) => composite(mode, light, unclamped));
    assert.ok(failures.length > 0, 'an unclamped residue passed the band check');
  });

  test('the tint and the gloss keep their hue under the clamp', () => {
    const band = bandOf(tokens.dark);
    const a = residueInk(band, { x: 0, y: 0 });
    assert.notEqual(a.tint, a.gloss);
    const [r, g, b] = rgb(a.tint) as [number, number, number];
    assert.ok(r >= g && g >= b, `the tint ${a.tint} lost its warm order`);
  });

  test('the gloss moves with the light', () => {
    const band = bandOf(tokens.light);
    assert.notEqual(residueInk(band, { x: 0, y: 0 }).gloss, residueInk(band, { x: 1.5, y: 1.5 }).gloss);
    assert.ok(LIGHT_GRID.length > 0);
  });
});

describe('the film', () => {
  const W = 90, H = 20;

  test('one seed gives the same film twice, two seeds differ, and Math.random is never read', () => {
    const spy = mock.method(Math, 'random', () => { throw new Error('Math.random was read'); });
    try {
      const a = filmAlpha(W, H, 'k:1'), b = filmAlpha(W, H, 'k:1'), c = filmAlpha(W, H, 'k:2');
      assert.equal(a.length, W * 2 * H * 2);
      assert.deepEqual(a, b);
      assert.notDeepEqual(a, c);
      assert.deepEqual(fibersAt('k:1', 40, H), fibersAt('k:1', 40, H));
    } finally {
      spy.mock.restore();
    }
  });

  test('its alpha is 0 outside the torn outline, and above 0 well inside it', () => {
    const film = filmAlpha(W, H, 'k:1');
    const ends = endJags('k:1', W, H);
    const cols = W * 2;
    let outside = 0, inside = 0;
    for (let y = 0; y < H * 2; y++) {
      const py = (y + 0.5) / 2;
      const at = (pts: typeof ends.left) => { const n = pts.length - 1, k = Math.min(n - 1, Math.floor((py / H) * n)); const [x0, y0] = pts[k]!, [x1, y1] = pts[k + 1]!; return x0 + ((x1 - x0) * (py - y0)) / (y1 - y0); };
      const xl = at(ends.left), xr = at(ends.right);
      for (let x = 0; x < cols; x++) {
        const px = (x + 0.5) / 2, a = film[y * cols + x]!;
        if (px < xl - 0.01 || px > xr + 0.01) { outside++; assert.equal(a, 0, `alpha ${a} at (${px}, ${py}) outside the outline`); }
        else if (px > xl + 5 && px < xr - 5) { inside++; assert.ok(a > 0, `no film at (${px}, ${py}) inside`); }
      }
    }
    assert.ok(outside > 0 && inside > 0);
  });

  test('its alpha is highest along the edge line', () => {
    const film = filmAlpha(W, H, 'k:1');
    const cols = W * 2;
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    const edge: number[] = [], body: number[] = [];
    for (let y = 0; y < H * 2; y++) for (let x = 20; x < cols - 20; x++) {
      const py = (y + 0.5) / 2, a = film[y * cols + x]!;
      if (Math.min(py, H - py) <= EDGE_HALF) edge.push(a);
      else if (Math.min(py, H - py) > 2) body.push(a);
    }
    assert.ok(mean(edge) > mean(body) + 0.2, `edge ${mean(edge).toFixed(2)} against body ${mean(body).toFixed(2)}`);
    assert.ok(Math.min(...edge) >= 0.9 * 0.9, 'every pixel on the edge line is at least the line\'s own strength');
    assert.ok(Math.max(...film) <= 1);
  });

  test('a tear\'s fiber cluster is four to eight strokes near the tear', () => {
    const f = fibersAt('k:1', 40, H);
    assert.ok(f.length >= 4 && f.length <= 8, String(f.length));
    assert.ok(f.every((s) => Math.abs(s.x0 - 40) <= 2.5 && s.y0 >= 1 && s.y0 <= H - 1));
    assert.notDeepEqual(f, fibersAt('k:1', 41, H));
    assert.ok(GLOSS_ALPHA > 0);
  });
});
