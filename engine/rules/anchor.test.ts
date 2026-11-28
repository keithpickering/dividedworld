import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../bbcode/parse.ts';
import { visibleText } from '../bbcode/visible.ts';
import { CAP, MARGIN, contentOf, groupsOf, mapPlace, mapPlaces, type Attachment, type StrokeShape } from './anchor.ts';

const IMG = 'https://example.com/a.png';
const IMG2 = 'https://example.com/b.png';

test('contentOf gives the visible text and the images in tree order, quotes included, with each copy numbered', () => {
  const body = `[b]bold[/b] [img]${IMG}[/img] words [quote=0a1b2c3d-0000-4000-8000-000000000001][img]${IMG2}[/img] quoted[/quote] [img]${IMG}[/img]`;
  const c = contentOf(body);
  assert.equal(c.text, visibleText(parse(body)));
  assert.deepEqual(c.images, [{ src: IMG, nth: 0 }, { src: IMG2, nth: 0 }, { src: IMG, nth: 1 }]);
});

test('contentOf finds an image inside a list item and a link, and none in code', () => {
  const body = `[list][*][img]${IMG}[/img][/list][url=https://example.com][img]${IMG2}[/img][/url][code][img]${IMG}[/img][/code]`;
  assert.deepEqual(contentOf(body).images, [{ src: IMG, nth: 0 }, { src: IMG2, nth: 0 }]);
});

test('contentOf leaves out an http: image, which the renderer draws as a link, and counts copies among the drawn ones', () => {
  const body = `[img]http://example.com/a.png[/img] [img]${IMG}[/img] [img]HTTP://example.com/a.png[/img] [img]${IMG}[/img]`;
  assert.deepEqual(contentOf(body).images, [{ src: IMG, nth: 0 }, { src: IMG, nth: 1 }]);
});

test('contentOf reads a forged quote as the renderer does: a counterfeit whose words are visible text', () => {
  const act = '0a1b2c3d-0000-4000-8000-000000000001';
  const body = `hi [quote=${act}][img]${IMG2}[/img] said[/quote] [img]${IMG}[/img] end`;
  const forged = new Set([act]);
  const c = contentOf(body, forged);
  assert.equal(c.text, visibleText(parse(body, undefined, forged)));
  assert.notEqual(c.text, contentOf(body).text);
  assert.deepEqual(c.images, [{ src: IMG2, nth: 0 }, { src: IMG, nth: 0 }]);
});

// Drawing helpers: strokes in px of one frame, Stock-sized brush (r 5).
const R = 5;
const s = (...points: [number, number][]): StrokeShape => ({ points, r: R });
const at = (dx: number, dy: number, p: [number, number][]): [number, number][] => p.map(([x, y]) => [x + dx, y + dy]);
const H: [number, number][][] = [[[0, 0], [0, 70]], [[40, 0], [40, 70]], [[0, 35], [40, 35]]];
const E: [number, number][][] = [[[0, 0], [0, 70]], [[0, 0], [35, 0]], [[0, 35], [30, 35]], [[0, 70], [35, 70]]];
const L: [number, number][][] = [[[0, 0], [0, 70]], [[0, 70], [30, 70]]];
const O: [number, number][][] = [[[0, 0], [35, 0], [35, 70], [0, 70], [0, 0]]];
const letter = (shape: [number, number][][], x: number, y = 0): StrokeShape[] => shape.map((p) => s(...at(x, y, p)));
// 22px of clear space between ink: the letter's width + 2r of paint + 22.
const hello = (): StrokeShape[] => {
  const out: StrokeShape[] = [];
  let x = 0;
  for (const [shape, w] of [[H, 40], [E, 35], [L, 30], [L, 30], [O, 35]] as const) { out.push(...letter(shape, x)); x += w + 2 * R + 22; }
  return out;
};

test('groupsOf: the five letters of HELLO at 70px with 22px gaps are one group', () => {
  const strokes = hello();
  assert.deepEqual(groupsOf(strokes), [strokes.map((_, i) => i)]);
});

test('groupsOf: a ring and an arrow whose tip stops 10px from the ring are one group', () => {
  const ring = s([0, 0], [60, 0], [60, 60], [0, 60], [0, 0]);
  // The arrow's tip stops 10px of clear paint-to-paint space left of the ring: cores 10 + 2r apart.
  const arrow = s([-80, 30], [-(10 + 2 * R), 30]);
  assert.deepEqual(groupsOf([ring, arrow]), [[0, 1]]);
});

test('groupsOf: a ring and a "??" 300px away are two groups', () => {
  const ring = s([0, 0], [60, 0], [60, 60], [0, 60], [0, 0]);
  const q = (x: number): StrokeShape[] => [s(...at(x, 0, [[0, 10], [10, 0], [20, 10], [10, 25], [10, 40]])), s(...at(x, 0, [[10, 55], [10, 56]]))];
  assert.deepEqual(groupsOf([ring, ...q(360), ...q(400)]), [[0], [1, 2, 3, 4]]);
});

test('groupsOf: a dot under a "?" (a gap less than the "?"s height) joins it', () => {
  const hook = s([0, 10], [10, 0], [20, 10], [10, 25], [10, 40]);
  const dot = s([10, 70], [10, 71]);
  assert.deepEqual(groupsOf([hook, dot]), [[0, 1]]);
  const far = s([10, 200], [10, 201]);
  assert.deepEqual(groupsOf([hook, far]), [[0], [1]]);
});

test('groupsOf: the full height of a figure, not of one stroke, decides whether a dot joins', () => {
  // Two strokes end to end make one figure 210px tall (each alone is 110px).
  const tall = [s([0, 0], [0, 100]), s([0, 100], [0, 200])];
  const near = s([155, 100], [155, 101]); // 145px of clear space from the figure: under 210, over 110
  assert.deepEqual(groupsOf([...tall, near]), [[0, 1, 2]]);
  const far = s([245, 100], [245, 101]); // 235px: over 210
  assert.deepEqual(groupsOf([...tall, far]), [[0, 1], [2]]);
  // The same, with the figure's strokes crossing: a tall "+" whose arms' ends are far apart.
  const plus = [s([0, 0], [0, 200]), s([-100, 100], [100, 100])];
  assert.deepEqual(groupsOf([...plus, s([330, 100], [330, 101])]), [[0, 1], [2]]);
  assert.deepEqual(groupsOf([...plus, s([200, 100], [200, 101])]), [[0, 1, 2]]);
});

test('groupsOf: a stroke with no points or a point that is not a number is a group of its own, and joins nothing', () => {
  const hook = s([0, 10], [10, 0], [20, 10], [10, 25], [10, 40]);
  const dot = s([10, 70], [10, 71]);
  const empty = s();
  const nan = s([NaN, 0], [5, 5]);
  const inf = s([Infinity, 0]);
  assert.deepEqual(groupsOf([hook, empty, dot, nan, inf]), [[0, 2], [1], [3], [4]]);
  assert.deepEqual(groupsOf([empty]), [[0]]);
});

test('groupsOf: groups keep the order of their first strokes', () => {
  const a = s([500, 0], [500, 50]);
  const b = s([0, 0], [0, 50]);
  const a2 = s([500, 60], [500, 70]);
  assert.deepEqual(groupsOf([a, b, a2]), [[0, 2], [1]]);
});

test('groupsOf: strokes whose cores touch are one figure even across a long chain', () => {
  const chain = Array.from({ length: 5 }, (_, i) => s([i * 10, 0], [i * 10 + 10, 0]));
  assert.deepEqual(groupsOf(chain), [[0, 1, 2, 3, 4]]);
  assert.deepEqual(groupsOf([]), []);
});

const word = 'The quick brown fox jumps over the lazy dog, said the narrator slowly. ';
const text = (at: number, len: number): Attachment => ({ kind: 'text', version: 'v1', at, len, dx: 1, dy: 2 });
const content = (t: string) => ({ text: t, images: [] });

test('mapPlace: a typo fixed 30 characters before the run moves `at` by the change', () => {
  const from = word.repeat(3);
  const i = from.indexOf('quick');
  const to = from.slice(0, i) + from.slice(i + 1); // delete one char at i
  const at0 = i + 30;
  const m = mapPlace(content(from), content(to), text(at0, 5)) as Extract<Attachment, { kind: 'text' }>;
  assert.equal(m.at, at0 - 1);
  assert.equal(to.slice(m.at, m.at + 5), from.slice(at0, at0 + 5));
  assert.equal(m.dx, 1);
});

test('mapPlace: a typo inside the run, or within 8 characters of it, gives null', () => {
  const from = word.repeat(3);
  const at0 = 100;
  const inside = from.slice(0, at0 + 2) + 'X' + from.slice(at0 + 3);
  assert.equal(mapPlace(content(from), content(inside), text(at0, 5)), null);
  const near = from.slice(0, at0 - 6) + 'X' + from.slice(at0 - 5);
  assert.equal(mapPlace(content(from), content(near), text(at0, 5)), null);
  const edgeOk = from.slice(0, at0 - 9) + 'X' + from.slice(at0 - 8);
  assert.notEqual(mapPlace(content(from), content(edgeOk), text(at0, 5)), null);
});

test('mapPlace: text added after the run leaves `at` as it was', () => {
  const from = word.repeat(3);
  const m = mapPlace(content(from), content(from + ' And more.'), text(40, 5)) as Extract<Attachment, { kind: 'text' }>;
  assert.equal(m.at, 40);
});

test('mapPlace: a rewrite that keeps the word somewhere else gives null (no search)', () => {
  const from = 'Hello there, this is my first post on the board, and I like it a lot.';
  const to = 'My first post. Oh and also: this is a complete rewrite with nothing else. Hello there!';
  assert.equal(mapPlace(content(from), content(to), text(0, 5)), null);
});

test('mapPlace: an image whose second copy is removed keeps the first and drops the second', () => {
  const from = { text: '\n\n', images: [{ src: IMG, nth: 0 }, { src: IMG, nth: 1 }] };
  const to = { text: '\n', images: [{ src: IMG, nth: 0 }] };
  const img = (n: number, nth: number): Attachment => ({ kind: 'image', version: 'v1', n, src: IMG, nth, x: 0.5, y: 0.5 });
  const first = mapPlace(from, to, img(0, 0)) as Extract<Attachment, { kind: 'image' }>;
  assert.equal(first.n, 0);
  assert.equal(first.nth, 0);
  assert.equal(mapPlace(from, to, img(1, 1)), null);
});

test('mapPlace: an image keeps its attachment under a new index when an earlier image goes', () => {
  const from = { text: '\n\n', images: [{ src: IMG2, nth: 0 }, { src: IMG, nth: 0 }] };
  const to = { text: '\n', images: [{ src: IMG, nth: 0 }] };
  const m = mapPlace(from, to, { kind: 'image', version: 'v1', n: 1, src: IMG, nth: 0, x: 0.2, y: 0.9 }) as Extract<Attachment, { kind: 'image' }>;
  assert.equal(m.n, 0);
  assert.equal(m.x, 0.2);
});

test('mapPlace: a box attachment comes back unchanged', () => {
  const a: Attachment = { kind: 'box' };
  assert.deepEqual(mapPlace(content('a'), content('totally different'), a), a);
});

test('mapPlace: a diff past the cap gives null for text', () => {
  const from = 'a'.repeat(1500) + ' the run ' + 'a'.repeat(100);
  const to = 'b'.repeat(1500) + ' the run ' + 'b'.repeat(100);
  assert.equal(mapPlace(content(from), content(to), text(1510, 3)), null);
});

test('mapPlace: identical text keeps every text attachment, even at the ends', () => {
  const from = 'short';
  const m = mapPlace(content(from), content(from), text(0, 5)) as Extract<Attachment, { kind: 'text' }>;
  assert.equal(m.at, 0);
});

test('mapPlace: whenever a text group survives, the whole window around it is unchanged, held to the text', () => {
  let seed = 7;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alpha = 'abcde ';
  let survivors = 0;
  for (let t = 0; t < 300; t++) {
    let from = '';
    for (let i = 0, n = 40 + rnd(60); i < n; i++) from += alpha[rnd(alpha.length)];
    let to = from;
    for (let e = 0, k = rnd(4); e < k; e++) { const p = rnd(to.length + 1); to = to.slice(0, p) + (rnd(2) ? alpha[rnd(alpha.length)]! : '') + to.slice(p + rnd(3)); }
    const len = 3, at0 = rnd(from.length - len + 1);
    const m = mapPlace(content(from), content(to), text(at0, len)) as Extract<Attachment, { kind: 'text' }> | null;
    if (!m) continue;
    survivors++;
    const lo = Math.max(0, at0 - MARGIN), hi = Math.min(from.length, at0 + len + MARGIN), delta = m.at - at0;
    assert.equal(to.slice(lo + delta, hi + delta), from.slice(lo, hi), `${from} -> ${to} @${at0}`);
  }
  assert.ok(survivors > 0, 'some groups survive, or the test proves nothing');
});

test('mapPlace: a run that starts past the end of the old text gives null', () => {
  const from = 'short text';
  assert.equal(mapPlace(content(from), content(from), text(from.length + 5, 3)), null);
  assert.equal(mapPlace(content(from), content(from), text(from.length, 3)), null);
  assert.equal(mapPlace(content(from), content(from), text(from.length - 2, 3)), null);
});

test('mapPlace: a diff of exactly CAP edits succeeds, and one more gives null', () => {
  const tail = ' the run is here and stays put ';
  const at0 = CAP / 2 + MARGIN + 4; // clear of the changed stretch by its margin
  const ok = mapPlace(content('a'.repeat(CAP / 2) + tail), content('b'.repeat(CAP / 2) + tail), text(at0, 3)) as Extract<Attachment, { kind: 'text' }> | null;
  assert.equal(ok?.at, at0);
  assert.equal(mapPlace(content('a'.repeat(CAP / 2 + 1) + tail), content('b'.repeat(CAP / 2) + tail), text(at0 + 1, 3)), null);
});

test('mapPlaces gives, for every attachment, what mapPlace gives', () => {
  const from = word.repeat(3);
  const i = from.indexOf('quick');
  const to = from.slice(0, i) + 'slow' + from.slice(i + 5);
  const f = { text: from, images: [{ src: IMG, nth: 0 }] }, g = { text: to, images: [{ src: IMG, nth: 0 }] };
  const atts: Attachment[] = [
    text(0, 3), text(i, 5), text(i + 20, 4), text(from.length - 4, 4), text(from.length + 3, 2), { kind: 'box' },
    { kind: 'image', version: 'v1', n: 0, src: IMG, nth: 0, x: 0.1, y: 0.2 }, { kind: 'image', version: 'v1', n: 1, src: IMG, nth: 1, x: 0.1, y: 0.2 },
  ];
  assert.deepEqual(mapPlaces(f, g, atts), atts.map((a) => mapPlace(f, g, a)));
  assert.deepEqual(mapPlaces(f, g, []), []);
});

test('mapPlace: over many random edits, every run that survives has its whole margin window unchanged, and many survive', () => {
  let seed = 99;
  let survivors = 0, tried = 0;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let t = 0; t < 100; t++) {
    let from = '';
    for (let i = 0, n = 200 + rnd(200); i < n; i++) from += 'abcdefgh'[rnd(8)];
    let to = from;
    for (let e = 0, k = 5 + rnd(30); e < k; e++) { const p = rnd(to.length + 1); to = to.slice(0, p) + (rnd(2) ? 'xyz'[rnd(3)]! : '') + to.slice(p + rnd(4)); }
    for (let at0 = 0; at0 + 2 <= from.length; at0 += 7) {
      const m = mapPlace(content(from), content(to), text(at0, 2)) as Extract<Attachment, { kind: 'text' }> | null;
      tried++;
      if (!m) continue;
      survivors++;
      const lo = Math.max(0, at0 - MARGIN), hi = Math.min(from.length, at0 + 2 + MARGIN), delta = m.at - at0;
      assert.equal(to.slice(lo + delta, hi + delta), from.slice(lo, hi));
    }
  }
  assert.ok(survivors > tried / 2, `${survivors} of ${tried} runs survived; a walk back that cut stretches short would strand most of them`);
});
