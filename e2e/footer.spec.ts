import { expect, test, type Page } from '@playwright/test';

/**
 * The post's footer bar (the owner's word of 2026-10-31, the screens-and-cards plan's amendment on the post's footer bar):
 * "There's no way the current #000 text against that magenta ink passes contrast, and that ink color is totally variable too."
 * So the action row (Quote, Spin thread, Edit, History) stands on an opaque bar of its own, drawn like the header bar, and the
 * splat fills the body between the two bars and never lies under either. #41 is splatted in the lightest and the darkest ink
 * (engine/ui/thread/Footer.board.stories.tsx), at 390 and 1440, and every footer control's text is read against the bar's own
 * ground (the 2003 body text's 4.5:1), each reaction chip's text against the chip's own ground (the owner: "reactions are
 * fine as is. They already each have an individual solid background+border"), and the bar's ground is opaque.
 *
 * The poison plants the defect the check exists to catch, the bar made transparent, and expects it named.
 */
test.use({ reducedMotion: 'reduce', bypassCSP: true });

type Rgba = readonly [number, number, number, number];

/** Every fault in the post's footer bar and reaction chips as the page stands; [] is clean. */
async function faults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const parse = (c: string): Rgba => {
      const m = /rgba?\(([^)]+)\)/u.exec(c);
      if (!m) throw new Error(`not a color: ${c}`);
      const [r, g, b, a] = m[1]!.split(/[ ,/]+/u).filter(Boolean).map(Number);
      return [r!, g!, b!, a ?? 1];
    };
    const lum = ([r, g, b]: Rgba) => {
      const [x, y, z] = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
      return 0.2126 * x + 0.7152 * y + 0.0722 * z;
    };
    const ratio = (a: Rgba, b: Rgba) => { const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p); return (hi! + 0.05) / (lo! + 0.05); };
    const out: string[] = [];
    const post = document.querySelector('#post-41')!;
    const bar = post.querySelector('footer.kb-act-foot');
    if (!bar) return ['#41 has no footer bar'];
    const ground = parse(getComputedStyle(bar).backgroundColor);
    if (ground[3] !== 1) out.push(`the footer bar's ground is not opaque (alpha ${ground[3]})`);
    const controls = [...bar.querySelectorAll<HTMLElement>('button, a')];
    if (controls.length < 2) out.push('the footer bar holds fewer than two controls');
    for (const el of controls) {
      const text = parse(getComputedStyle(el).color);
      if (text[3] !== 1) out.push(`${el.textContent}: text is not opaque`);
      const r = ratio(text, ground);
      if (r < 4.5) out.push(`${el.textContent}: ${r.toFixed(2)}:1 on the bar's ground, under 4.5:1`);
    }
    const chips = [...post.querySelectorAll<HTMLElement>('.kb-chip')];
    if (chips.length === 0) out.push('#41 has no reaction chips');
    for (const el of chips) {
      const s = getComputedStyle(el);
      const bg = parse(s.backgroundColor);
      if (bg[3] !== 1) out.push(`reaction chip "${el.textContent}": its ground is not opaque`);
      const r = ratio(parse(s.color), bg);
      if (r < 4.5) out.push(`reaction chip "${el.textContent}": ${r.toFixed(2)}:1 on its own ground, under 4.5:1`);
    }
    /* The bars are never inked: nothing of the splat's canvas reaches into either bar. */
    const ink = post.querySelector('.kb-whoops-ink')?.getBoundingClientRect();
    if (!ink) out.push('#41 is not splatted');
    else {
      const [head, foot] = [post.querySelector('header.kb-act-meta')!.getBoundingClientRect(), bar.getBoundingClientRect()];
      if (ink.top < head.bottom - 1) out.push('the ink reaches up into the header bar');
      if (ink.bottom > foot.top + 1) out.push('the ink reaches down into the footer bar');
    }
    return out;
  });
}

for (const [width, height, label] of [[1440, 1120, '1440'], [390, 844, '390']] as const) {
  const phone = width === 390;
  for (const ink of ['lightest', 'darkest'] as const) {
    const id = `boards-01-footer-ink--${ink}-ink${phone ? '-phone' : ''}`;
    test.describe(`#41 splatted in the ${ink} ink at ${label}`, () => {
      test.use({ viewport: { width, height } });

      test('the footer bar is opaque, its controls and the reaction chips read at 4.5:1 on their own grounds', async ({ page }) => {
        await page.goto(`/?fixture=boards&story=${id}`);
        await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
        /* The extra layer is heard live: it is on the post once its tag says so. */
        await expect(page.locator('#post-41 .kb-whoops')).toHaveAttribute('data-kb-layers', /^live live$/u);
        expect(await faults(page)).toEqual([]);
      });

      test('poison: with the bar made transparent the check names it', async ({ page }) => {
        await page.goto(`/?fixture=boards&story=${id}`);
        await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
        await page.addStyleTag({ content: 'footer.kb-act-foot { background: transparent !important; }' });
        expect((await faults(page)).join('\n')).toContain("the footer bar's ground is not opaque");
      });
    });
  }
}

test('the footer bar is on every post, splatted or not, and a splat does not move the layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1120 });
  await page.goto('/?fixture=boards&moment=01-main');
  await expect(page.locator('#post-41 .kb-whoops-ink')).toBeVisible();
  const read = await page.evaluate(() => {
    const posts = [...document.querySelectorAll('article.kb-act')];
    const head = (p: Element) => getComputedStyle(p.querySelector('header.kb-act-meta')!);
    const foot = (p: Element) => getComputedStyle(p.querySelector('footer.kb-act-foot')!);
    return {
      every: posts.every((p) => p.querySelector('footer.kb-act-foot') !== null),
      count: posts.length,
      same: posts.every((p) => head(p).backgroundColor === foot(p).backgroundColor && head(p).fontFamily === foot(p).fontFamily && head(p).borderBottomColor === foot(p).borderTopColor),
      links: posts.every((p) => p.querySelector('footer.kb-act-foot .kb-act-links') !== null),
    };
  });
  expect(read).toEqual({ every: true, count: expect.any(Number), same: true, links: true });
});
