/**
 * moves.mjs's motion blur and whip: the camera is sampled at four sub-frame times across the shutter and the four are averaged
 * (revision design, section 11), and a whip is a fast pan out of one shot and into the next. Pure arithmetic; the ffmpeg render of both is
 * checked by hand against a real take (the commit says how).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBFRAMES, SHUTTER, subframes, blurRects, blurStatic, expressions, corners, cutRect, WHIP_FRAMES, whipDirections, whipProgress, whipPositions, whipExpressions, parseWhip } from './moves.mjs';

const near = (/** @type {number} */ a, /** @type {number} */ b, /** @type {string} */ what = '') => assert.ok(Math.abs(a - b) < 1e-9, `${what} ${a} is not ${b}`);
const move = { from: { x: 0, y: 0, w: 1, roll: 0 }, to: { x: 0.3, y: 0.1, w: 0.6, roll: 5 }, ease: 'linear' };

/* The expressions are JavaScript but for `if`, `st` and `ld` and the `;`; the tests supply them. */
const evaluate = (/** @type {string} */ source, /** @type {Record<string, number>} */ vars) => {
  const reg = [0, 0, 0, 0, 0];
  const body = `(${source.replace(/\bif\(/gu, 'if_(').replace(/\bst\(/gu, 'st_(').replace(/\bld\(/gu, 'ld_(').replace(/;/gu, ',')})`;
  const names = Object.keys(vars);
  return new Function(...names, 'PI', 'if_', 'gte', 'lt', 'min', 'max', 'cos', 'sin', 'floor', 'mod', 'st_', 'ld_', `return ${body};`)(
    ...names.map((k) => vars[k]), Math.PI, (/** @type {number} */ c, /** @type {number} */ a, /** @type {number} */ b) => (c ? a : b),
    (/** @type {number} */ a, /** @type {number} */ b) => +(a >= b), (/** @type {number} */ a, /** @type {number} */ b) => +(a < b),
    Math.min, Math.max, Math.cos, Math.sin, Math.floor, (/** @type {number} */ a, /** @type {number} */ b) => a % b,
    (/** @type {number} */ i, /** @type {number} */ v) => (reg[i] = v), (/** @type {number} */ i) => reg[i],
  );
};

test('an output frame is four sub-frame camera positions across the shutter, centered on the frame', () => {
  assert.equal(SUBFRAMES, 4);
  assert.equal(SHUTTER, 0.5, 'a 180 degree shutter: half the frame interval');
  for (const i of [0, 7, 100]) {
    const p = subframes(i);
    assert.equal(p.length, 4);
    near(p.reduce((a, b) => a + b, 0) / 4, i, `the average of frame ${i}'s four positions is the frame`);
    near(p[3] - p[0], SHUTTER * 0.75, 'spread over the shutter: three quarters of it between the first and the last of four');
    for (let k = 1; k < 4; k++) assert.ok(p[k] > p[k - 1], 'in order');
  }
  near(subframes(10, 4, 1)[3] - subframes(10, 4, 1)[0], 0.75, 'a 360 degree shutter spreads them across the whole frame');
});

test('a move is blurred by the rectangles of its sub-frames: they differ along the move and agree where the camera is still', () => {
  const cut = { frames: 61, move };
  assert.equal(blurRects({ frames: 30, punch: 10 }, 0)[0].w, cutRect({ frames: 30, punch: 10 }, 0).w, 'the camera is not read before a cut begins: a punch on the first frame is whole in every sub-frame');
  const rects = blurRects(cut, 30);
  assert.equal(rects.length, 4);
  assert.ok(rects[3].x > rects[0].x, 'the camera is moving: the first and last sub-frames differ');
  near(rects[0].x, cutRect(cut, subframes(30)[0]).x, 'each sub-frame is the cut`s rectangle at that time');
  assert.equal(blurStatic(cut, 30), false);
  /* a still cut, a move held at its end, and an ease that rests at its start are all static: the average of four equal frames is the frame */
  assert.equal(blurStatic({ frames: 61 }, 30), true, 'no move at all');
  assert.equal(blurStatic({ frames: 61, move: { from: move.to, to: move.to } }, 60), true, 'a camera that goes nowhere');
  assert.equal(blurStatic({ frames: 61, move: { ...move, ease: 'inOut' } }, 0), false, 'an eased move`s first frame still has the later sub-frames in motion');
  assert.equal(blurStatic({ frames: 61, move: { ...move, ease: 'inOut', from: move.to, to: move.to } }, 12), true, 'a move from a place to the same place');
  assert.equal(blurStatic({ frames: 30, punch: 10 }, 20), true, 'a punch is over after eight frames');
  assert.equal(blurStatic({ frames: 30, punch: 10 }, 3), false, 'and moving while it eases back');
});

test('the sub-frame expressions (ffmpeg\'s, on a stream at four times the frame rate) are the rectangles of blurRects, every sub-frame of every frame', () => {
  const cuts = [{ frames: 40, move: { ...move, ease: 'inOut' }, punch: 12 }, { frames: 25, move }, { frames: 30, punches: [{ frame: 5, percent: 8 }] }];
  for (const cut of cuts) {
    const e = expressions(cut, 'sub');
    for (let i = 0; i < cut.frames; i++) {
      const rects = blurRects(cut, i);
      for (let s = 0; s < 4; s++) {
        const on = 4 * i + s, r = rects[s];
        near(evaluate(e.w, { on }), r.w, `w of frame ${i} sub ${s}`);
        near(evaluate(e.cx, { on }) - evaluate(e.w, { on }) / 2, r.x, `x of frame ${i} sub ${s}`);
        near(evaluate(e.cy, { on }) - evaluate(e.w, { on }) / 2, r.y, `y of frame ${i} sub ${s}`);
        near(evaluate(e.roll, { on }), (r.roll * Math.PI) / 180, `roll of frame ${i} sub ${s}`);
      }
    }
    assert.match(corners(cut, 1920, 1080, 'sub').x0, /floor\(on\/4\)/, 'the corners take the sub-frame clock too');
  }
});

test('a still cut blurred is the cut: the four sub-frames of every frame are the same rectangle', () => {
  const e = expressions({ frames: 30 }, 'sub');
  for (const on of [0, 1, 2, 3, 40, 119]) { near(evaluate(e.w, { on }), 1); near(evaluate(e.cx, { on }), 0.5); }
});

test('a whip is declared as whip-left, -right, -up or -down, with its length in frames (6 by default)', () => {
  assert.equal(WHIP_FRAMES, 6);
  assert.deepEqual(parseWhip('whip-left'), { dir: 'left', frames: 6 });
  assert.deepEqual(parseWhip('whip-down', 10), { dir: 'down', frames: 10 });
  assert.equal(parseWhip(undefined), null, 'a plain cut');
  assert.equal(parseWhip('cut'), null);
  assert.throws(() => parseWhip('whip-sideways'), /whip-sideways.*left, right, up or down/);
  assert.throws(() => parseWhip('whip-left', 3), /even/, 'half of it leaves the outgoing shot, half enters the incoming');
  assert.throws(() => parseWhip('whip-left', 2), /4 frames|at least/, 'too short to blur');
  assert.deepEqual(Object.keys(whipDirections).sort(), ['down', 'left', 'right', 'up']);
});

test('a whip pans the outgoing shot off and the incoming shot on: A leaves in the direction the camera turns from, B arrives from the other side', () => {
  /* whip-left: the camera turns left, so the picture slides right: A goes off to the right and B comes in from the left. */
  const at = (/** @type {number} */ s) => whipPositions('left', s, 1920, 1080);
  assert.deepEqual(at(0), { a: { x: 0, y: 0 }, b: { x: -1920, y: 0 } }, 'at the start A fills the frame and B waits off to the left');
  assert.deepEqual(at(1), { a: { x: 1920, y: 0 }, b: { x: 0, y: 0 } }, 'at the end B fills the frame and A is off to the right');
  assert.deepEqual(at(0.5), { a: { x: 960, y: 0 }, b: { x: -960, y: 0 } });
  assert.deepEqual(whipPositions('right', 1, 1920, 1080).a, { x: -1920, y: 0 });
  assert.deepEqual(whipPositions('up', 1, 1920, 1080).a, { x: 0, y: 1080 });
  assert.deepEqual(whipPositions('down', 1, 1920, 1080).b, { x: 0, y: 0 });
  assert.deepEqual(whipPositions('down', 0, 1920, 1080).b, { x: 0, y: 1080 });
});

test('the whip eases in and out, and its blur is the camera`s: the progress at a frame`s sub-frames spreads most where it is fastest', () => {
  near(whipProgress(-5, 6), 0, 'before the first frame: still A');
  near(whipProgress(50, 6), 1, 'after the last: B');
  const speed = (/** @type {number} */ i) => { const p = subframes(i).map((t) => whipProgress(t, 6)); return p[3] - p[0]; };
  assert.ok(speed(2) > speed(0) * 3 && speed(3) > speed(5) * 3, 'much faster mid-whip than at its ends');
  assert.ok(whipProgress(0, 6) < whipProgress(1, 6) && whipProgress(4, 6) < whipProgress(5, 6));
  near(whipProgress(2.5, 6), 0.5, 'half way at the middle of the six frames');
});

test('the whip`s expressions (overlay, on the 240 fps clock) are whipPositions at the sub-frame progress', () => {
  for (const dir of Object.keys(whipDirections)) {
    const e = whipExpressions(dir, 6, 1920, 1080);
    for (let i = 0; i < 6; i++) for (let s = 0; s < 4; s++) {
      const n = 4 * i + s, p = whipPositions(dir, whipProgress(subframes(i)[s], 6), 1920, 1080);
      near(evaluate(e.ax, { n }), p.a.x, `${dir} a.x at ${i}.${s}`);
      near(evaluate(e.ay, { n }), p.a.y, `${dir} a.y`);
      near(evaluate(e.bx, { n }), p.b.x, `${dir} b.x`);
      near(evaluate(e.by, { n }), p.b.y, `${dir} b.y`);
    }
  }
});
