/**
 * Stick Around's pure half (screens design, section 10 as amended 2026-10-30; cards plan, Task 4).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL, TUNING, barStep, countPresses, isHeld, pullDuration, pullOffset, pullingHold, pushPastEnd, releaseSide, stickAroundTakesOver,
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
  assert.ok(barStep(0, { push: atEnd.push, screen: SCREEN, presses: 0 }, 1 / 60) > 0);
  assert.deepEqual(pushPastEnd({ offset: 5, max: 3000 }, -100), { offset: 0, push: -95 });
  assert.equal(pushPastEnd({ offset: 0, max: 0 }, 60).push, 60, 'a short post is at both ends at once');
  assert.equal(pushPastEnd({ offset: 0, max: 0 }, -60).push, -60);
  assert.deepEqual(pushPastEnd({ offset: 0, max: -5 }, 60), { offset: 0, push: 60 }, 'a negative max is a post that fits');
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

/** Seconds of sustained input until the bar is full, stepping at 60 a second; Infinity if it never fills in 30 s. */
function secondsToFull(input: (t: number, dt: number) => { push: number; presses: number }): number {
  const dt = 1 / 60;
  let level = 0;
  for (let i = 1; i <= 1800; i++) {
    const { push, presses } = input(i * dt, dt);
    level = barStep(level, { push, screen: SCREEN, presses }, dt);
    if (level >= FULL) return i * dt;
  }
  return Infinity;
}

/** A key held down: presses at `hz`, counted the way the effect counts them, step by step. */
function pressingAt(hz: number): (t: number, dt: number) => { push: number; presses: number } {
  let next = 0;
  let last = -Infinity;
  return (t) => {
    const times: number[] = [];
    while (next / hz <= t) times.push((next++ / hz) * 1000);
    const counted = countPresses(times, last);
    last = counted.lastCountedMs;
    return { push: 0, presses: counted.counted };
  };
}

test('one big push cannot fill the bar: only a sustained burst frees the reader', () => {
  const dt = 0.016;
  assert.ok(barStep(0, { push: 5 * SCREEN, screen: SCREEN, presses: 0 }, dt) < 0.05, 'a five-screen wheel jump in one step');
  assert.ok(barStep(0.5, { push: 50 * SCREEN, screen: SCREEN, presses: 0 }, dt) < 0.6, 'however far it jumps');
  assert.ok(run(0, 0.5, 10) < FULL, 'half a second of hard scrolling is not enough');
  assert.equal(run(0, 1.2, 10), FULL, 'a second or more of it is');
  const seconds = secondsToFull((_, dt) => ({ push: 10 * SCREEN * dt, presses: 0 }));
  assert.ok(seconds >= 0.9, `filling takes about a second at least (${seconds})`);
});

test('a release pushed down lands after the post, and one pushed up lands before it', () => {
  assert.equal(releaseSide(120), 'after');
  assert.equal(releaseSide(-120), 'before');
});

test('pushing up past the start fills the bar exactly as pushing down past the end does, and releases before the post', () => {
  for (const [seconds, speed] of [[0.4, 10], [1.2, 10], [2, 3], [60, 1]] as const) {
    assert.equal(run(0, seconds, speed, -1), run(0, seconds, speed, 1));
  }
  const up = pushPastEnd({ offset: 0, max: 3000 }, -300);
  assert.equal(up.push, -300);
  assert.equal(barStep(0, { push: up.push, screen: SCREEN, presses: 0 }, 1 / 60), barStep(0, { push: 300, screen: SCREEN, presses: 0 }, 1 / 60));
  assert.equal(releaseSide(up.push), 'before');
});

test('input that is not a number never corrupts the bar: the bar always has a way down', () => {
  const idle = { push: 0, screen: SCREEN, presses: 0 };
  const dt = 1 / 60;
  const base = barStep(0.5, idle, dt);
  assert.equal(barStep(0.5, idle, NaN), 0.5, 'a NaN dt is no time');
  assert.equal(barStep(0.5, idle, -3), 0.5, 'a negative dt is no time');
  assert.equal(barStep(0.5, idle, Infinity), 0.5, 'an infinite dt is no time');
  assert.equal(barStep(0.5, { ...idle, push: NaN }, dt), base, 'a NaN push is no push');
  const capped = barStep(0, { ...idle, push: 1e9 }, dt);
  assert.equal(barStep(0, { ...idle, push: Infinity }, dt), capped, 'an infinite push counts as the cap');
  assert.equal(barStep(0, { ...idle, push: -Infinity }, dt), capped);
  assert.ok(capped < FULL && capped > 0);
  assert.equal(barStep(0.5, { ...idle, presses: NaN }, dt), base, 'NaN presses are none');
  assert.equal(barStep(0.5, { ...idle, presses: -4 }, dt), base, 'negative presses are none');
  assert.equal(barStep(NaN, idle, dt), 0, 'a NaN level is empty');
  assert.equal(barStep(NaN, { ...idle, push: 5 * SCREEN }, dt), barStep(0, { ...idle, push: 5 * SCREEN }, dt));
  assert.equal(barStep(7, idle, 0), FULL, 'a level above full is clamped');
  assert.equal(barStep(-3, idle, 0), 0, 'a level below empty is clamped');
  for (const screen of [0, -800, NaN, Infinity]) {
    assert.equal(barStep(0.5, { push: 5 * SCREEN, screen, presses: 0 }, dt), base, `a screen of ${screen} counts as no push`);
  }
  assert.ok(Number.isFinite(barStep(NaN, { push: NaN, screen: NaN, presses: NaN }, NaN)));
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
  const one = barStep(0, { push: 0, screen: SCREEN, presses: 1 }, 1 / 60);
  assert.ok(Math.abs(one - (TUNING.fillPerPress - TUNING.drainPerSecond / 60)) < 1e-12);
  assert.equal(barStep(0, { push: 0, screen: SCREEN, presses: 1 }, 0), 0, 'with no time passed no press counts');
  assert.ok(barStep(0, { push: 0, screen: SCREEN, presses: 1000 }, 1 / 60) <= TUNING.fillPerPress, 'a step counts at most one press per gap');
});

test('presses closer than the minimum gap count once, so a held key does not out-fill scrolling', () => {
  assert.deepEqual(countPresses([0, 10, 20, 119], -Infinity), { counted: 1, lastCountedMs: 0 });
  assert.deepEqual(countPresses([0, 120, 240], -Infinity), { counted: 3, lastCountedMs: 240 });
  assert.deepEqual(countPresses([50], 0), { counted: 0, lastCountedMs: 0 }, 'the gap runs across steps');
  assert.deepEqual(countPresses([130], 0), { counted: 1, lastCountedMs: 130 });
  assert.deepEqual(countPresses([], 40), { counted: 0, lastCountedMs: 40 });
  assert.deepEqual(countPresses([NaN, Infinity, 5], -Infinity), { counted: 1, lastCountedMs: 5 }, 'a time that is not finite is no press');
  const held = secondsToFull(pressingAt(30));
  const tapped = secondsToFull(pressingAt(8));
  assert.ok(held >= tapped - 1e-9, `30 presses a second is no faster than 8 (${held} against ${tapped})`);
  const scrolled = secondsToFull((_, dt) => ({ push: 10 * SCREEN * dt, presses: 0 }));
  assert.ok(held >= scrolled * 0.8 && held <= scrolled * 2, `pressing fills in about the time fast scrolling does (${held} against ${scrolled})`);
  assert.equal(secondsToFull(pressingAt(2)), Infinity, 'slow pressing never frees');
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
    const firstLobe = pullOffset(total * (TUNING.pullEaseShare + (1 - TUNING.pullEaseShare) * 0.15), distance, false);
    assert.ok((firstLobe - distance) * Math.sign(distance) > 0, 'the first lobe goes past the target in the pull\'s direction');
    if (distance < 0) assert.ok(firstLobe < distance, 'a pull up overshoots above the target');
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

test('a pull before it starts is at zero, and a distance that is not a number is no pull', () => {
  assert.equal(pullOffset(-5, 900, false), 0);
  assert.equal(pullOffset(0, 900, false), 0);
  assert.equal(pullOffset(300, NaN, false), 0);
  assert.equal(pullOffset(NaN, 900, false), 0);
  assert.equal(pullDuration(NaN, false), 650);
  assert.equal(pullOffset(2000, NaN, false), 0);
});

test('with reduced motion the pull lands at once, and still happens', () => {
  assert.equal(pullDuration(900, true), 0);
  assert.equal(pullOffset(0, 900, true), 900);
});
