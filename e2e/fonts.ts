import type { Page } from '@playwright/test';

/**
 * Wait until the page's faces are loaded, and say which one failed when one does not. `document.fonts.ready` alone resolves at once when no face has
 * been asked for yet, which is the case while a title that sets in the display face has not mounted: whatever is measured next is set in the fallback
 * (Anton's fallback breaks `character` inside the word at 200% text on a phone, glass-layout.spec.ts). So every face in the font set is asked for here,
 * where it stands, and a face that ends in `error` (the file did not come), or is still loading after 15 seconds, is an error naming it: a
 * measurement made in a fallback is not a finding about the layout.
 */
export async function loadFaces(page: Page): Promise<void> {
  const failed = await page.evaluate(async () => {
    const faces = [...document.fonts];
    /* Bounded, so a face whose request never answers is named here rather than left to the test's own timeout. */
    const within = (p: Promise<unknown>) => Promise.race([p, new Promise((done) => setTimeout(done, 15_000))]);
    await within(Promise.allSettled(faces.map((f) => f.load())));
    await within(document.fonts.ready);
    return faces.filter((f) => f.status === 'error' || f.status === 'loading').map((f) => `${f.family} ${f.weight} ${f.style} (${f.status})`);
  });
  if (failed.length > 0) throw new Error(`a font did not load, so the page was measured in its fallback: ${failed.join('; ')}`);
}
