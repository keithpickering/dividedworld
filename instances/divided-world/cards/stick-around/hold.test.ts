/**
 * Stick Around's pure half (screens design, section 10 as amended 2026-10-30; cards plan, Task 4).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL, TUNING, barStep, isHeld, pullDuration, pullOffset, pullingHold, pushPastEnd, releaseSide, stickAroundTakesOver,
} from './hold.ts';

const SCREEN = 800;
const viewport = { top: 0, bottom: SCREEN };

/** Runs the bar for `seconds` at 60 steps a second, the push per second given in screens. */
function run(level: number, seconds: number, screensPerSecond: number, direction = 1): number {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    level = barStep(level, { push: direction * screensPerSecond * SCREEN * dt, screen: SCREEN, presses: 0 }, dt);
  }
  return level;
}

test('a scroll that does not settle never takes over, and a settled one with the post mostly in view does', () => {
  const post = { top: 100, bottom: 500 };
  assert.equal(stickAroundTakesOver(post, viewport, false), false);
  assert.equal(stickAroundTakesOver(post, viewport, true), true);
  assert.equal(stickAroundTakesOver({ top: 700, bottom: 1100 }, viewport, true), false, 'a post peeking in is not mostly in view');
  assert.equal(stickAroundTakesOver({ top: 1000, bottom: 1400 }, viewport, true), false, 'a post off screen');
  assert.equal(stickAroundTakesOver({ top: -2000, bottom: 3000 }, viewport, true), true, 'a post taller than the screen that fills it');
});

test('the nearest seen and unescaped hold pulls; an escaped or unseen one never does', () => {
  const near = { id: 'near', span: { top: 300, bottom: 500 }, seen: true, escaped: false };
  const far = { id: 'far', span: { top: 900, bottom: 1100 }, seen: true, escaped: false };
  assert.equal(pullingHold([far, near], viewport), 'near');
  assert.equal(pullingHold([{ ...near, escaped: true }, far], viewport), 'far');
  assert.equal(pullingHold([{ ...near, seen: false }, { ...far, escaped: true }], viewport), null);
  assert.equal(pullingHold([], viewport), null);
});

test('the author and a caster are never held, and breaking free or certifying lets go', () => {
  const reader = { isAuthor: false, isCaster: false, certified: false, brokeFree: false };
  assert.equal(isHeld(reader), true);
  assert.equal(isHeld({ ...reader, isAuthor: true }), false);
  assert.equal(isHeld({ ...reader, isCaster: true }), false);
  assert.equal(isHeld({ ...reader, certified: true }), false);
  assert.equal(isHeld({ ...reader, brokeFree: true }), false);
});

test('scrolling inside a long post fills nothing until an end is reached', () => {
  let scroll = { offset: 0, max: 3000 };
  let level = 0;
  for (let i = 0; i < 50; i++) {
    const { offset, push } = pushPastEnd(scroll, 40);
    scroll = { ...scroll, offset };
    assert.equal(push, 0);
    level = barStep(level, { push, screen: SCREEN, presses: 0 }, 1 / 60);
  }
  assert.equal(level, 0);
  const atEnd = pushPastEnd({ offset: 2990, max: 3000 }, 100);
  assert.deepEqual(atEnd, { offset: 3000, push: 90 });
  assert.ok(barStep(0, { push: atEnd.push, screen: SCREEN, presses: 0 }, 0) > 0);
  assert.deepEqual(pushPastEnd({ offset: 5, max: 3000 }, -100), { offset: 0, push: -95 });
  assert.equal(pushPastEnd({ offset: 0, max: 0 }, 60).push, 60, 'a short post is at both ends at once');
  assert.equal(pushPastEnd({ offset: 0, max: 0 }, -60).push, -60);
});

test('a slow push past an end never fills the bar against the drain, and a sustained fast one does', () => {
  const breakEven = TUNING.drainPerSecond / TUNING.fillPerScreen;
  assert.ok(run(0, 60, breakEven * 0.8) < 0.05, 'a push below the break-even speed stays near empty for a minute');
  assert.equal(run(0, 10, breakEven * 3), FULL);
  assert.ok(run(0, 0.2, breakEven * 3) < FULL, 'a brief burst does not free anyone');
});

test('the bar drains to empty when input stops', () => {
  const level = run(0, 0.8, 4);
  assert.ok(level > 0.3);
  assert.equal(run(level, 5, 0), 0);
  assert.equal(barStep(0, { push: 0, screen: SCREEN, presses: 0 }, 1), 0, 'never below empty');
});

test('a release pushed down lands after the post, and one pushed up lands before it', () => {
  assert.equal(releaseSide(120), 'after');
  assert.equal(releaseSide(-120), 'before');
});

test('the BREAK FREE button fills against the same drain, and pressing slowly never frees', () => {
  const press = (level: number, every: number, seconds: number): number => {
    const dt = 1 / 60;
    let since = every;
    for (let t = 0; t < seconds; t += dt) {
      since += dt;
      const pressed = since >= every;
      if (pressed) since = 0;
      level = barStep(level, { push: 0, screen: SCREEN, presses: pressed ? 1 : 0 }, dt);
    }
    return level;
  };
  const breakEven = TUNING.fillPerPress / TUNING.drainPerSecond;
  assert.ok(press(0, breakEven * 1.3, 120) < FULL, 'pressing slowly never frees');
  assert.equal(press(0, breakEven * 0.4, 30), FULL, 'pressing fast does');
  assert.equal(barStep(0, { push: 0, screen: SCREEN, presses: 1 }, 0), TUNING.fillPerPress);
});

test('the pull starts slowly, passes the target by at most 48 px and ends exactly on it', () => {
  for (const distance of [120, 900, -900, 5000]) {
    const total = pullDuration(distance, false);
    const early = Math.abs(pullOffset(total * 0.1, distance, false));
    assert.ok(early > 0 && early < Math.abs(distance) * 0.02, 'slow at first');
    let over = 0;
    for (let ms = 0; ms <= total; ms += 4) {
      over = Math.max(over, (pullOffset(ms, distance, false) - distance) * Math.sign(distance));
    }
    assert.ok(over > 0 && over <= TUNING.pullOvershootPx, `overshoots a little (${over})`);
    assert.equal(pullOffset(total, distance, false), distance);
    assert.equal(pullOffset(total + 500, distance, false), distance);
  }
});

test('the pull takes 650 ms plus a fifth of a millisecond per pixel, at most 1300 ms', () => {
  assert.equal(pullDuration(0, false), 650);
  assert.equal(pullDuration(1000, false), 850);
  assert.equal(pullDuration(-1000, false), 850);
  assert.equal(pullDuration(100000, false), 1300);
});

test('with reduced motion the pull lands at once, and still happens', () => {
  assert.equal(pullDuration(900, true), 0);
  assert.equal(pullOffset(0, 900, true), 900);
});
