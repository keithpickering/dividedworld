import { describe, expect, test } from 'vitest';
import { placePopover, type Box } from './place.ts';

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, right: left + width, bottom: top + height });
/* A 1000x500 window whose HUD starts at y=450, a popover 300 wide and 200 tall, and a 4px gap and margin. */
const base = { viewport: { width: 1000, height: 500 }, hudTop: 450, size: { width: 300, height: 200 }, container: box(20, 80, 900, 40) };

describe('placing the desktop popover', () => {
  test('goes below the button when it fits above the HUD', () => {
    const p = placePopover({ ...base, button: box(20, 80, 60, 20) });
    expect(p).toMatchObject({ side: 'below', top: 100 + 4 - 80, left: 0, maxHeight: null });
  });

  test('goes above the button when below would run under the HUD', () => {
    const p = placePopover({ ...base, container: box(20, 380, 900, 40), button: box(20, 400, 60, 20) });
    expect(p).toMatchObject({ side: 'above', top: 400 - 4 - 200 - 380, maxHeight: null });
  });

  test('takes the roomier side and scrolls when neither fits', () => {
    const p = placePopover({ ...base, hudTop: 300, size: { width: 300, height: 400 }, container: box(20, 200, 900, 40), button: box(20, 200, 60, 20) });
    expect(p.side).toBe('above');
    expect(p.maxHeight).toBe(200 - 4 - 4);
    expect(200 + p.top).toBe(4); // its top edge is the margin below the viewport's top
  });

  test('is kept inside the window when its button has scrolled out of it, above or below', () => {
    const up = placePopover({ ...base, container: box(20, 0, 900, 40), button: box(20, -300, 60, 20) });
    expect(up.side).toBe('below');
    expect(0 + up.top).toBe(4);
    const down = placePopover({ ...base, hudTop: 500, container: box(20, 0, 900, 40), button: box(20, 900, 60, 20) });
    expect(down.side).toBe('above');
    expect(0 + down.top + 200).toBe(500 - 4);
  });

  test('is pulled back inside the right edge', () => {
    const p = placePopover({ ...base, container: box(900, 80, 80, 40), button: box(900, 80, 60, 20) });
    expect(900 + p.left + 300).toBe(1000 - 4);
  });

  test('is pulled back inside the left edge, and narrowed when the window is narrower than it', () => {
    expect(placePopover({ ...base, container: box(-10, 80, 900, 40), button: box(-10, 80, 60, 20) }).left).toBe(4 + 10);
    const narrow = placePopover({ ...base, viewport: { width: 200, height: 500 }, button: box(20, 80, 60, 20) });
    expect(narrow.maxWidth).toBe(200 - 8);
  });
});
