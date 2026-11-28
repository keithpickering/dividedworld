/**
 * Placing a drawing's groups on a screen (place.ts; docs/plans/2026-11-27-graffiti-everywhere-design.md, section 4), over rectangles a test hands it:
 * where an attachment is, how wide the group is, and how big the box is. No DOM.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_SLACK, NUDGE_STEPS, placeGroups, type PlaceGroup, type Measured } from './place.ts';

const EM = 15;
/** A group of one horizontal stroke `wide` units long, centered on its origin, with a brush of radius `r` units; its drawer's box is 24 by 40 ems. */
const group = (over: Partial<PlaceGroup> & { wide?: number; r?: number } = {}): PlaceGroup => {
  const { wide = 4, r = 0.5, ...rest } = over;
  return { drawing: 'd1', at: [0.5, 0.5], anchor: { kind: 'box' }, unit: 'em', frame: { w: 24, h: 40 }, strokes: [{ points: [[-wide / 2, 0], [wide / 2, 0]], r }], ...rest };
};
const textAt = (dx = 0, dy = 0): PlaceGroup['anchor'] => ({ kind: 'text', version: 'v1', at: 3, len: 4, dx, dy });
const box = { w: 360, h: 600 };
const bounds = (g: PlaceGroup, p: { x: number; y: number; scale: number }, em = EM) => {
  const r = Math.max(...g.strokes.map((s) => s.r));
  const xs = g.strokes.flatMap((s) => s.points.map((q) => q[0])), ys = g.strokes.flatMap((s) => s.points.map((q) => q[1]));
  return { x0: p.x + (Math.min(...xs) - r) * em * p.scale, x1: p.x + (Math.max(...xs) + r) * em * p.scale, y0: p.y + (Math.min(...ys) - r) * em * p.scale, y1: p.y + (Math.max(...ys) + r) * em * p.scale };
};
const inside = (b: ReturnType<typeof bounds>) => b.x0 >= -1e-9 && b.y0 >= -1e-9 && b.x1 <= box.w + 1e-9 && b.y1 <= box.h + 1e-9;
const overlap = (a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('placing groups on a screen', () => {
  test('a text group lands at its mark plus its offset, in ems of this screen', () => {
    const g = group({ anchor: textAt(2, 1.5) });
    const measured: (Measured | null)[] = [{ kind: 'point', x: 100, y: 200 }];
    const [p] = placeGroups([g], measured, box, EM);
    assert.deepEqual(p, { x: 100 + 2 * EM, y: 200 + 1.5 * EM, scale: 1 });
  });

  test('an image group lands at its point in the image rect, and its unit is the image width', () => {
    const g = group({ unit: 'image', em: 8, anchor: { kind: 'image', version: 'v1', n: 0, src: 'https://a.example/i.png', nth: 0, x: 0.5, y: 0.25 }, strokes: [{ points: [[-0.1, 0], [0.1, 0]], r: 0.02 }] });
    const [p] = placeGroups([g], [{ kind: 'rect', x: 40, y: 100, w: 200, h: 80 }], box, EM);
    assert.equal(p!.scale, 1);
    assert.equal(p!.x, 40 + 0.5 * 200);
    assert.equal(p!.y, 100 + 0.25 * 80);
  });

  test('a group 900px wide in a 360px box is scaled to 0.4 and lies inside the box', () => {
    const g = group({ wide: 59, r: 0.5, anchor: textAt() });
    assert.equal((59 + 1) * EM, 900);
    const [p] = placeGroups([g], [{ kind: 'point', x: 10, y: 50 }], box, EM);
    assert.ok(Math.abs(p!.scale - 0.4) < 1e-12, `scale ${p!.scale}`);
    assert.ok(inside(bounds(g, p!)), JSON.stringify(bounds(g, p!)));
  });

  test('a group that fits is never scaled up, and one only taller than the box is not shrunk', () => {
    const tall = group({ strokes: [{ points: [[0, -50], [0, 50]], r: 0.5 }] });
    const [p, q] = placeGroups([group(), tall], [null, null], box, EM);
    assert.equal(p!.scale, 1);
    assert.equal(q!.scale, 1);
  });

  test('a group hanging past the right edge is pulled in, and one past the left or top is too', () => {
    const g = group({ anchor: textAt() });
    const [right, left, top, bottom] = placeGroups([g, g, g, g], [{ kind: 'point', x: 350, y: 100 }, { kind: 'point', x: 5, y: 100 }, { kind: 'point', x: 100, y: 2 }, { kind: 'point', x: 100, y: 598 }], box, EM);
    for (const p of [right!, left!, top!, bottom!]) assert.ok(inside(bounds(g, p)), JSON.stringify(bounds(g, p)));
    assert.equal(bounds(g, right!).x1, box.w);
    assert.equal(bounds(g, left!).x0, 0);
    assert.equal(bounds(g, top!).y0, 0);
    assert.equal(bounds(g, bottom!).y1, box.h);
    // Pulled, never moved further than it had to be.
    assert.equal(right!.y, 100);
    assert.equal(left!.y, 100);
  });

  test('a group whose attachment is missing lands at its spot in the box', () => {
    const text = group({ at: [0.25, 0.5], anchor: textAt(2, 1) });
    const image = group({ at: [0.75, 0.1], unit: 'image', em: 6, anchor: { kind: 'image', version: 'v1', n: 3, src: 'https://a.example/x.png', nth: 0, x: 0.5, y: 0.5 }, strokes: [{ points: [[-0.05, 0], [0.05, 0]], r: 0.01 }] });
    const [a, b, c] = placeGroups([text, image, group({ at: [0.5, 0.25] })], [null, null, null], box, EM);
    assert.deepEqual(a, { x: 0.25 * box.w, y: 0.5 * box.h, scale: 1 });
    assert.equal(b!.x, 0.75 * box.w);
    assert.equal(b!.y, 0.1 * box.h);
    assert.deepEqual(c, { x: 0.5 * box.w, y: 0.25 * box.h, scale: 1 });
    // A missing image's unit is what it was when drawn: 6 ems to a width, so this group is 0.1 * 6 * 15 = 9px of line.
    const wide = bounds({ ...image, strokes: image.strokes }, b!, 6 * EM);
    assert.ok(wide.x1 - wide.x0 < 20);
  });

  test('two groups of one drawing that overlap after placement are moved apart, and the later one moves', () => {
    const a = group({ at: [0.2, 0.2], anchor: textAt() });
    const b = group({ at: [0.8, 0.2], anchor: textAt() });
    // Far apart in the drawer's frame (24 by 40 ems), together on this screen.
    const [pa, pb] = placeGroups([a, b], [{ kind: 'point', x: 100, y: 100 }, { kind: 'point', x: 110, y: 104 }], box, EM);
    assert.deepEqual(pa, { x: 100, y: 100, scale: 1 });
    assert.ok(!overlap(bounds(a, pa!), bounds(b, pb!)));
    assert.equal(pb!.x, 110);
    assert.ok(pb!.y > 104);
    assert.equal((pb!.y - 104) % EM, 0, 'in steps of one em');
  });

  test('a nudge goes up where down would leave the box', () => {
    const a = group({ at: [0.2, 0.2], anchor: textAt() });
    const b = group({ at: [0.8, 0.2], anchor: textAt() });
    const [pa, pb] = placeGroups([a, b], [{ kind: 'point', x: 100, y: 580 }, { kind: 'point', x: 110, y: 584 }], box, EM);
    assert.ok(inside(bounds(a, pa!)));
    assert.ok(inside(bounds(b, pb!)), JSON.stringify(bounds(b, pb!)));
    assert.ok(!overlap(bounds(a, pa!), bounds(b, pb!)));
    assert.ok(pb!.y < 584);
  });

  test('where neither down nor up clears it, it takes the place of least overlap, down before up', () => {
    const shortBox = { w: 360, h: 60 };
    const strip = [{ points: [[-2, 0], [2, 0]] as [number, number][], r: 1 }];
    const a = group({ at: [0.2, 0.2], anchor: textAt(), strokes: strip });
    const b = group({ at: [0.8, 0.2], anchor: textAt(), strokes: strip });
    const [pa, pb] = placeGroups([a, b], [{ kind: 'point', x: 100, y: 30 }, { kind: 'point', x: 100, y: 30 }], shortBox, EM);
    assert.deepEqual(pa, { x: 100, y: 30, scale: 1 });
    const [x, y] = [bounds(a, pa!), bounds(b, pb!)];
    const area = Math.max(0, Math.min(x.x1, y.x1) - Math.max(x.x0, y.x0)) * Math.max(0, Math.min(x.y1, y.y1) - Math.max(x.y0, y.y0));
    const whole = (x.x1 - x.x0) * (x.y1 - x.y0);
    assert.ok(area > 0 && area < whole, `it still overlaps, by less than where it began: ${area} of ${whole}`);
    assert.equal(pb!.y, 45);
    assert.ok(y.y0 >= 0 && y.y1 <= shortBox.h);
  });

  test('two groups of one drawing that overlapped on the drawer\'s own screen are left as they are', () => {
    const a = group({ at: [0.5, 0.5], anchor: textAt() });
    const b = group({ at: [0.52, 0.5], anchor: textAt() });
    const [pa, pb] = placeGroups([a, b], [{ kind: 'point', x: 100, y: 100 }, { kind: 'point', x: 110, y: 104 }], box, EM);
    assert.deepEqual(pa, { x: 100, y: 100, scale: 1 });
    assert.deepEqual(pb, { x: 110, y: 104, scale: 1 });
  });

  test('two groups of different drawings that overlap are left where they are', () => {
    const a = group({ drawing: 'd1', at: [0.2, 0.2], anchor: textAt() });
    const b = group({ drawing: 'd2', at: [0.8, 0.2], anchor: textAt() });
    const [pa, pb] = placeGroups([a, b], [{ kind: 'point', x: 100, y: 100 }, { kind: 'point', x: 110, y: 104 }], box, EM);
    assert.deepEqual(pa, { x: 100, y: 100, scale: 1 });
    assert.deepEqual(pb, { x: 110, y: 104, scale: 1 });
    assert.ok(overlap(bounds(a, pa!), bounds(b, pb!)));
  });

  test('a group is judged by its strokes\' bounds plus its widest cap\'s radius', () => {
    // 10 ems of line and a brush of radius 2 ems: 14 ems, 210px, across.
    const g = group({ wide: 10, anchor: textAt(), strokes: [{ points: [[-5, 0], [5, 0]], r: 0.5 }, { points: [[-1, 1], [1, 1]], r: 2 }] });
    const [p] = placeGroups([g], [{ kind: 'point', x: 355, y: 100 }], box, EM);
    assert.equal(bounds(g, p!).x1, box.w);
    assert.equal(p!.x, box.w - 7 * EM);
  });
  test('a nudge walks at most NUDGE_STEPS ems each way, so a huge box or a tiny em returns promptly and the group is still pulled no further than that', () => {
    const [big, tiny] = [{ w: 360, h: 1e5 }, 0.01];
    const a = group({ at: [0.2, 0.2], anchor: textAt() });
    const b = group({ at: [0.8, 0.2], anchor: textAt() });
    const started = performance.now();
    const [pa, pb] = placeGroups([a, b], [{ kind: 'point', x: 100, y: 5e4 }, { kind: 'point', x: 100, y: 5e4 }], big, tiny);
    const took = performance.now() - started;
    assert.ok(took < 250, `took ${took} ms`);
    assert.equal(pa!.y, 5e4);
    assert.ok(Math.abs(pb!.y - 5e4) <= NUDGE_STEPS * tiny + 1e-9, `moved ${pb!.y - 5e4}`);
    assert.equal(NUDGE_STEPS, 400);
  });

  test('a box or an em that is not a positive finite number skips the nudge, and places the groups where the earlier steps put them', () => {
    const a = group({ at: [0.2, 0.2], anchor: textAt() });
    const b = group({ at: [0.8, 0.2], anchor: textAt() });
    const at = [{ kind: 'point', x: 100, y: 100 }, { kind: 'point', x: 110, y: 104 }] as const;
    for (const [bx, em] of [[{ w: 360, h: Infinity }, EM], [{ w: 360, h: 600 }, 0], [{ w: 360, h: 600 }, -3], [{ w: NaN, h: 600 }, EM]] as const) {
      const [, pb] = placeGroups([a, b], at, bx, em);
      assert.equal(pb!.y, 104, JSON.stringify([bx, em]));
    }
  });

  describe('an image group is never drawn larger than IMAGE_SLACK times its counted share of the box (issue #1261)', () => {
    /* The drawer's box: 65.8 ems, 987 px at 15 px. The image on the drawer's screen is 30 ems, 450 px, wide. */
    const frame = { w: 65.8, h: 40 };
    const image = { kind: 'image', version: 'v1', n: 0, src: 'https://a.example/i.png', nth: 0, x: 0.5, y: 0.5 } as const;
    const wideBox = { w: frame.w * EM, h: 600 };
    const imageGroup = (em: number, half: number, r: number): PlaceGroup => ({ drawing: 'd1', at: [0.5, 0.5], anchor: image, unit: 'image', em, frame, strokes: [{ points: [[-half, 0], [half, 0]], r }] });
    /** The group's width in its own units, its strokes' bounds plus its widest brush's radius. */
    const extent = (g: PlaceGroup) => 2 * (g.strokes[0]!.points[1]![0] + g.strokes[0]!.r);
    /** Its counted share of the box: its extent in ems of the drawer's frame over the frame's width. */
    const counted = (g: PlaceGroup) => (extent(g) * g.em!) / g.frame.w;
    /** Its drawn share of this screen's box: its extent at the image's width, scaled, over the box's width. */
    const drawn = (g: PlaceGroup, p: { scale: number }, imagePx: number, boxPx: number) => (extent(g) * imagePx * p.scale) / boxPx;

    test('the slack is 5', () => assert.equal(IMAGE_SLACK, 5));

    test('a 30-em image declared 0.5 em, its strokes out to 3 image widths, is drawn at most 5 times its counted share, about its anchor', () => {
      // A brush of a 1-em cap is half an em, which is one image width at 0.5 em a width.
      const g = imageGroup(0.5, 3, 1);
      const rect: Measured = { kind: 'rect', x: 100, y: 50, w: 30 * EM, h: 300 };
      const [p] = placeGroups([g], [rect], wideBox, EM);
      const share = drawn(g, p!, rect.w, wideBox.w);
      assert.ok(share <= IMAGE_SLACK * counted(g) + 1e-9, `drawn ${share} of the box, counted ${counted(g)}`);
      assert.ok(Math.abs(share - IMAGE_SLACK * counted(g)) < 1e-9, `capped to the slack, not further: ${share}`);
      const at = bounds(g, p!, rect.w);
      assert.ok(at.x0 >= 0 && at.y0 >= 0 && at.x1 <= wideBox.w && at.y1 <= wideBox.h, JSON.stringify(at));
      // Scaled about its anchor, which is the image's middle, and so not moved.
      assert.deepEqual([p!.x, p!.y], [100 + 0.5 * rect.w, 50 + 0.5 * rect.h]);
      // On a phone, where the image is shown at the text's width, it is held the same.
      const phone = { w: 360, h: 900 };
      const [q] = placeGroups([g], [{ kind: 'rect', x: 10, y: 50, w: 338, h: 225 }], phone, EM);
      assert.ok(drawn(g, q!, 338, phone.w) <= IMAGE_SLACK * counted(g) + 1e-9, `phone: drawn ${drawn(g, q!, 338, phone.w)}`);
    });

    test('an honest image tag, its em the image\'s width in ems on the drawer\'s screen, is drawn exactly as before, there and on a phone where the image is smaller', () => {
      const g = imageGroup(30, 0.4, 0.05);
      const rect: Measured = { kind: 'rect', x: 100, y: 50, w: 30 * EM, h: 300 };
      assert.deepEqual(placeGroups([g], [rect], wideBox, EM), [{ x: 100 + 0.5 * rect.w, y: 50 + 0.5 * rect.h, scale: 1 }]);
      // A phone 360 px wide: the image at its most, the text's width, 338 px; the same image a fifth of that.
      const phone = { w: 360, h: 900 };
      for (const w of [338, 338 / 5]) {
        assert.deepEqual(placeGroups([g], [{ kind: 'rect', x: 10, y: 50, w, h: w * 0.6 }], phone, EM), [{ x: 10 + 0.5 * w, y: 50 + 0.3 * w, scale: 1 }], `${w}px`);
      }
    });

    test('a text group is never capped: its count is in ems of the text, as it is drawn', () => {
      const g = group({ anchor: textAt(), wide: 20, frame: { w: 65.8, h: 40 } });
      assert.equal(placeGroups([g], [{ kind: 'point', x: 50, y: 50 }], { w: 360, h: 600 }, EM)[0]!.scale, 1);
    });
  });

  test('a measured point or rect that is not finite is no measure: the group goes to its `at`', () => {
    const t = group({ at: [0.25, 0.5], anchor: textAt(2, 1) });
    const i = group({ at: [0.5, 0.25], unit: 'image', em: 8, anchor: { kind: 'image', version: 'v1', n: 0, src: 'https://a.example/i.png', nth: 0, x: 0.5, y: 0.25 }, strokes: [{ points: [[-0.1, 0], [0.1, 0]], r: 0.02 }] });
    const bad: (Measured | null)[] = [{ kind: 'point', x: NaN, y: 100 }, { kind: 'rect', x: 0, y: 0, w: Infinity, h: 80 }];
    const [pt, pi] = placeGroups([t, i], bad, box, EM);
    assert.deepEqual(pt, { x: 0.25 * box.w, y: 0.5 * box.h, scale: 1 });
    assert.equal(pi!.x, 0.5 * box.w);
    assert.equal(pi!.y, 0.25 * box.h);
    const [pn] = placeGroups([t], [{ kind: 'point', x: 100, y: Infinity }], box, EM);
    assert.deepEqual(pn, { x: 0.25 * box.w, y: 0.5 * box.h, scale: 1 });
  });
});
