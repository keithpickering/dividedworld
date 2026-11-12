import { expect, test } from '@playwright/test';

/**
 * A card's type is said by its frame, and every type's frame has one outline (docs/plans/2026-11-12-card-frame-outline.md): a Cast's
 * solid ring, a Set's double ring and a Use's dashed ring all end on the same outer edge, with the same corner, so three cards of one
 * size side by side are one size to the eye. Read in the browser from what is drawn, on the Vending Machine's moment, whose slots hold every type:
 * each card's outermost line (its own ring, or its ::before's border or ring), how far that line reaches past the card's box, and
 * the radius of that line's outer corner. What makes each type its own is inside that edge: a Use's line is dashed and it has no
 * solid ring, and a Set's second line is inside the card's box.
 */
test.use({ bypassCSP: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

interface Frame {
  readonly play: string;
  readonly size: string;
  /** How far the outermost drawn line reaches past the card's box, in px. */
  readonly reach: number;
  /** The radius of that line's outer corner, in px. */
  readonly corner: number;
  /** Whether the card's own solid ring is drawn. */
  readonly solid: boolean;
  /** The ::before's border style, and where its box starts from the card's edge (negative is outside). */
  readonly beforeStyle: string;
  readonly beforeInset: number | null;
  /** Where the canvas starts from the card's edge: the border's width. */
  readonly canvas: number;
}

test('every card type has the same outline at a size, and its own line inside it', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=07-vending');
  await expect(page.locator('.kb-postcard[data-kb-play]').first()).toBeVisible({ timeout: 10_000 });

  const frames = await page.locator('.kb-postcard[data-kb-play]').evaluateAll((cards): Frame[] => {
    /** A ring is a shadow with no offset and no blur: its spread and whether it is painted. The computed form is `color x y blur spread`. */
    const ring = (shadow: string): { spread: number; painted: boolean } | null => {
      for (const part of shadow.split(/,(?![^(]*\))/u)) {
        const m = /^\s*(rgba?\([^)]*\)|color\([^)]*\)|[a-z]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s*$/u.exec(part);
        if (!m || part.includes('inset')) continue;
        if (Number(m[2]) !== 0 || Number(m[3]) !== 0 || Number(m[4]) !== 0) continue;
        const painted = !/rgba\([^)]*,\s*0\)$/u.test(m[1]!) && m[1] !== 'transparent';
        return { spread: Number(m[5]), painted };
      }
      return null;
    };
    return cards.map((card) => {
      const own = getComputedStyle(card);
      const before = getComputedStyle(card, '::before');
      const radius = parseFloat(own.borderTopLeftRadius);
      const lines: { reach: number; corner: number }[] = [];
      const ownRing = ring(own.boxShadow);
      const solid = ownRing !== null && ownRing.painted && ownRing.spread > 0;
      if (solid) lines.push({ reach: ownRing.spread, corner: radius + ownRing.spread });
      const drawn = before.content !== 'none';
      const inset = drawn ? parseFloat(before.top) : null;
      if (drawn && inset !== null) {
        const beforeRadius = parseFloat(before.borderTopLeftRadius);
        const beforeRing = ring(before.boxShadow);
        if (before.borderTopStyle !== 'none' && parseFloat(before.borderTopWidth) > 0) lines.push({ reach: -inset, corner: beforeRadius });
        if (beforeRing && beforeRing.painted && beforeRing.spread > 0) lines.push({ reach: beforeRing.spread - inset, corner: beforeRadius + beforeRing.spread });
      }
      const outer = lines.reduce((a, b) => (b.reach > a.reach ? b : a), { reach: 0, corner: radius });
      return {
        play: card.getAttribute('data-kb-play') ?? '',
        size: card.getAttribute('data-size') ?? '',
        reach: outer.reach,
        corner: outer.corner,
        solid,
        beforeStyle: drawn ? before.borderTopStyle : 'none',
        beforeInset: inset,
        canvas: parseFloat(getComputedStyle(card.querySelector('.kb-postcard-canvas')!).top),
      };
    });
  });

  const slots = frames.filter((f) => f.size === 'slot');
  expect([...new Set(slots.map((f) => f.play))].sort(), 'the machine\'s slots hold a card of every type').toEqual(['cast', 'set', 'use']);

  const cast = slots.find((f) => f.play === 'cast')!;
  expect(cast.reach, 'a Cast has a ring').toBeGreaterThan(0);
  for (const frame of slots) {
    expect(frame.reach, `a ${frame.play}'s outline reaches as far as a Cast's`).toBeCloseTo(cast.reach, 2);
    expect(frame.corner, `a ${frame.play}'s outline has a Cast's corner`).toBeCloseTo(cast.corner, 2);
  }

  const use = slots.find((f) => f.play === 'use')!;
  expect(use.beforeStyle, 'a Use is dashed').toBe('dashed');
  expect(use.solid, 'a Use has no solid ring under its dashes').toBe(false);
  const set = slots.find((f) => f.play === 'set')!;
  expect(set.solid, 'a Set keeps the solid ring').toBe(true);
  /* The second line is a ring drawn outward from its box, so the box's edge is the line's inner edge: a gap and a ring in from the outline, and before the canvas. */
  expect(set.beforeInset, 'a Set\'s second line is inside the card, a gap in from its outline').toBeGreaterThanOrEqual(3);
  expect(set.beforeInset, 'and ends on the card\'s border, before the canvas').toBeLessThan(set.canvas);
});

test.describe('under forced colors', () => {
  test.use({ forcedColors: 'active' });

  /* Shadows are dropped there, so a Set's second line is a border: it stays where the shadow drew it, inside the card's border and clear of the canvas. */
  test('a Set\'s second line stays on the card\'s border', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=07-vending');
    const set = page.locator(".kb-postcard[data-kb-play='set']").first();
    await expect(set).toBeVisible({ timeout: 10_000 });
    const line = await set.evaluate((card) => {
      const before = getComputedStyle(card, '::before');
      const canvas = card.querySelector('.kb-postcard-canvas')!;
      return {
        style: before.borderTopStyle,
        from: parseFloat(before.top),
        to: parseFloat(before.top) + parseFloat(before.borderTopWidth),
        /* Both from computed style, in the card's own lengths: the machine draws its slots scaled, which a measured box would carry and these do not. */
        canvas: parseFloat(getComputedStyle(canvas).top),
      };
    });
    expect(line.style, 'the second line is a border').toBe('solid');
    expect(line.from, 'a gap inside the outline').toBeGreaterThanOrEqual(1.5);
    expect(line.to, 'the line ends before the canvas').toBeLessThan(line.canvas);
  });
});
