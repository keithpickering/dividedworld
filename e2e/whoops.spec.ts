import { expect, test, type Page } from '@playwright/test';

/**
 * Whoops!'s splat in a real browser, which jsdom cannot draw (cards plan Task 5): #41 on the Main board's
 * moment carries its ink on a canvas, a drag across the ink scrubs it away on the reader's own screen, and
 * a reload brings it back.
 */
test.use({ viewport: { width: 1440, height: 1120 }, reducedMotion: 'reduce' });

const inked = (page: Page) => page.evaluate(() => {
  const c = document.querySelector<HTMLCanvasElement>('#post-41 .kb-whoops-ink');
  if (!c) return 0;
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 40) n++;
  return n;
});

test('the splat on #41 is drawn, scrubbed by a drag, and back after a reload', async ({ page }) => {
  await page.goto('/?fixture=boards&moment=01-main');
  const canvas = page.locator('#post-41 .kb-whoops-ink');
  await expect(canvas).toBeVisible();
  await expect.poll(() => inked(page)).toBeGreaterThan(1000);
  const before = await inked(page);
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.47, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => inked(page)).toBeLessThan(before);
  /* The demo world starts over on a load (the address is rewritten once it is in), so a reload is a fresh visit to the moment. */
  await page.goto('/?fixture=boards&moment=01-main');
  await expect.poll(() => inked(page)).toBeGreaterThan(before * 0.95);
});

/*
 * The scrub button, the author's tool toggles and the chosen ink swatch are drawn with a border, a
 * glow and underlining, which forced colors (Windows High Contrast) drop or recolor: each is also
 * marked by an outline or a border in a system color there. The swatch is the play form's, which a
 * moment does not open, so a swatch is made from the card's own markup beside the post.
 */
test.describe('in forced colors', () => {
  test.use({ forcedColors: 'active' });

  test('the scrub button, the author\'s tools and the chosen swatch are marked in system colors', async ({ page }) => {
    await page.goto('/?fixture=boards&moment=01-main');
    await expect(page.locator('#post-41 .kb-whoops-scrub')).toBeVisible();
    const marks = await page.evaluate(() => {
      const system = (color: string) => {
        const probe = document.createElement('div');
        probe.style.cssText = `forced-color-adjust: none; color: ${color}`;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      };
      const form = document.createElement('div');
      form.innerHTML = '<label class="kb-whoops-swatch"><input type="radio" name="t" checked></label><label class="kb-whoops-swatch"><input type="radio" name="t"></label>';
      document.body.append(form);
      const outline = (el: Element) => { const c = getComputedStyle(el); return { style: c.outlineStyle, width: c.outlineWidth, color: c.outlineColor }; };
      const border = (el: Element) => { const c = getComputedStyle(el); return { style: c.borderTopStyle, width: c.borderTopWidth, color: c.borderTopColor }; };
      const [chosen, other] = [...form.querySelectorAll('input')];
      const tools = [...document.querySelectorAll('#post-41 .kb-whoops-tools button')];
      return {
        buttonText: system('ButtonText'), highlight: system('Highlight'),
        scrub: outline(document.querySelector('#post-41 .kb-whoops-scrub')!),
        tools: tools.map((t) => ({ pressed: t.getAttribute('aria-pressed'), ...outline(t) })),
        chosen: border(chosen!), other: border(other!),
      };
    });
    expect(marks.scrub).toEqual({ style: 'solid', width: '2px', color: marks.buttonText });
    expect(marks.tools).toHaveLength(2);
    for (const t of marks.tools) {
      expect(t).toEqual(t.pressed === 'true' ? { pressed: 'true', style: 'solid', width: '3px', color: marks.highlight } : { pressed: 'false', style: 'solid', width: '1px', color: marks.buttonText });
    }
    expect(marks.chosen).toEqual({ style: 'solid', width: '4px', color: marks.highlight });
    expect(marks.other.style).not.toBe('solid');
  });
});
