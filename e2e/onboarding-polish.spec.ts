import { expect, test, type Page } from '@playwright/test';
import { signInUnseasonedOnBoard, TOUR_TITLES } from './onboarding.ts';

/**
 * What the backfill's onboarding boards (docs/research/2026-11-05-backfill/19-welcome.html to 22-onboarding-phone.html) decided that the board
 * match's boxes cannot see (e2e/boards/2026-11-05-backfill/19-welcome.ts to 22-onboarding-phone.ts hold the rest; the plan is
 * docs/plans/2026-11-05-backfill-boards-plan.md, Task 7):
 *  - the welcome letter's heading and the guide's section headings are set as the instance writes them, not in capitals (the board match finds a
 *    heading by its words without case, so only the computed style sees it), while a page title keeps its capitals;
 *  - on the phone, each of Before you start's settings is a full-width block, its options whole;
 *  - the tour's tip stands on the glass's ground with a violet edge, the page behind it blurred as well as dimmed, and its arrow meets its edge;
 *  - the tour's first step on the phone has a cut-out round the plate, not a stray square at the window's corner;
 *  - the phone HUD's mask name is whole.
 */

/** The color of a glass token as the browser computes it, `rgb(r, g, b)`. */
const resolved = (page: Page, token: string) => page.evaluate((name) => {
  const probe = document.createElement('i');
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}, token);

test.describe('1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the welcome letter\'s heading and the guide\'s section headings are set as written, on one line; the page titles keep their capitals', async ({ page }) => {
    await page.goto('/welcome');
    const letter = page.locator('.kb-welcome-headline');
    await expect(letter).toBeVisible();
    expect(await letter.evaluate((el) => getComputedStyle(el).textTransform), 'the letter\'s heading').toBe('none');
    const lines = await letter.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines, 'the letter\'s heading is one line at 1440').toBe(1);
    expect(await page.getByRole('heading', { level: 1, name: 'Welcome' }).evaluate((el) => getComputedStyle(el).textTransform), 'the page title').toBe('uppercase');

    await page.goto('/guide');
    const sections = page.locator('.kb-guide-section-title');
    await expect(sections.first()).toBeVisible();
    const transforms = await sections.evaluateAll((els) => els.map((el) => getComputedStyle(el).textTransform));
    expect(transforms.length).toBeGreaterThan(1);
    expect(transforms.filter((t) => t !== 'none'), 'every section heading is set as written').toEqual([]);
    const tall = await sections.evaluateAll((els) => els.map((el) => ({ text: el.textContent, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) })));
    expect(tall.filter((t) => t.lines !== 1), 'every section heading is one line at 1440').toEqual([]);
    expect(await page.getByRole('heading', { level: 1, name: 'Strategy Guide' }).evaluate((el) => getComputedStyle(el).textTransform), 'the page title').toBe('uppercase');
  });

  test('the tour\'s tip stands on the glass\'s ground with a violet edge, drawn on its cut; the page behind is blurred as well as dimmed', async ({ page }) => {
    await signInUnseasonedOnBoard(page);
    const tip = page.getByRole('dialog', { name: TOUR_TITLES[0] });
    const ground = await resolved(page, '--kb-glass-ground');
    const pale = await resolved(page, '--kb-glass-pale');
    const read = await tip.evaluate((el) => ({ edge: getComputedStyle(el).backgroundColor, ground: getComputedStyle(el, '::after').backgroundColor, cut: el.classList.contains('kb-glass-cut-dialog') }));
    expect(read.ground, 'the tip stands on the glass\'s ground').toBe(ground);
    expect(read.edge, 'the edge is not the pale cyan').not.toBe(pale);
    const [r, g, b] = read.edge.match(/\d+/g)!.map(Number) as [number, number, number];
    expect(b > r && r > g && b - g > 40, `the edge ${read.edge} is a violet`).toBe(true);
    expect(read.cut, 'the tip is drawn on the glass\'s cut').toBe(true);
    const dim = await page.locator('.kb-tips-dim').evaluate((el) => getComputedStyle(el).backdropFilter);
    expect(dim, 'the page behind is blurred by 5px').toContain('blur(5px)');
  });

  test('the dim\'s blur is off where the platform asks for reduced transparency', async ({ page }) => {
    await signInUnseasonedOnBoard(page);
    /* The condition is read from the sheet itself: a browser that does not know the query (or cannot be made to match it here) never applies it. */
    const off = await page.evaluate(() => {
      const found: string[] = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (!(rule instanceof CSSMediaRule) || !rule.conditionText.includes('prefers-reduced-transparency: reduce')) continue;
          for (const inner of rule.cssRules) if (inner instanceof CSSStyleRule && inner.selectorText === '.kb-tips-dim') found.push(inner.style.backdropFilter);
        }
      }
      return found;
    });
    expect(off, 'a reduced-transparency rule for the dim that turns the blur off').toEqual(['none']);
  });

  test('the arrow meets the tip\'s edge: no gap between the tip\'s box and the arrow\'s', async ({ page }) => {
    await signInUnseasonedOnBoard(page);
    await page.getByRole('dialog', { name: TOUR_TITLES[0] }).getByRole('button', { name: 'Got it' }).click();
    const tip = page.getByRole('dialog', { name: TOUR_TITLES[1] });
    await expect(tip).toBeVisible();
    /* The tip moves to its new step's place and fades in: read the gap until it settles, and require it at the end of the wait. */
    const gap = () => page.evaluate(() => {
      const panel = document.querySelector('.kb-tips-panel')!.getBoundingClientRect();
      const arrow = document.querySelector('.kb-tips-arrow')!.getBoundingClientRect();
      const below = document.querySelector('.kb-tips')!.getAttribute('data-kb-tips-place') === 'below';
      /* The tip below its target has the arrow above it, and the other way round. */
      return below ? panel.top - arrow.bottom : arrow.top - panel.bottom;
    });
    await expect.poll(gap, { message: 'the gap between the tip and its arrow' }).toBeLessThanOrEqual(0);
  });
});

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /* The theme row is the board look's tiles alone (docs/plans/2026-11-06-board-look-plan.md, Task 16: "the tiles alone"), with no note under
     them (Settings › The board says it); Motion, Text size and Brighter effects are the skewed radios, each with its note. */
  test('Before you start: each setting is a full-width block, its options whole, its note under them', async ({ page }) => {
    await page.goto('/welcome');
    const rows = page.locator('.kb-welcome-setup .kb-acct-row');
    await expect(rows).toHaveCount(4);
    const read = await rows.evaluateAll((els) => els.map((row) => {
      const box = row.getBoundingClientRect();
      const label = row.querySelector('.kb-acct-row-legend')!.getBoundingClientRect();
      const options = row.querySelector('.kb-acct-seg, .kb-tp-tiles')!.getBoundingClientRect();
      const note = row.querySelector('.kb-acct-row-sentence')?.getBoundingClientRect() ?? null;
      const faces = [...row.querySelectorAll<HTMLElement>('.kb-acct-seg-face > b, .kb-tp-tile > b, .kb-tp-tile > span:last-child')].map((b) => {
        const lines = Math.round(b.getBoundingClientRect().height / parseFloat(getComputedStyle(b).lineHeight === 'normal' ? `${parseFloat(getComputedStyle(b).fontSize) * 1.2}` : getComputedStyle(b).lineHeight));
        return { text: b.textContent, lines, whiteSpace: getComputedStyle(b).whiteSpace };
      });
      return { tiles: row.querySelector('.kb-tp-tiles') !== null, width: box.width, labelBottom: label.bottom, optionsTop: options.top, optionsBottom: options.bottom, noteTop: note?.top ?? null, noteWidth: note?.width ?? null, faces };
    }));
    expect(read.map((row) => row.tiles), 'the theme row is the tiles, and the three after it are radios').toEqual([true, false, false, false]);
    for (const row of read) {
      expect(row.width, 'the setting is the width of the block').toBeGreaterThan(320);
      expect(row.optionsTop, 'the options are under the label, not beside it').toBeGreaterThanOrEqual(row.labelBottom - 1);
      if (row.tiles) {
        expect(row.noteTop, 'the tiles stand alone, with no note').toBeNull();
      } else {
        expect(row.noteTop, 'the note is under the options').toBeGreaterThanOrEqual(row.optionsBottom - 1);
        expect(row.noteWidth, 'the note runs the block\'s width').toBeGreaterThan(320);
      }
      for (const face of row.faces) {
        expect(face.whiteSpace, `${face.text} is not broken inside its own label`).toBe('nowrap');
        expect(face.lines, `${face.text} is one line`).toBe(1);
      }
    }
  });

  test('the tour\'s first step cuts the plate out, with no stray square at the window\'s corner', async ({ page }) => {
    await signInUnseasonedOnBoard(page);
    const ringBox = () => page.locator('.kb-tips-ring').evaluate((el) => el.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number });
    /* The ring is measured when the plate is laid out; wait for a target's size, not for a time. */
    await expect.poll(async () => { const r = await ringBox(); return r.width > 12 && r.height > 12; }, { message: 'the ring has a target\'s size, not the padding of nothing (6 by 6 at the window\'s corner)' }).toBe(true);
    const ring = await ringBox();
    const avatar = await page.locator('.kb-hud-avatar').evaluate((el) => el.getBoundingClientRect().toJSON() as { x: number; y: number; width: number; height: number });
    expect(ring.x <= avatar.x && ring.y <= avatar.y && ring.x + ring.width >= avatar.x + avatar.width, 'the ring is round the plate\'s avatar').toBe(true);
    /* What a player sees: no neon in the window's top-left 12px while the tour is open. */
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 12, height: 12 } });
    const neon = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 2]! > 180 && d[i + 1]! > 150 && d[i]! < 140) n += 1;
      return n;
    }, shot.toString('base64'));
    expect(neon, 'neon pixels in the top-left 12px').toBe(0);
  });

  test('a hidden probe inside the plate does not widen the cut-out', async ({ page }) => {
    await signInUnseasonedOnBoard(page);
    const ringBox = () => page.locator('.kb-tips-ring').evaluate((el) => el.getBoundingClientRect().toJSON() as { width: number; height: number });
    await expect.poll(async () => (await ringBox()).width > 12).toBe(true);
    const before = await ringBox();
    /* The HUD keeps hidden measuring copies of the name in the plate (frame.css, .kb-hud-name-probe): one that sits far to the side must not count. */
    await page.evaluate(async () => {
      const probe = document.createElement('span');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:absolute;left:380px;top:0;width:8px;height:8px;visibility:hidden';
      document.querySelector('.kb-hud-plate')!.append(probe);
      window.dispatchEvent(new Event('resize'));
      /* The spotlight follows a resize on the next frame: let it, so what is read after is what it drew. */
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    expect((await ringBox()).width, 'the ring\'s width with a hidden probe far to the side of the plate').toBe(before.width);
  });

  test('the HUD\'s mask name is never cut, for every mask the demo has', async ({ page }) => {
    await page.goto('/b/general');
    const hud = page.getByRole('region', { name: 'Game HUD' });
    const picker = hud.getByRole('combobox', { name: 'Posting as' });
    await expect(picker).toBeVisible();
    const names = await picker.locator('option').allTextContents();
    expect(names).toContain('Mrs. Hooligan');
    for (const name of names) {
      await picker.selectOption({ label: name });
      await expect(page.locator('.kb-hud-picked')).toHaveText(name);
      const read = await page.evaluate((shown) => {
        const select = document.querySelector<HTMLElement>('.kb-hud-select')!;
        /* What the player reads is the name's own element where the HUD draws one, else the picker's own text. */
        const drawn = document.querySelector<HTMLElement>('.kb-hud-picked');
        if (drawn) {
          /* The lines the name is drawn on, read character by character; a word of the name is whole where one line holds all of it. */
          const text = drawn.firstChild as Text;
          const range = document.createRange();
          const lines: string[] = [];
          let current = '';
          let top = Number.NaN;
          for (let i = 0; i < text.length; i += 1) {
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            const t = Math.round(range.getBoundingClientRect().top);
            if (t !== top) { if (current !== '') lines.push(current); current = ''; top = t; }
            current += text.data.charAt(i);
          }
          if (current !== '') lines.push(current);
          const broken = shown.split(' ').filter((w) => !lines.some((l) => l.includes(w)));
          /* The lines' own height (not the glyphs' ink box, which Anton makes taller than its line) against the box that holds them. */
          const need = lines.length * parseFloat(getComputedStyle(drawn).lineHeight);
          return { drawn: true, cut: drawn.scrollWidth > drawn.clientWidth, tall: need > drawn.clientHeight + 1, broken, lines, need: 0, room: 0 };
        }
        /* A native picker clips its text without a sign in the DOM, so it is measured as it is drawn: the widest word of the name at the picker's own size, against the picker less the arrow's room. */
        const style = getComputedStyle(select);
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        ctx.letterSpacing = style.letterSpacing;
        const need = Math.max(...shown.toUpperCase().split(' ').map((w) => ctx.measureText(w).width));
        return { drawn: false, cut: false, tall: false, broken: [] as string[], lines: [] as string[], need, room: select.clientWidth - 28 };
      }, name);
      if (read.drawn) {
        expect(read.cut, `${name}: the name's element is clipped (its scrollWidth is past its clientWidth)`).toBe(false);
        expect(read.tall, `${name}: its ${read.lines.length} lines are taller than the element (${read.lines.join(' / ')})`).toBe(false);
        expect(read.broken, `${name}: a word is broken inside (${read.lines.join(' / ')})`).toEqual([]);
      }
      else expect(read.need, `${name}: the picker's text area (${read.room}px) is too narrow for the name's widest word`).toBeLessThanOrEqual(read.room);
    }
  });
});
