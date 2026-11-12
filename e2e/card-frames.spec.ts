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

/**
 * Two states that restyle a card's shadow, read on the machine's own cards with the state put on them (the stylesheets are the
 * page's; only the attribute and the wrapper are the test's): armed, and a pack's hit pull. Each keeps the type's frame as it is
 * drawn. Motion is reduced for the whole file, so the armed card is read at rest.
 */
interface Drawn {
  /** The card's own ring: its width, its color, and whether it is painted at all. */
  readonly ring: number | null;
  readonly ringColor: string;
  readonly ringPainted: boolean;
  /** Whether the card's shadow has a part with blur: its glow. */
  readonly glow: boolean;
  readonly beforeStyle: string;
  readonly beforeBorderColor: string;
  readonly beforeShadowColor: string;
}

/** What one card draws, read from computed style in the page. */
function drawn(card: Element): Drawn {
  const parts = (shadow: string) => shadow === 'none' ? [] : shadow.split(/,(?![^(]*\))/u).map((part) => {
    const m = /^\s*(rgba?\([^)]*\)|color\([^)]*\)|[a-z]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s*$/u.exec(part);
    return m ? { color: m[1]!, x: Number(m[2]), y: Number(m[3]), blur: Number(m[4]), spread: Number(m[5]) } : null;
  }).filter((p) => p !== null);
  const clear = (color: string) => /rgba\([^)]*,\s*0\)$/u.test(color) || color === 'transparent';
  const own = parts(getComputedStyle(card).boxShadow);
  const before = getComputedStyle(card, '::before');
  const ring = own.find((p) => p.x === 0 && p.y === 0 && p.blur === 0) ?? null;
  return {
    ring: ring ? ring.spread : null,
    ringColor: ring ? ring.color : '',
    ringPainted: ring !== null && ring.spread > 0 && !clear(ring.color),
    glow: own.some((p) => p.blur > 0 && !clear(p.color)),
    beforeStyle: before.content === 'none' ? 'none' : before.borderTopStyle,
    beforeBorderColor: before.borderTopColor,
    beforeShadowColor: parts(before.boxShadow)[0]?.color ?? '',
  };
}

test('an armed card keeps its type\'s frame: the outline\'s width, and a Use still dashed with no solid ring under it', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=07-vending');
  await expect(page.locator('.kb-postcard[data-kb-play]').first()).toBeVisible({ timeout: 10_000 });
  const read = async (play: string, armed: boolean) => page.locator(`.kb-postcard[data-kb-play='${play}']`).first().evaluate((card, [fn, on]) => {
    if (on) card.setAttribute('data-armed', ''); else card.removeAttribute('data-armed');
    return (new Function(`return ${fn}`)() as (c: Element) => Drawn)(card);
  }, [drawn.toString(), armed] as const);

  const cast = await read('cast', false);
  const armedCast = await read('cast', true);
  expect(armedCast.ring, 'an armed Cast\'s ring is the outline\'s width').toBe(cast.ring);
  expect(armedCast.ringPainted).toBe(true);

  const use = await read('use', false);
  expect(use.glow, 'a Use keeps its glow').toBe(true);
  const armedUse = await read('use', true);
  expect(armedUse.beforeStyle, 'an armed Use is still dashed').toBe('dashed');
  expect(armedUse.ringPainted, 'with no solid ring under its dashes').toBe(false);
  expect(armedUse.glow, 'and the armed glow').toBe(true);
});

test('a hit pull turns the ring gold and nothing else of the frame: a Set\'s second line keeps the card\'s color, a Use\'s dashes are its ring', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=07-vending');
  await expect(page.locator('.kb-postcard[data-kb-play]').first()).toBeVisible({ timeout: 10_000 });
  const read = async (play: string) => page.locator(`.kb-postcard[data-kb-play='${play}']`).first().evaluate((card, fn) => {
    /* The reveal's spot around a sheet-size copy of the card, inside the glass so its tokens resolve; removed once read. */
    const spot = document.createElement('div');
    spot.className = 'kb-opening-spot';
    spot.setAttribute('data-kb-hit', '');
    const copy = card.cloneNode(true) as HTMLElement;
    copy.setAttribute('data-size', 'sheet');
    const probe = document.createElement('span');
    probe.style.color = 'var(--kb-glass-ready)';
    spot.append(copy, probe);
    card.parentElement!.append(spot);
    const cardProbe = document.createElement('span');
    cardProbe.style.color = 'var(--kb-card-color)';
    copy.append(cardProbe);
    const out = { ...(new Function(`return ${fn}`)() as (c: Element) => Drawn)(copy), gold: getComputedStyle(probe).color, own: getComputedStyle(cardProbe).color };
    spot.remove();
    return out;
  }, drawn.toString());

  const set = await read('set');
  expect(set.gold, 'the gold and the card\'s color differ, so the test can tell them apart').not.toBe(set.own);
  expect(set.ring, 'the sheet\'s ring is 2px').toBe(2);
  expect(set.ringColor, 'a Set\'s ring is gold').toBe(set.gold);
  expect(set.beforeShadowColor, 'a Set\'s second line keeps the card\'s color').toBe(set.own);

  const use = await read('use');
  expect(use.ringPainted, 'a Use has no solid ring under its dashes').toBe(false);
  expect(use.beforeBorderColor, 'a Use\'s dashes, its ring, are gold').toBe(use.gold);
});
