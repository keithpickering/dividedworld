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
    Resolves with the number of steps at which a cue's box straddled the reading line, and the number at which the middle of one of a cue's boxes was in the reading
    band (34% of the reading space, centered on the line), so a test can tell a fling that crossed cues from one that touched none. */
const fling = (page: Page) => page.evaluate(() => new Promise<{ straddles: number; inBand: number }>((done) => {
  const foot = document.documentElement.scrollHeight;
  const hud = Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;
  const space = window.innerHeight - hud;
  const line = (space * 40) / 100;
  const half = (space * 34) / 100 / 2;
  let y = 0;
  let straddles = 0;
  let inBand = 0;
  const step = () => {
    window.scrollTo({ top: y, behavior: 'instant' });
    for (const cue of document.querySelectorAll('.dw-lt-cue')) {
      const boxes = Array.from(cue.getClientRects());
      if (boxes.some((r) => r.top <= line && line <= r.bottom)) straddles++;
      if (boxes.some((r) => Math.abs(r.top + r.height / 2 - line) <= half)) inBand++;
    }
    y += 15;
    if (y < foot) requestAnimationFrame(step); else { window.scrollTo({ top: 0, behavior: 'instant' }); done({ straddles, inBand }); }
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
      expect((await fling(page)).straddles, 'the fling crossed cues over the line, so a fire could have happened').toBeGreaterThan(0);
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

/* ------------------------------------------------------------------------------------------------------------------------------------------------------
   A reader, in a browser (the band plan, Task 6): a person reading a long post with the cast cues, by the wheel, from the top to the foot.
   The post is the shape of the owner's first cast: three long paragraphs, 14 cued places, several on one row and five in one paragraph.
   The band (laughTrack.band 34), the air (airMs 1200) and the hold (holdMs 4000) are not set here: the spec relies on the defaults.
   ------------------------------------------------------------------------------------------------------------------------------------------------------ */
const READER_PARAGRAPHS = [
  'I have been reading the forums for years, and the thing I keep noticing is how a fan game gets judged before anyone has played it. A screenshot goes up, a few people squint at it, and by lunch the verdict is already in. Mario fans are the harshest critics of all, which is funny, because Mario fans are also the ones who stay up until four in the morning testing a build for a total stranger. The sprites are always borrowed, the music is always a remix, and the physics are always off by a hair, yet everyone keeps coming back for more. A fan game is a love letter written in somebody else\'s handwriting, and it gets passed around the room until the paper goes soft at the folds and every corner has a coffee ring on it, and nobody who holds it can quite say who wrote it first.',
  'Last spring a builder posted a build with nothing but a title screen and a single room. People wrote pages about that room, whole afternoons of careful argument over where the platforms sat. One reply said the Mario in it jumped like he was wearing wet boots, and the next ten replies agreed without a single complaint. Somebody made a patch for it overnight. Somebody else made a joke about the patch, and that joke became a running bit across three boards and two chat rooms, and then it spilled onto the forums at large. Nobody asked the builder what they wanted, and the builder, bless them, just kept shipping. I think that is the real engine of the forums: a fan game appears, everyone argues, and the argument is the party. Mario is only the excuse, the way a table is only the excuse for dinner, and the long evening is the point of the whole thing.',
  'So here is my plea, and I mean it kindly. Next time a fan game lands on the boards, play it first and talk second. Give the new thing ten minutes before you call it a clone, and tell the builder what worked before you list what did not. A small project is made by one tired person with a day job and a stubborn streak, and a big place with a long memory can afford to be gentle with it. If every fan game met a warm word first, the forums would still be arguing, only better. We can be the room that remembers the kind word instead of the sharp one, and that is all I wanted to say, so I will go back to arguing about that Mario jump in the morning like everybody else, with a clear conscience and a cold cup of tea beside me.',
];
const READER_CUES = [{ phrase: 'fan game', sound: 'boo' }, { phrase: 'forums', sound: 'laugh' }, { phrase: 'Mario', sound: 'cheer' }];
/** 14 places: 5, 5 and 4 by paragraph. A phrase is a place at each of its occurrences. */
const READER_PLACES = READER_PARAGRAPHS.join('\n\n').match(/fan game|forums|Mario/gu)?.length ?? 0;

const WHEEL_MS = 700;
const AIR_MS = 1200;
const QUEUE_WAIT_MS = READER_PLACES * AIR_MS + 2000;

/** The band's stretch in the window, worked out as the plan's Task 3 case 1 works it: at 800 tall with a 189px HUD the reading space is 611, the line 244.4 and
    the band 244.4 +/- 103.87 (34% of 611 is 207.74). */
const bandOf = (height: number, hud: number) => {
  const space = height - hud;
  const line = (space * 40) / 100;
  const half = (space * 34) / 100 / 2;
  return { top: line - half, bottom: line + half };
};

async function openReader(page: Page, size: { width: number; height: number }) {
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
  }, { paragraphs: READER_PARAGRAPHS, cues: READER_CUES });
  await page.evaluate((t) => { history.pushState(null, '', `/t/${t}`); window.dispatchEvent(new PopStateEvent('popstate')); }, thread);
  await expect(page.locator('.dw-lt-cue').first()).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  /* Records each fire as it happens: the time, and the place's index among the page's cues (the order of the text). */
  await page.evaluate(() => {
    const w = globalThis as unknown as { __ltFires: { t: number; at: number }[] };
    w.__ltFires = [];
    const seen = new Set<Element>();
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        if (!el.classList.contains('dw-lt-fired') || seen.has(el)) continue;
        seen.add(el);
        w.__ltFires.push({ t: performance.now(), at: Array.from(document.querySelectorAll('.dw-lt-cue')).indexOf(el) });
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}

/** A wheel notch of 100px every 700ms from the top to the foot, then a wait of the queue's length (14 places, 1200ms of air each, and a margin). */
async function readToTheFoot(page: Page, size: { width: number; height: number }) {
  await page.mouse.move(size.width / 2, size.height / 2);
  for (let i = 0; i < 400; i++) {
    const atFoot = await page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight);
    if (atFoot) break;
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(WHEEL_MS);
  }
  await page.waitForTimeout(QUEUE_WAIT_MS);
}

/** The places the page's scroll could bring into the band, and how many of the page's places fired. A place is reachable when some scroll position puts the middle
    of one of its boxes in the band: its middle on the page is within [band top, scroll range + band bottom]. */
const readerResult = (page: Page) => page.evaluate(() => {
  const hud = Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;
  const space = window.innerHeight - hud;
  const line = (space * 40) / 100;
  const half = (space * 34) / 100 / 2;
  const range = document.documentElement.scrollHeight - window.innerHeight;
  const cues = Array.from(document.querySelectorAll('.dw-lt-cue'));
  const reachable = cues.filter((c) => Array.from(c.getClientRects()).some((r) => {
    const mid = r.top + window.scrollY + r.height / 2;
    return mid >= line - half && mid <= range + line + half;
  }));
  const fired = cues.filter((c) => c.classList.contains('dw-lt-fired'));
  const log = (globalThis as unknown as { __ltFires: { t: number; at: number }[] }).__ltFires;
  return { total: cues.length, reachable: reachable.length, reachableFired: reachable.filter((c) => c.classList.contains('dw-lt-fired')).length, fired: fired.length, log };
});

test.describe('a reader and the band', () => {
  test('the band is worked out as the plan works it', () => {
    const b = bandOf(800, 189);
    expect(b.top).toBeCloseTo(244.4 - 103.87, 1);
    expect(b.bottom).toBeCloseTo(244.4 + 103.87, 1);
  });

  test('a reader hears the post: every place the scroll can bring into the band fires, and at least 12 of 14', async ({ page }) => {
    test.setTimeout(180_000);
    await openReader(page, MAIN);
    expect(await page.locator('.dw-lt-cue').count(), 'the post is drawn with its 14 cued places').toBe(READER_PLACES);
    await readToTheFoot(page, MAIN);
    const r = await readerResult(page);
    expect(r.reachableFired, `${r.reachableFired} of the ${r.reachable} places the scroll can bring into the band fired`).toBe(r.reachable);
    expect(r.fired, `${r.fired} of ${r.total} fired`).toBeGreaterThanOrEqual(12);
  });

  test('in order, spaced: fires come in the order of the text, no two closer than 1100ms', async ({ page }) => {
    test.setTimeout(180_000);
    await openReader(page, MAIN);
    await readToTheFoot(page, MAIN);
    const { log } = await readerResult(page);
    /* The pieces of one place are marked in the same moment; one fire is what lies within 60ms of the one before. */
    const fires: { t: number; at: number }[] = [];
    for (const f of [...log].sort((a, b) => a.t - b.t)) {
      const last = fires[fires.length - 1];
      if (last && f.t - last.t < 60) last.at = Math.min(last.at, f.at); else fires.push({ ...f });
    }
    expect(fires.length, 'a reader to the foot makes several fires').toBeGreaterThan(1);
    const order = fires.map((f) => f.at);
    expect(order, 'the fires are in the order of the text').toEqual([...order].sort((a, b) => a - b));
    const gaps = fires.slice(1).map((f, i) => Math.round(f.t - fires[i]!.t));
    expect(Math.min(...gaps), `the gaps between fires (ms): ${gaps.join(', ')}`).toBeGreaterThanOrEqual(1100);
  });

  test('a fling still fires nothing, though it crossed cues in the band', async ({ page }) => {
    await openReader(page, MAIN);
    const crossed = await fling(page);
    expect(crossed.inBand, 'at least one step of the fling saw a cue in the band').toBeGreaterThan(0);
    /* A correctness wait, not a settle: longer than the 400 ms dwell, so a place that had been counted would have fired by now. */
    await page.waitForTimeout(1000);
    expect(await page.locator('.dw-lt-fired').count()).toBe(0);
  });

  test('a phone: the same reader at 390 by 844 fires at least 12 of 14', async ({ page }) => {
    test.setTimeout(240_000);
    await openReader(page, PHONE);
    await readToTheFoot(page, PHONE);
    const r = await readerResult(page);
    expect(r.fired, `${r.fired} of ${r.total} fired`).toBeGreaterThanOrEqual(12);
  });
});
