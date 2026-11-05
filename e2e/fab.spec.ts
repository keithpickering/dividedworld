import { expect, test, type Page } from '@playwright/test';

/**
 * Feelin' Fab's styles as a browser computes them (docs/plans/2026-11-03-onboarding-followups-plan.md, Task 7; the design's section 5):
 * instances/divided-world/ui/feelin-fab/fab.css read through getComputedStyle on the rainbow layer (.dw-fab-layer) and a twinkle
 * (.dw-fab-twinkle), so a rule that never wins the cascade, or a selector that matches nothing, is red where a regex over the file
 * is green. A held post (data-kb-moving="false") has no animation and no promoted layer; a moving one has both; one scrolled out of
 * view is paused (data-kb-running="false"); the player's setting (data-kb-motion on <html>) beats the device's, as Effect.tsx reads it.
 * The words keep a two-layer text shadow. The poisons plant each defect with a style tag and name it: the check reports a list of
 * problems, [] when the page is right, and each poison test expects its own problem in that list (CSP is bypassed for the plant, as
 * e2e/glass-text.spec.ts does; e2e/csp.spec.ts holds the policy).
 */
test.use({ bypassCSP: true });

const STORY = (name: string) => `/?fixture=boards&story=boards-10-feelin-fab--${name}`;
const FAB = '[data-kb-fab]';

interface Style { readonly name: string; readonly state: string; readonly will: string }
const styleOf = (page: Page, post: number, selector: string): Promise<Style> =>
  page.locator(FAB).nth(post).locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, state: s.animationPlayState, will: s.willChange };
  });

type Want = 'animating' | 'held' | 'paused';

/** The problems with one post's rainbow layer and first twinkle against what it should be doing; none when it is right. */
async function problems(page: Page, post: number, want: Want): Promise<string[]> {
  const out: string[] = [];
  for (const [selector, promoted] of [['.dw-fab-layer', 'transform'], ['.dw-fab-twinkle', 'transform']] as const) {
    const s = await styleOf(page, post, selector);
    if (want === 'held') {
      if (s.name !== 'none') out.push(`${selector}: held post animates (animation-name ${s.name})`);
      if (s.will !== 'auto') out.push(`${selector}: held post is promoted (will-change ${s.will})`);
    } else {
      if (s.name === 'none') out.push(`${selector}: moving post does not animate (animation-name none)`);
      if (!s.will.includes(promoted)) out.push(`${selector}: moving post is not promoted (will-change ${s.will})`);
      const state = want === 'paused' ? 'paused' : 'running';
      if (s.state !== state) out.push(`${selector}: animation-play-state is ${s.state}, not ${state}`);
    }
  }
  return out;
}

/** The problems with the words' text shadow: two layers, each in the board's ground color (--kb-bg, resolved through a probe so the formats match). */
const shadowProblems = (page: Page, post: number): Promise<string[]> =>
  page.locator(FAB).nth(post).locator('.dw-fab-words').first().evaluate((el) => {
    const probe = document.createElement('i');
    probe.style.color = 'var(--kb-bg)';
    el.append(probe);
    const ground = getComputedStyle(probe).color;
    probe.remove();
    const layers = getComputedStyle(el).textShadow.match(/rgba?\([^)]*\)/gu) ?? [];
    const out: string[] = [];
    if (layers.length !== 2) out.push(`text-shadow has ${layers.length} layers, not 2`);
    layers.forEach((c, i) => { if (c !== ground) out.push(`text-shadow layer ${i + 1} is ${c}, not the ground ${ground}`); });
    return out;
  });

/** Opens a story and waits for its first Feelin' Fab, scrolled into view and reported running when `inView`. */
async function open(page: Page, name: string, inView = true) {
  await page.goto(STORY(name));
  await expect(page.locator(FAB).first()).toBeAttached();
  if (inView) {
    await page.locator(FAB).first().scrollIntoViewIfNeeded();
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-running', 'true');
  }
}
/** Scrolls the first post out of view and waits for it to say so. */
async function scrollAway(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-running', 'false');
}
const setMotion = (page: Page, value: 'reduce' | 'full' | null) =>
  page.evaluate((v) => { if (v) document.documentElement.setAttribute('data-kb-motion', v); else document.documentElement.removeAttribute('data-kb-motion'); }, value);
const plant = (page: Page, css: string) => page.addStyleTag({ content: css });

test.describe('the styles a browser computes', () => {
  test('a moving post in view animates, runs, and promotes its layers', async ({ page }) => {
    await open(page, 'one-light');
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'true');
    expect(await problems(page, 0, 'animating')).toEqual([]);
  });

  test('a held post has no animation and no promoted layer', async ({ page }) => {
    await open(page, 'one-still', false);
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'false');
    expect(await problems(page, 0, 'held')).toEqual([]);
  });

  test('a moving post scrolled out of view is paused', async ({ page }) => {
    await open(page, 'twenty-light');
    await scrollAway(page);
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'true');
    expect(await problems(page, 0, 'paused')).toEqual([]);
  });

  test('the device asking for reduced motion, with no choice made, holds the post', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'one-light', false);
    await setMotion(page, null);
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'false');
    expect(await problems(page, 0, 'held')).toEqual([]);
  });

  test('the player choosing reduced motion, under a device with no preference, holds the post', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await open(page, 'one-light');
    await setMotion(page, 'reduce');
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'false');
    expect(await problems(page, 0, 'held')).toEqual([]);
  });

  /* 'full' is the account's value for motion (engine/ui/appearance.ts: account_preferences' motion, written to <html data-kb-motion>);
     fab.css has no data-kb-motion selector, so it is Effect.tsx's reading of it that this exercises. The post is first shown held
     under the device's setting alone, so the choice is what moves it and the case cannot pass without it. */
  test('the player choosing full motion, under a device that asks for reduced motion, moves the post', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'one-light', false);
    await setMotion(page, null);
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'false');
    expect(await problems(page, 0, 'held')).toEqual([]);
    await setMotion(page, 'full');
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'true');
    await page.locator(FAB).first().scrollIntoViewIfNeeded();
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-running', 'true');
    expect(await problems(page, 0, 'animating')).toEqual([]);
  });

  test('the words keep a two-layer text shadow', async ({ page }) => {
    await open(page, 'one-light', false);
    expect(await shadowProblems(page, 0)).toEqual([]);
  });
});

/*
 * The poisons: each defect the checks above exist to catch, planted by a style tag or an init script in a real page, and named by the check.
 * Each red run, with the check expecting no problem, is recorded in the PR that added this spec.
 */
test.describe('the poisons, planted in a real page', () => {
  test('a held post made to animate is named', async ({ page }) => {
    await open(page, 'one-still', false);
    await plant(page, '.dw-fab[data-kb-moving="false"] .dw-fab-layer { animation: dw-fab-spread 14s infinite !important }');
    expect(await problems(page, 0, 'held')).toContain('.dw-fab-layer: held post animates (animation-name dw-fab-spread)');
  });

  test('a post out of view made to run is named', async ({ page }) => {
    await open(page, 'twenty-light');
    await scrollAway(page);
    await plant(page, '.dw-fab-layer, .dw-fab-twinkle { animation-play-state: running !important }');
    expect(await problems(page, 0, 'paused')).toContain('.dw-fab-layer: animation-play-state is running, not paused');
  });

  /* The device's reduced motion ignored: the hook's own query (engine/ui/appearance.ts) is made to report no match. */
  test('the device\'s reduced motion ignored is named', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => {
        const m = real(q);
        return /prefers-reduced-motion/u.test(q) ? new Proxy(m, { get: (t, k) => { if (k === 'matches') return false; const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } }) : m;
      };
    });
    await open(page, 'one-light', false);
    await setMotion(page, null);
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'true');
    expect(await problems(page, 0, 'held')).toContain('.dw-fab-layer: held post animates (animation-name dw-fab-drift-6)');
  });

  /* The account's reduce ignored: the code reading <html data-kb-motion> is modeled by an init script that makes that one attribute
     read as absent (Element.getAttribute), which is what a hook that never looked at it would see; the attribute itself stays set. */
  test('the account\'s reduced motion ignored is named', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() => {
      const real = Element.prototype.getAttribute;
      Element.prototype.getAttribute = function (name: string) { return name === 'data-kb-motion' ? null : real.call(this, name); };
    });
    await open(page, 'one-light');
    await setMotion(page, 'reduce');
    await expect(page.locator('html')).toHaveAttribute('data-kb-motion', 'reduce');
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'true');
    expect(await problems(page, 0, 'held')).toContain('.dw-fab-layer: held post animates (animation-name dw-fab-drift-6)');
  });

  /* A bare media rule (past a player's "full"): the device's setting stops the animation although the account chose full. */
  test('a bare reduced-motion media rule over the account\'s full is named', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, 'one-light');
    await setMotion(page, 'full');
    await expect(page.locator(FAB).first()).toHaveAttribute('data-kb-moving', 'true');
    await plant(page, '@media (prefers-reduced-motion: reduce){.dw-fab-layer,.dw-fab-twinkle{animation:none!important}}');
    expect(await problems(page, 0, 'animating')).toContain('.dw-fab-layer: moving post does not animate (animation-name none)');
  });

  test('a text shadow of none is named', async ({ page }) => {
    await open(page, 'one-light', false);
    await plant(page, '.dw-fab-words { text-shadow: none !important }');
    expect(await shadowProblems(page, 0)).toContain('text-shadow has 0 layers, not 2');
  });

  test('a text shadow in a color other than the ground is named', async ({ page }) => {
    await open(page, 'one-light', false);
    await plant(page, '.dw-fab-words { text-shadow: 0 0 2px red, 0 0 6px red !important }');
    expect(await shadowProblems(page, 0)).toContain('text-shadow layer 1 is rgb(255, 0, 0), not the ground rgb(255, 255, 255)');
  });
});
