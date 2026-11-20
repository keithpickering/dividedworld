import type { Page } from '@playwright/test';

/**
 * Waits for the page's entrances to settle before a measurement reads it (glass polish plan, Task 14): a screen's head, panels and rows
 * enter by a stagger, an overlay by its mask, and a measurement taken mid-way reads a text at the opacity and place it has not yet reached.
 * Motion animates through the Web Animations API where it can and on requestAnimationFrame where it cannot, so the wait asks for both:
 * no running animation (`document.getAnimations()`), nothing held for its exit (`[data-kb-exiting]`), no inline opacity between
 * 0 and 1 and no inline blur on a rendered element (what the rAF path leaves while it runs; a hidden element, as the desktop hand drawer is in the phone layout, keeps its exit's style and shows nothing), no post still unfolding (`[data-kb-fold-moving]`), and then two settled frames.
 * A page with a decoration that loops for as long as it is up (Stick Around's armed ring) never has no running animation: it passes `{ loops: true }`,
 * and an animation that repeats forever is not waited on, since it is not an entrance. Nor is an animation on a scroll's timeline (the phone
 * hand's card poses, engine/ui/cards/Hand.tsx): it runs for as long as it is up, moves only while the page scrolls, and so is at rest when the page is.
 */
export async function settled(page: Page, { loops = false }: { readonly loops?: boolean } = {}): Promise<void> {
  await page.waitForFunction((ignoreLoops) => {
    const entering = (a: Animation) => a.playState !== 'finished' && a.playState !== 'idle' && a.playState !== 'paused'
      && a.timeline === document.timeline
      && !(ignoreLoops && a.effect?.getTiming().iterations === Infinity);
    if (document.getAnimations().some(entering)) return false;
    if (document.querySelector('[data-kb-exiting]')) return false;
    /* Below the Fold's unfold runs on motion values (inline height and rotateX, no Web Animation, no opacity), and marks its article until it is done. */
    if (document.querySelector('[data-kb-fold-moving]')) return false;
    for (const el of document.querySelectorAll<HTMLElement>('[style]')) {
      /* An element that is not rendered (hidden, or in a hidden or undisplayed parent) shows nothing, whatever style its last exit left on it. */
      if (!el.checkVisibility()) continue;
      const o = el.style.opacity;
      if (o !== '' && Number(o) > 0 && Number(o) < 1) return false;
      if (el.style.filter.includes('blur(') && el.style.filter !== 'blur(0px)') return false;
    }
    return true;
  }, loops, { timeout: 30_000 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
