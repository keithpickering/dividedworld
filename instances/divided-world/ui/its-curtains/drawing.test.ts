/**
 * The curtain's drawing, as numbers (the plan's Task 6): a row of swags whose beads sit evenly along the trim, a larger bead where two swags meet, the
 * fabric's lag as keyframes that are a pure function of the pleat and the open, and where a spotlight is at a moment of its lap.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fabricFrames, NOISE_URI, spotPose, swagArt } from './drawing.ts';
import { TUNING } from './tuning.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

describe('the swags', () => {
  const art = swagArt(600, TUNING.shape.swags, TUNING.shape.swagHeightPx);

  test('one shape and one trim span the width, and the art is as wide as the box', () => {
    assert.equal(art.width, 600);
    assert.ok(art.shape.startsWith('M0 0H100'));
    assert.equal(art.shape.match(/M/gu)?.length, TUNING.shape.swags);
    assert.equal(art.trim.match(/M/gu)?.length, TUNING.shape.swags);
  });

  test('the beads are evenly spaced along each swag\'s trim, with a larger bead where two swags meet', () => {
    const swag = swagArt(100, 1, 64);
    const small = swag.beads[0]!.r;
    const along = swag.beads.filter((b) => b.r === small);
    const gaps = along.slice(1).map((b, i) => Math.hypot(b.x - along[i]!.x, b.y - along[i]!.y));
    assert.ok(gaps.length > 3);
    assert.ok(Math.max(...gaps) - Math.min(...gaps) < Math.min(...gaps) * 0.25);
    const junction = art.beads.filter((b) => b.r > art.beads[0]!.r);
    assert.equal(junction.length, TUNING.shape.swags + 1);
    assert.equal(art.specks.length, art.beads.length);
  });
});

describe('the fabric\'s lag', () => {
  const frames = (i = 0) => fabricFrames(i, 6, 306, 200, 500, 0.6, -1, TUNING.openEase);

  test('is the same keyframes for the same pleat, and starts and ends at rest', () => {
    assert.deepEqual(frames(), frames());
    const f = frames();
    assert.ok(f.length > 10);
    assert.equal(f[0]!.offset, 0);
    assert.equal(f.at(-1)!.offset, 1);
    assert.match(f[0]!.transform, /^translateX\(-?0\.00px\) skewX\(-?0\.000deg\) scaleX\(1\.0000\)$/u);
    assert.match(f.at(-1)!.transform, /^translateX\(-?0\.00px\) skewX\(-?[\d.]+deg\) scaleX\(1\.0000\)$/u);
  });

  test('bunches the middle of the open and differs from one pleat to the next', () => {
    assert.notDeepEqual(frames(0), frames(3));
    assert.notEqual(frames(3)[15]!.transform, frames(3)[0]!.transform);
  });

  test('no lag is no keyframes', () => {
    assert.deepEqual(fabricFrames(0, 6, 306, 200, 500, 0, -1, TUNING.openEase), []);
  });
});

describe('the spotlights', () => {
  const box = { w: 600, h: 300, top: 0, span: 300 };

  test('at rest the two sit still and dim, either side of the middle', () => {
    const a = spotPose(0, 0, box, 0, 0), b = spotPose(0, 1, box, 0, 0);
    close(a.x, 600 * TUNING.spot.restLeft);
    close(b.x, 600 * TUNING.spot.restRight);
    close(a.opacity, TUNING.spot.rest);
    assert.deepEqual(spotPose(2, 0, box, 0, 0), a);
  });

  test('while the drumroll plays they brighten and trace a figure 8, out of phase with each other', () => {
    const lit = spotPose(1, 0, box, 1, 1);
    close(lit.opacity, TUNING.spot.bright);
    assert.ok(Math.abs(spotPose(1, 1, box, 1, 1).x - lit.x) > 1e-3);
    assert.ok(Math.abs(spotPose(2, 0, box, 1, 1).x - lit.x) > 1e-3);
    /* a whole lap later, it is back where it was */
    close(spotPose(1 + 2 * Math.PI, 0, box, 1, 1).x, lit.x);
  });

  test('stands still but still brightens when it cannot move (reduced motion)', () => {
    const still = spotPose(1, 0, box, 1, 0);
    close(still.x, 600 * TUNING.spot.restLeft);
    close(still.opacity, TUNING.spot.bright);
  });
});

describe('the velvet', () => {
  test('is one generated tile that paints with plain alpha, as no effect may blend', () => {
    assert.ok(NOISE_URI.startsWith('data:image/svg+xml,'), 'it is an SVG data URI');
    assert.ok(decodeURIComponent(NOISE_URI).includes('feTurbulence'));
  });
});
