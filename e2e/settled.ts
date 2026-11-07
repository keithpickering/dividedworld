import type { Page } from '@playwright/test';

/**
 * Waits for the page's entrances to settle before a measurement reads it (glass polish plan, Task 14): a screen's head, panels and rows
 * enter by a stagger, an overlay by its mask, and a measurement taken mid-way reads a text at the opacity and place it has not yet reached.
 * Motion animates through the Web Animations API where it can and on requestAnimationFrame where it cannot, so the wait asks for both:
 * no running animation (`document.getAnimations()`), nothing held for its exit (`[data-kb-exiting]`), no inline opacity between
 * 0 and 1 and no inline blur (what the rAF path leaves while it runs), and then two settled frames.
 */
export async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    if (document.getAnimations().some((a) => a.playState !== 'finished' && a.playState !== 'idle' && a.playState !== 'paused')) return false;
    if (document.querySelector('[data-kb-exiting]')) return false;
    for (const el of document.querySelectorAll<HTMLElement>('[style]')) {
      const o = el.style.opacity;
      if (o !== '' && Number(o) > 0 && Number(o) < 1) return false;
      if (el.style.filter.includes('blur(') && el.style.filter !== 'blur(0px)') return false;
    }
    return true;
  }, null, { timeout: 30_000 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
