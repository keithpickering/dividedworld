import { expect, test, type Page } from '@playwright/test';
import { pageViolations } from './axe.ts';
import type { E2eWindow } from './glass-screens.ts';

/**
 * Laugh Track in a browser. Two ways in, because the story route has no app around it (no caption bar, no `__kbCaptions`):
 *  - the board stories (instances/divided-world/ui/laugh-track/LaughTrack.board.stories.tsx) for what axe reads: a cue near and a cue heard;
 *  - the app, with a post seeded through `__kbFake` (the e2e build's hook), for what needs the real caption bar, the real sound page and a reader's
 *    gestures: reading fires nothing, the line stirs the room, the mouse, a tap and the keyboard play a cue's reaction.
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

/** Puts the first unheard cue's first line on the line (40% of the way down the space above the HUD, as the card's default reads it). */
const toTheLine = (page: Page) => page.evaluate(() => {
  const cue = document.querySelector('.dw-lt-cue:not(.dw-lt-fired)');
  if (!cue) throw new Error('no unheard cue is drawn');
  const hud = Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;
  const line = ((window.innerHeight - hud) * 40) / 100;
  const box = cue.getClientRects()[0]!;
  window.scrollBy({ top: box.top + box.height / 2 - line, behavior: 'instant' });
});

/** The first unheard cue's first piece, brought to the line and clicked. */
const heardAtTheLine = async (page: Page) => {
  await toTheLine(page);
  await page.locator('.dw-lt-cue:not(.dw-lt-fired)').first().click();
};

const mp3s = (page: Page): string[] => {
  const seen: string[] = [];
  page.on('request', (r) => { if (/\.mp3(\?|$)/u.test(r.url())) seen.push(r.url()); });
  return seen;
};

/** A board story with a cue near the line and with a cue heard, each on the Main board and at 390 wide. */
test('axe finds nothing on a board with a cue near and on one with a cue heard', async ({ page }) => {
  for (const id of ['near-main', 'near-phone', 'heard-main', 'heard-phone']) {
    await openStory(page, `boards-21-laugh-track--${id}`, id.endsWith('phone') ? PHONE : MAIN);
    /* The story route renders no play function: the cue is brought to the line, and for a heard story clicked, here. */
    if (id.startsWith('near') || id.startsWith('heard')) {
      await toTheLine(page);
      await expect.poll(() => page.locator('.dw-lt-cue').first().evaluate((e) => (e as HTMLElement).style.getPropertyValue('--dw-lt-near')), { timeout: 4000 }).toBe('1');
    }
    if (id.startsWith('heard')) await page.locator('.dw-lt-cue').first().evaluate((e) => (e as HTMLElement).click());
    if (id.startsWith('heard')) expect(await page.locator('.dw-lt-fired').count(), `${id}: a cue is heard`).toBeGreaterThan(0);
    else expect(await page.locator('.dw-lt-fired').count(), `${id}: nothing is heard`).toBe(0);
    expect(await pageViolations(page), id).toEqual([]);
  }
});

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

test('a click says the caption on the real bar, in capitals by CSS, and Enter on the heard place says it again', async ({ page }) => {
  await openInApp(page, MAIN);
  await heardAtTheLine(page);
  const bar = page.locator('.kb-captions-bar');
  /* A reaction's caption lasts 2500 ms: its visibility and words are read together in one polled check, so a slow worker cannot let it lapse between two steps. */
  await expect(async () => {
    expect(await bar.isVisible()).toBe(true);
    expect(await region(page).textContent()).toBe('The audience boos');
  }).toPass({ timeout: 4000 });
  expect(await page.locator('.kb-captions-text').evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');
  expect(await page.locator('.kb-captions-text').evaluate((el) => (el as HTMLElement).innerText)).toBe('THE AUDIENCE BOOS');
  /* The caption is put away; a press on the heard place says it again. */
  const button = page.getByRole('button', { name: 'Luigi. Replay: the audience boos' });
  await button.focus();
  await page.evaluate(() => (globalThis as unknown as { __kbCaptions: { reset(): void } }).__kbCaptions.reset());
  await expect(bar).toHaveCount(0);
  /* The same-gesture guard: a second press within 300 ms of another is the same gesture and is dropped. */
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

test('with Game sounds off a click fetches no sound file', async ({ page }) => {
  const seen = mp3s(page);
  await openInApp(page, MAIN, 'off');
  await page.mouse.click(5, 5);
  await heardAtTheLine(page);
  await expect(region(page)).toHaveText('The audience boos', { timeout: 4000 });
  /* A loop would be asked for as a place nears the line; give any fetch time to be made. */
  await page.waitForTimeout(800);
  expect(seen).toEqual([]);
});

test('with Game sounds on and a gesture made, a click fetches its take', async ({ page }) => {
  const seen = mp3s(page);
  await openInApp(page, MAIN, 'on');
  /* The page's sound is unlocked by a gesture; nothing is fetched until a place sounds. */
  await page.mouse.click(5, 5);
  await page.waitForTimeout(300);
  expect(seen).toEqual([]);
  await heardAtTheLine(page);
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

/* ------------------------------------------------------------------------------------------------------------------------------------------------------
   A reader, in a browser: a person reading a long post with the cast cues. The post is the shape of the owner's first cast: three long paragraphs,
   14 cued places, several on one row and five in one paragraph. The line, the reach and the mouse's rule are the card's defaults; none is set here.
   ------------------------------------------------------------------------------------------------------------------------------------------------------ */
const READER_PARAGRAPHS = [
  'I have been reading the forums for years, and the thing I keep noticing is how a fan game gets judged before anyone has played it. A screenshot goes up, a few people squint at it, and by lunch the verdict is already in. Mario fans are the harshest critics of all, which is funny, because Mario fans are also the ones who stay up until four in the morning testing a build for a total stranger. The sprites are always borrowed, the music is always a remix, and the physics are always off by a hair, yet everyone keeps coming back for more. A fan game is a love letter written in somebody else\'s handwriting, and it gets passed around the room until the paper goes soft at the folds and every corner has a coffee ring on it, and nobody who holds it can quite say who wrote it first.',
  'Last spring a builder posted a build with nothing but a title screen and a single room. People wrote pages about that room, whole afternoons of careful argument over where the platforms sat. One reply said the Mario in it jumped like he was wearing wet boots, and the next ten replies agreed without a single complaint. Somebody made a patch for it overnight. Somebody else made a joke about the patch, and that joke became a running bit across three boards and two chat rooms, and then it spilled onto the forums at large. Nobody asked the builder what they wanted, and the builder, bless them, just kept shipping. I think that is the real engine of the forums: a fan game appears, everyone argues, and the argument is the party. Mario is only the excuse, the way a table is only the excuse for dinner, and the long evening is the point of the whole thing.',
  'So here is my plea, and I mean it kindly. Next time a fan game lands on the boards, play it first and talk second. Give the new thing ten minutes before you call it a clone, and tell the builder what worked before you list what did not. A small project is made by one tired person with a day job and a stubborn streak, and a big place with a long memory can afford to be gentle with it. If every fan game met a warm word first, the forums would still be arguing, only better. We can be the room that remembers the kind word instead of the sharp one, and that is all I wanted to say, so I will go back to arguing about that Mario jump in the morning like everybody else, with a clear conscience and a cold cup of tea beside me.',
];
const READER_CUES = [{ phrase: 'fan game', sound: 'boo' }, { phrase: 'forums', sound: 'laugh' }, { phrase: 'Mario', sound: 'cheer' }];
/** 14 places: 5, 5 and 4 by paragraph. A phrase is a place at each of its occurrences. */
const READER_PLACES = READER_PARAGRAPHS.join('\n\n').match(/fan game|forums|Mario/gu)?.length ?? 0;

const PLACES: readonly string[] = READER_PARAGRAPHS.join('\n\n').match(/fan game|forums|Mario/gu) ?? [];
const NAME_UNHEARD = (words: string) => `${words}. Play the audience's reaction`;

async function openReader(page: Page, size: { width: number; height: number }, paragraphs: readonly string[] = READER_PARAGRAPHS, cues: readonly { phrase: string; sound: string }[] = READER_CUES) {
  await page.setViewportSize(size);
  await page.addInitScript(() => { try { sessionStorage.setItem('kb-demo-preferences', JSON.stringify({ gameSound: 'off' })); } catch { /* not kept */ } });
  await page.goto('/b/general');
  await page.waitForFunction(() => '__kbFake' in globalThis);
  const thread = await page.evaluate(({ paragraphs, cues }) => {
    const w = globalThis as E2eWindow;
    const { characters } = w.__kbDemo;
    const made = w.__kbFake.seed.thread('general', characters.hooligan, 'What a fan game is for', 'A thread about fan games and the forums that pass them around.');
    for (const reply of ['Short replies come first.', 'Then a second one.', 'And a third, before the long one.']) w.__kbFake.seed.post(made.thread, characters.hooligan, reply);
    const last = w.__kbFake.seed.post(made.thread, characters.hooligan, paragraphs.join('\n\n'));
    w.__kbFake.seed.card(characters.spritey, last, 'laugh-track', { layer: 1, live: true, config: { cues, seed: 7 }, message: 'Laugh Track' });
    return made.thread;
  }, { paragraphs, cues });
  await page.evaluate((t) => { history.pushState(null, '', `/t/${t}`); window.dispatchEvent(new PopStateEvent('popstate')); }, thread);
  await expect(page.locator('.dw-lt-cue').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
}

/** The Lens's line, as the post's mark names it (the Lens itself is closed): "Laugh Track, 1 play, N of M cues heard. Opens the cards on this post." */
const lens = (page: Page, heard: number) => page.getByRole('button', { name: new RegExp(`, ${heard} of ${READER_PLACES} cues heard`, 'u') });
const heardPlaces = (page: Page) => page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('.dw-lt-fired')).map((e) => e.getAttribute('data-lt-place')))));
/** A cue's first piece's center in the window, by its index among the page's cued places (the order of the text). The piece is brought a quarter of the way down the
    window: the toasts stand over the window's foot and would take a press made there. */
const placeCenter = (page: Page, index: number) => page.evaluate((n) => {
  const keys = Array.from(new Set(Array.from(document.querySelectorAll('.dw-lt-cue')).map((c) => c.getAttribute('data-lt-place'))));
  const piece = document.querySelector(`.dw-lt-cue[data-lt-place="${keys[n]}"]`)!;
  const first = piece.getClientRects()[0]!;
  window.scrollBy({ top: first.top + first.height / 2 - window.innerHeight / 4, behavior: 'instant' });
  const r = piece.getClientRects()[0]!;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, key: keys[n]! };
}, index);
/** A place's nearness as the page computes it, over every piece (a place can have several). */
const nearOf = (page: Page, key: string) => page.evaluate((k) => Array.from(document.querySelectorAll(`.dw-lt-cue[data-lt-place="${k}"]`)).map((e) => Number(getComputedStyle(e).getPropertyValue('--dw-lt-near').trim() || 0)), key);
const keyOf = (page: Page, index: number) => page.evaluate((n) => Array.from(new Set(Array.from(document.querySelectorAll('.dw-lt-cue')).map((c) => c.getAttribute('data-lt-place'))))[n]!, index);

test.describe('a reader', () => {
  test('reading fires nothing', async ({ page }) => {
    test.setTimeout(90_000);
    await openReader(page, MAIN);
    expect(await page.locator('.dw-lt-cue').count(), 'the post is drawn with its 14 cued places').toBeGreaterThanOrEqual(READER_PLACES);
    await page.mouse.move(5, 400);
    expect(await page.evaluate(() => window.scrollY), 'the reading starts at the top').toBe(0);
    for (let i = 0; i < 400; i++) {
      if (await page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight)) break;
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(300);
    }
    expect(await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1), 'the reading reached the foot of the page').toBe(true);
    await page.waitForTimeout(2000);
    await expect(page.locator('.dw-lt-fired')).toHaveCount(0);
    await expect(lens(page, 0)).toBeAttached();
  });

  test('the room stirs: a cue at the line is near, a far one is not, and the murmur is captioned', async ({ page }) => {
    await openReader(page, MAIN);
    /* The murmur is the nearest place's kind. The first "fan game" shares its row with a "forums" (a laugh) and the two tie, so the boo brought to the line
       is the first one that stands alone on its row. */
    const key = await page.evaluate(() => {
      const pieces = Array.from(document.querySelectorAll<HTMLElement>('.dw-lt-cue'));
      const lone = pieces.find((c) => c.dataset['sound'] === 'boo' && pieces.every((o) => o.dataset['ltPlace'] === c.dataset['ltPlace'] || Math.abs(o.getBoundingClientRect().top - c.getBoundingClientRect().top) > 12));
      if (!lone) throw new Error('no boo stands alone on its row');
      const hud = Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;
      const box = lone.getClientRects()[0]!;
      window.scrollBy({ top: box.top + box.height / 2 - ((window.innerHeight - hud) * 40) / 100, behavior: 'instant' });
      return lone.dataset['ltPlace']!;
    });
    await expect(async () => {
      const near = await nearOf(page, key);
      expect(Math.min(...near), 'every piece of the place is near the line').toBeGreaterThanOrEqual(0.9);
    }).toPass({ timeout: 4000 });
    const far = await keyOf(page, PLACES.length - 1);
    const farPieces = await nearOf(page, far);
    expect(farPieces.length, 'the last place is a real cued place with pieces on the page').toBeGreaterThan(0);
    expect(Math.max(...farPieces), 'the last place is more than the reach from the line').toBe(0);
    /* A murmur's caption is held, not said: the bar draws it, and the live region (which announces what is said) stays empty. */
    await expect(async () => { expect(await page.locator('.kb-captions-text').textContent()).toBe('A grumble rises'); }).toPass({ timeout: 4000 });
    await expect(region(page)).toHaveText('');
  });

  test('pointing plays the reaction: the mouse onto a cue marks it heard, and onto a second marks that one too', async ({ page }) => {
    await openReader(page, MAIN);
    const first = PLACES.indexOf('fan game');
    const second = PLACES.indexOf('fan game', first + 1);
    await page.mouse.move(5, 5);
    const a = await placeCenter(page, first);
    await page.mouse.move(a.x, a.y);
    await expect(region(page)).toHaveText('The audience boos', { timeout: 4000 });
    expect(await heardPlaces(page)).toEqual([a.key]);
    await expect(lens(page, 1)).toBeAttached();
    await page.mouse.move(5, 5);
    const b = await placeCenter(page, second);
    await page.mouse.move(b.x, b.y);
    await expect.poll(() => heardPlaces(page), { timeout: 4000 }).toEqual([a.key, b.key]);
    await expect(lens(page, 2)).toBeAttached();
  });

  test('a cue scrolled under a resting mouse plays nothing; the next mouse move over it does', async ({ page }) => {
    await openReader(page, MAIN);
    const target = await placeCenter(page, PLACES.indexOf('fan game'));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    /* The mouse rests at the cue's x, 200px down a window that has no cue there. */
    await page.mouse.move(target.x, 200);
    await page.evaluate((key) => {
      const r = document.querySelector(`.dw-lt-cue[data-lt-place="${key}"]`)!.getClientRects()[0]!;
      window.scrollBy({ top: r.top + r.height / 2 - 200, behavior: 'instant' });
    }, target.key);
    expect(await page.evaluate(({ x, y, key }) => document.elementFromPoint(x, y)?.closest('.dw-lt-cue')?.getAttribute('data-lt-place') === key, { x: target.x, y: 200, key: target.key }), 'the cue stands under the resting mouse').toBe(true);
    await page.waitForTimeout(800);
    expect(await heardPlaces(page), 'the page moved under the mouse').toEqual([]);
    await page.mouse.move(target.x + 3, 200);
    await expect.poll(() => heardPlaces(page), { timeout: 4000 }).toEqual([target.key]);
  });

  test.describe('on a phone', () => {
    test.use({ hasTouch: true, isMobile: true });

    test('a tap on a cue marks it heard; a scroll by touch marks none', async ({ page }) => {
      await openReader(page, PHONE);
      const cdp = await page.context().newCDPSession(page);
      /* A real touch drag: a finger down at the middle, moved up in steps, and lifted, as the browser's own scrolling reads it. */
      const swipe = async (distance: number) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 650 }] });
        for (let k = 1; k <= 10; k++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 650 - (distance * k) / 10 }] });
          await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      for (let i = 0; i < 4; i++) await swipe(500);
      expect(await page.evaluate(() => window.scrollY), 'the touch scroll moved the page').toBeGreaterThan(500);
      await page.waitForTimeout(1000);
      expect(await heardPlaces(page), 'a scroll by touch').toEqual([]);
      /* The card's first-time callout hangs off the post's mark and, at a phone's width, lies over the words: "Got it" puts it away, as a reader would. */
      const gotIt = page.getByRole('button', { name: 'Got it' });
      /* The callout may arrive late: give it a moment to show, and put it away if it does. */
      if (await gotIt.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) await gotIt.click();
      const at = await placeCenter(page, 0);
      await expect.poll(() => page.evaluate((a) => document.elementFromPoint(a.x, a.y)?.closest('.dw-lt-cue') !== null, at), { timeout: 4000, message: 'the cue is what stands at the tap' }).toBe(true);
      await page.touchscreen.tap(at.x, at.y);
      await expect.poll(() => heardPlaces(page), { timeout: 4000 }).toEqual([at.key]);
    });
  });

  test('the keyboard: one Tab lands on the first cue, ArrowRight moves to the second, Enter hears it, and one more Tab leaves the cues', async ({ page }) => {
    await openReader(page, MAIN);
    /* The control before the post: the last tabbable element ahead of the first cue in the page's order. */
    await page.evaluate(() => {
      const cue = document.querySelector('.dw-lt-cue')!;
      const before = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))
        .filter((e) => e.tabIndex >= 0 && !e.classList.contains('dw-lt-cue') && (cue.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 && !e.contains(cue));
      before.at(-1)!.focus();
    });
    const label = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    await page.keyboard.press('Tab');
    expect(await label()).toBe(NAME_UNHEARD(PLACES[0]!));
    await page.keyboard.press('ArrowRight');
    expect(await label()).toBe(NAME_UNHEARD(PLACES[1]!));
    await page.keyboard.press('Enter');
    expect(await heardPlaces(page)).toEqual([await keyOf(page, 1)]);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('dw-lt-fired'))).toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.classList.contains('dw-lt-cue'))).toBe(false);
  });

  test('a cue phrase in a bare address and in plain words: the link holds no cue, and the keyboard reaches every place there is (#602)', async ({ page }) => {
    const address = 'https://example.com/Mario';
    await openReader(page, MAIN, [`Visit ${address} and Mario is a plumber. A fan game is great.`], [{ phrase: address, sound: 'boo' }, { phrase: 'Mario', sound: 'cheer' }, { phrase: 'fan game', sound: 'laugh' }]);
    const link = page.locator('a', { hasText: address });
    await expect(link).toHaveCount(1);
    await expect(link.locator('.dw-lt-cue')).toHaveCount(0);
    await expect(page.locator('.dw-lt-cue[role="button"]')).toHaveCount(2);
    await page.evaluate(() => {
      const cue = document.querySelector('.dw-lt-cue')!;
      const before = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))
        .filter((e) => e.tabIndex >= 0 && !e.classList.contains('dw-lt-cue') && (cue.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 && !e.contains(cue));
      before.at(-1)!.focus();
    });
    const label = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
    await page.keyboard.press('Tab');
    expect(await label()).toBe(NAME_UNHEARD('Mario'));
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowRight');
    expect(await label()).toBe(NAME_UNHEARD('fan game'));
    await page.keyboard.press('Enter');
    expect(await heardPlaces(page)).toHaveLength(2);
    await expect(page.getByRole('button', { name: /, 2 of 2 cues heard/u })).toBeVisible();
  });
});
