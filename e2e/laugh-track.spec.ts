import { expect, test, type Page } from '@playwright/test';
import { pageViolations } from './axe.ts';
import type { E2eWindow } from './glass-screens.ts';

/**
 * Laugh Track's Part 2 in a browser (the Laugh Track plan, Task 14). Two ways in, because the story route has no app around it (no caption bar,
 * no `__kbCaptions`):
 *  - the board stories (instances/divided-world/ui/laugh-track/LaughTrack.board.stories.tsx) for the effect itself: a place fires when it rests on
 *    the reading line for the dwell, a fling fires nothing, Tab reaches a fired place, axe reads both boards;
 *  - the app, with the same post seeded through `__kbFake` (the e2e build's hook), for what needs the real caption bar and the real sound page.
 */
test.use({ bypassCSP: true });

const MAIN = { width: 1280, height: 800 } as const;
const PHONE = { width: 390, height: 844 } as const;

const openStory = async (page: Page, id: string, size: { width: number; height: number }) => {
  await page.setViewportSize(size);
  await page.goto(`/?fixture=boards&story=${id}`);
  await expect(page.locator('.dw-lt-cue').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
};

/** Puts the first unfired cue's first line on the reading line (40% of the way down the space above the HUD), as the card's default reads it. */
const toTheLine = (page: Page) => page.evaluate(() => {
  const cue = document.querySelector('.dw-lt-cue:not(.dw-lt-fired)');
  if (!cue) throw new Error('no unfired cue is drawn');
  const hud = Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;
  const line = ((window.innerHeight - hud) * 40) / 100;
  const box = cue.getClientRects()[0]!;
  window.scrollBy({ top: box.top + box.height / 2 - line, behavior: 'instant' });
});

/** The page flung from its top to its foot at about 900 px a second and back to the top: every cue crosses the line in well under the dwell.
    Resolves with the number of steps at which a cue's box straddled the reading line, so a test can tell a fling that crossed cues from one that touched none. */
const fling = (page: Page) => page.evaluate(() => new Promise<number>((done) => {
  const foot = document.documentElement.scrollHeight;
  const hud = Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;
  const line = ((window.innerHeight - hud) * 40) / 100;
  let y = 0;
  let straddles = 0;
  const step = () => {
    window.scrollTo({ top: y, behavior: 'instant' });
    for (const cue of document.querySelectorAll('.dw-lt-cue')) if (Array.from(cue.getClientRects()).some((r) => r.top <= line && line <= r.bottom)) straddles++;
    y += 15;
    if (y < foot) requestAnimationFrame(step); else { window.scrollTo({ top: 0, behavior: 'instant' }); done(straddles); }
  };
  step();
}));

const mp3s = (page: Page): string[] => {
  const seen: string[] = [];
  page.on('request', (r) => { if (/\.mp3(\?|$)/u.test(r.url())) seen.push(r.url()); });
  return seen;
};

for (const [name, id, size] of [['Main', 'boards-21-laugh-track--main', MAIN], ['Phone', 'boards-21-laugh-track--phone', PHONE]] as const) {
  test.describe(`the ${name} board`, () => {
    test('nothing marks a cue before it fires, and axe finds nothing', async ({ page }) => {
      await openStory(page, id, size);
      expect(await page.locator('.dw-lt-fired').count()).toBe(0);
      expect(await page.locator('.dw-lt-cue').first().evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('none');
      expect(await pageViolations(page)).toEqual([]);
    });

    test('a place scrolled onto the line and held fires: its dotted underline shows', async ({ page }) => {
      await openStory(page, id, size);
      await toTheLine(page);
      const fired = page.locator('.dw-lt-fired').first();
      await expect(fired).toBeAttached({ timeout: 4000 });
      const style = await fired.evaluate((el) => { const s = getComputedStyle(el); return { line: s.textDecorationLine, style: s.textDecorationStyle }; });
      expect(style).toEqual({ line: 'underline', style: 'dotted' });
    });

    test('after a fire axe finds nothing', async ({ page }) => {
      await openStory(page, id, size);
      await toTheLine(page);
      await expect(page.locator('.dw-lt-fired').first()).toBeAttached({ timeout: 4000 });
      expect(await pageViolations(page)).toEqual([]);
    });

    test('a fast scroll past every cue fires nothing', async ({ page }) => {
      await openStory(page, id, size);
      expect(await fling(page), 'the fling crossed cues over the line, so a fire could have happened').toBeGreaterThan(0);
      /* A correctness wait, not a settle: longer than the 400 ms dwell, so a place that had been counted would have fired by now. */
      await page.waitForTimeout(1000);
      expect(await page.locator('.dw-lt-fired').count()).toBe(0);
    });

    test('Tab reaches a fired place and it is a button named for its sound', async ({ page }) => {
      await openStory(page, id, size);
      await toTheLine(page);
      await expect(page.locator('.dw-lt-fired').first()).toBeAttached({ timeout: 4000 });
      let name = '';
      for (let i = 0; i < 80 && !name.includes('Replay:'); i++) {
        await page.keyboard.press('Tab');
        name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
      }
      expect(name).toBe('Luigi. Replay: the audience boos');
      expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('button');
      await page.keyboard.press('Enter');
      /* Enter keeps the place a fired one; what the replay does (says its caption again) needs the app's caption bar, which a story has none of, and is
         asserted in the app test 'a fire says the caption on the real bar, in capitals by CSS, and Enter on the fired place says it again'. */
      expect(await page.evaluate(() => document.activeElement?.classList.contains('dw-lt-fired'))).toBe(true);
    });
  });
}

/* The app: the story's thread seeded into the demo world, as a post of another player's with Laugh Track cast on it by the demo player. */
const CUES = [{ phrase: 'Luigi', sound: 'boo' }, { phrase: 'the greatest game ever made', sound: 'cheer' }, { phrase: 'we came in first', sound: 'laugh' }];

async function openInApp(page: Page, size: { width: number; height: number }, gameSound: 'on' | 'off' = 'off') {
  await page.setViewportSize(size);
  await page.addInitScript((sound) => { try { sessionStorage.setItem('kb-demo-preferences', JSON.stringify({ gameSound: sound })); } catch { /* not kept */ } }, gameSound);
  await page.goto('/b/general');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  const thread = await page.evaluate((cues) => {
    const w = globalThis as E2eWindow;
    const { characters } = w.__kbDemo;
    const made = w.__kbFake.seed.thread('general', characters.hooligan, 'Ranking every Mario Kart', 'Ranking every Mario Kart, worst to best. Number one is Double Dash.');
    const pad = (n: number) => Array.from({ length: n }, (_, i) => `Filler paragraph ${i + 1}: this is a long enough line of ordinary words that it takes up a line or two of the post and no more.`).join('\n\n');
    const post = w.__kbFake.seed.post(made.thread, characters.hooligan, [
      pad(8),
      'The best driver in the entire series is Luigi. I will not be taking questions.',
      pad(8),
      'Double Dash is still the greatest game ever made, and I would die on that hill.',
      pad(8),
      'My cat walked on the controller once and we came in first.',
      pad(8),
    ].join('\n\n'));
    w.__kbFake.seed.card(characters.spritey, post, 'laugh-track', { layer: 1, live: true, config: { cues, seed: 7 }, message: 'Laugh Track' });
    return made.thread;
  }, CUES);
  await page.evaluate((t) => { history.pushState(null, '', `/t/${t}`); window.dispatchEvent(new PopStateEvent('popstate')); }, thread);
  await expect(page.locator('.dw-lt-cue').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
}

const region = (page: Page) => page.getByRole('status', { name: 'Sound captions' });

test('a fire says the caption on the real bar, in capitals by CSS, and Enter on the fired place says it again', async ({ page }) => {
  await openInApp(page, MAIN);
  await toTheLine(page);
  const bar = page.locator('.kb-captions-bar');
  /* A fire's caption lasts 2500 ms: its visibility and words are read together in one polled check, so a slow worker cannot let it lapse between two steps. */
  await expect(async () => {
    expect(await bar.isVisible()).toBe(true);
    expect(await region(page).textContent()).toBe('The audience boos');
  }).toPass({ timeout: 4000 });
  expect(await page.locator('.kb-captions-text').evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');
  expect(await page.locator('.kb-captions-text').evaluate((el) => (el as HTMLElement).innerText)).toBe('THE AUDIENCE BOOS');
  /* The caption is put away; a press on the fired place says it again. */
  const button = page.getByRole('button', { name: 'Replay: the audience boos' });
  await button.focus();
  await page.evaluate(() => (globalThis as unknown as { __kbCaptions: { reset(): void } }).__kbCaptions.reset());
  await expect(bar).toHaveCount(0);
  /* The same-gesture guard: the focus above replayed the take, and a replay within 300 ms (SAME_GESTURE_MS in Effect.tsx) of another is the same gesture and is dropped. */
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await expect(region(page)).toHaveText('The audience boos');
  await expect(bar).toBeVisible();
});

test('at a phone\'s width the caption fits inside the gutters', async ({ page }) => {
  await openInApp(page, PHONE);
  /* A long caption held for a minute (the words of e2e/captions.spec.ts's LONG), so the bar's box is the long one and nothing else can stand in for it. */
  const LONG = 'A very long crowd laughs at the thing that was just said, and keeps on going well past the width of a phone';
  await page.evaluate((text) => (globalThis as unknown as { __kbCaptions: { say(w: { text: string; ms: number }): void } }).__kbCaptions.say({ text, ms: 60_000 }), LONG);
  const bar = page.locator('.kb-captions-bar');
  await expect(bar).toBeVisible({ timeout: 4000 });
  await expect(region(page)).toHaveText(LONG);
  const b = await bar.boundingBox();
  if (!b) throw new Error('the bar has no box');
  expect(b.x).toBeGreaterThanOrEqual(16 - 0.5);
  expect(b.x + b.width).toBeLessThanOrEqual(PHONE.width - 16 + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('with Game sounds off a fire fetches no sound file', async ({ page }) => {
  const seen = mp3s(page);
  await openInApp(page, MAIN, 'off');
  await page.mouse.click(5, 5);
  await toTheLine(page);
  await expect(region(page)).toHaveText('The audience boos', { timeout: 4000 });
  /* A loop would be asked for as a place nears the line; give any fetch time to be made. */
  await page.waitForTimeout(800);
  expect(seen).toEqual([]);
});

test('with Game sounds on and a gesture made, a fire fetches its take', async ({ page }) => {
  const seen = mp3s(page);
  await openInApp(page, MAIN, 'on');
  /* The page's sound is unlocked by a gesture; nothing is fetched until a place sounds. */
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  expect(seen).toEqual([]);
  await toTheLine(page);
  await expect.poll(() => seen.some((u) => /boo-[123]/u.test(u)), { timeout: 5000 }).toBe(true);
});

/* The bar is mounted at the page's root (web/src/App.tsx), over the board's and the glass's own layers. It lets every press through, so for the test it is
   made to take them, and what a press at its center reaches is what stands over it there: the bar itself if nothing covers it. */
async function barIsOnTop(page: Page) {
  await page.addStyleTag({ content: '.kb-captions-bar { pointer-events: auto !important; }' });
  const bar = page.locator('.kb-captions-bar');
  await expect(bar).toBeVisible();
  const b = await bar.boundingBox();
  if (!b) throw new Error('the bar has no box');
  const hit = await page.evaluate(({ x, y }) => {
    const top = document.elementFromPoint(x, y);
    return top?.closest('.kb-captions-bar') !== null && top !== null;
  }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  expect(hit).toBe(true);
}

const say = (page: Page) => page.evaluate(() => (globalThis as unknown as { __kbCaptions: { say(w: { text: string; ms: number }): void } }).__kbCaptions.say({ text: 'Crowd laughs', ms: 60_000 }));

/* Whether a caption should show above a modal's scrim is a design question, in the PR's Design questions. */
test('a caption said with a dialog open on a board stands clear of the dialog', async ({ page }) => {
  await page.setViewportSize(MAIN);
  await page.goto('/b/general');
  await page.getByRole('link', { name: 'Who keeps reacting with a thumbs up?', exact: true }).click();
  const react = page.locator('#post-3').getByRole('button', { name: 'React' });
  await expect(react).toBeVisible();
  await react.click();
  const picker = page.getByRole('dialog', { name: /^React to / });
  await expect(picker).toBeVisible();
  await say(page);
  await expect(page.locator('.kb-captions-bar')).toBeVisible();
  const [bar, dialog] = [await page.locator('.kb-captions-bar').boundingBox(), await picker.boundingBox()];
  if (!bar || !dialog) throw new Error('no box');
  const apart = bar.y >= dialog.y + dialog.height || bar.y + bar.height <= dialog.y || bar.x >= dialog.x + dialog.width || bar.x + bar.width <= dialog.x;
  expect(apart).toBe(true);
});

test('a caption said on the sound settings page is visible and not covered', async ({ page }) => {
  await page.setViewportSize(MAIN);
  await page.goto('/settings?section=sound');
  await expect(page.getByRole('radiogroup', { name: 'Game sounds' })).toBeVisible();
  await say(page);
  await barIsOnTop(page);
});
