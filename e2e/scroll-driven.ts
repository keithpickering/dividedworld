import type { Page } from '@playwright/test';

/** The page-side release a hold leaves behind: it resolves once every held animation is drawing again. */
export interface HeldScrollDriven { readonly release: () => Promise<void> }

/**
 * Holds every animation on a scroll's timeline at the values it draws now, for a screenshot taken with `animations: 'disabled'`:
 * Playwright finishes or cancels every animation for that capture, and one on a scroll's timeline (the phone hand's card poses,
 * engine/ui/cards/Hand.tsx `animatePoses`) is then drawn as though it were not there, unlike the page a player sees and the boxes a
 * measurement read from it. Each such animation's properties are written on its element as they are computed now, and the animation
 * is canceled. The returned release takes them off and plays each animation again on the timeline it still has, and returns once
 * each is drawing: an animation played again draws nothing until its next frame, and a hold taken before then would hold the
 * element unanimated. The release is also the page's (`kbHeldScrollDriven.release()`), so it can be awaited in the page.
 */
export async function holdScrollDriven(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const held: { animation: Animation; el: HTMLElement; props: string[] }[] = [];
    for (const animation of document.getAnimations()) {
      const effect = animation.effect as KeyframeEffect | null;
      const el = effect?.target as HTMLElement | null;
      if (animation.timeline === document.timeline || !effect || !el) continue;
      const props = [...new Set(effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p)))]
        .map((p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
      const now = getComputedStyle(el);
      const values = props.map((p) => now.getPropertyValue(p));
      animation.cancel();
      props.forEach((p, i) => el.style.setProperty(p, values[i]!, 'important'));
      held.push({ animation, el, props });
    }
    const release = async () => {
      for (const { animation, el, props } of held) {
        for (const p of props) el.style.removeProperty(p);
        animation.play();
      }
      await Promise.all(held.map(({ animation }) => animation.ready));
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    };
    (globalThis as { kbHeldScrollDriven?: HeldScrollDriven }).kbHeldScrollDriven = { release };
  });
  return () => page.evaluate(() => (globalThis as { kbHeldScrollDriven?: HeldScrollDriven }).kbHeldScrollDriven?.release());
}
