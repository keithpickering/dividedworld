import { afterEach, describe, expect, it } from 'vitest';
import { hudTabRect, publishHudTab, resetHudTabForTests } from './hud-tab.ts';

const within = { width: 1000, height: 700 };
const box = (x: number) => ({ x, y: 600, width: 120, height: 40 });

describe('the HUD tab\'s rect', () => {
  afterEach(resetHudTabForTests);

  it('is the box the published reader reads now', () => {
    let at = 10;
    publishHudTab(() => box(at));
    expect(hudTabRect(within)).toEqual(box(10));
    at = 50;
    expect(hudTabRect(within)).toEqual(box(50));
  });

  it('keeps the last box read after the HUD unmounts', () => {
    const withdraw = publishHudTab(() => box(30));
    withdraw();
    expect(hudTabRect(within)).toEqual(box(30));
  });

  it('keeps the box a reader gave when it was withdrawn, even if it was never asked before', () => {
    let at = 5;
    const withdraw = publishHudTab(() => box(at));
    at = 77;
    withdraw();
    expect(hudTabRect(within)).toEqual(box(77));
  });

  it('is the middle of the window\'s foot where no HUD was ever mounted (a signed-out first load)', () => {
    expect(hudTabRect(within)).toEqual({ x: 400, y: 628, width: 200, height: 56 });
  });

  it('is not replaced by an older reader\'s withdrawal', () => {
    const first = publishHudTab(() => box(1));
    publishHudTab(() => box(2));
    first();
    expect(hudTabRect(within)).toEqual(box(2));
  });
});
