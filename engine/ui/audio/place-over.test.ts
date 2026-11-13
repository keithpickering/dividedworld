import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { placeOver } from './place-over.ts';

const MAIN = { width: 1280 };
const PHONE = { width: 390 };
/* An overlay that starts at the window's top. */
const TOP = { top: 0 };
/* The bar at rest: 30px tall, 10px above the HUD's seam. */
const rest = (view: { width: number }, bottom: number) => ({ left: view.width / 2 - 100, right: view.width / 2 + 100, top: bottom - 30, bottom });

describe('where a caption stands over a dialog', () => {
  test('with no dialog open there is nothing to stand over', () => {
    assert.equal(placeOver(rest(MAIN, 760), [], TOP), null);
  });

  test('a dialog clear of the bar leaves it where it rests, raised', () => {
    const box = { left: 400, top: 100, right: 880, bottom: 600 };
    assert.deepEqual(placeOver(rest(MAIN, 760), [box], TOP), { lift: 0 });
  });

  test('a box beside the bar, in the same rows, does not meet it', () => {
    const box = { left: 0, top: 700, right: 400, bottom: 790 };
    assert.deepEqual(placeOver(rest(MAIN, 760), [box], TOP), { lift: 0 });
  });

  test('a sheet that meets the bar lifts it to rest 10px above the sheet\'s top', () => {
    const sheet = { left: 0, top: 400, right: PHONE.width, bottom: 780 };
    assert.deepEqual(placeOver(rest(PHONE, 765), [sheet], TOP), { lift: 375 });
  });

  test('a lift that lands on a second box goes on above that one', () => {
    const low = { left: 0, top: 500, right: PHONE.width, bottom: 780 };
    const high = { left: 0, top: 300, right: PHONE.width, bottom: 480 };
    assert.deepEqual(placeOver(rest(PHONE, 765), [low, high], TOP), { lift: 475 });
  });

  test('a box with no room above it inside the window cannot be cleared', () => {
    const tall = { left: 0, top: 20, right: PHONE.width, bottom: 780 };
    assert.equal(placeOver(rest(PHONE, 765), [tall], TOP), null);
  });

  test('a lift that would climb over the chrome above the overlay is no room: the overlay starts 60px down', () => {
    const sheet = { left: 0, top: 80, right: PHONE.width, bottom: 780 };
    assert.equal(placeOver(rest(PHONE, 765), [sheet], { top: 60 }), null);
  });

  test('a lift that lands exactly at the overlay\'s top is room', () => {
    const sheet = { left: 0, top: 100, right: PHONE.width, bottom: 780 };
    assert.deepEqual(placeOver(rest(PHONE, 765), [sheet], { top: 60 }), { lift: 675 });
  });
});
