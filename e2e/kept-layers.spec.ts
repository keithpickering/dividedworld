/**
 * The kept layer (docs/plans/2026-11-20-kept-layers-design.md; plan Task 2): a whole surface a motion preset enters keeps its compositor layer
 * when its entrance ends. Without it, Chromium destroys the layer the entrance gave the surface and makes what it held into new layers, and
 * Chrome on Android drew those blank for a frame or two (the Lens showed its ground with nothing on it, on the owner's phone). Headless Chromium
 * does not draw the blank frames, so this cannot see them; it reads the cause instead, through the layer tree (CDP `LayerTree`): the surface's
 * own layer, read while its entrance runs, is the same layer once it is at rest.
 *
 * Each case runs under Smooth and under Snappy, at full motion. The Lens is the case the owner saw, at a phone's width and a desktop's; a glass
 * screen changing is the other kind of surface the presets keep.
 */
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { settled } from './settled.ts';

interface Layer { readonly layerId: string; readonly backendNodeId?: number }

/** The page's layer tree as Chromium last reported it, kept current. */
async function watchLayers(page: Page): Promise<{ cdp: CDPSession; layerOf: (selector: string) => Promise<string | null> }> {
  const cdp = await page.context().newCDPSession(page);
  let layers: readonly Layer[] = [];
  cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: Layer[] }) => { if (e.layers) layers = e.layers; });
  await cdp.send('DOM.enable');
  await cdp.send('LayerTree.enable');
  /** The id of the layer the element at `selector` paints into as its own, or null where it has none. Read two frames on, so the tree has caught up. */
  const layerOf = async (selector: string) => {
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (!nodeId) return null;
    const { node } = await cdp.send('DOM.describeNode', { nodeId });
    return layers.find((l) => l.backendNodeId === node.backendNodeId)?.layerId ?? null;
  };
  return { cdp, layerOf };
}

async function feel(page: Page, name: 'smooth' | 'snappy') {
  await page.evaluate((f) => {
    document.documentElement.setAttribute('data-kb-motion', 'full');
    document.documentElement.setAttribute('data-kb-motion-feel', f);
  }, name);
}

/**
 * Waits until the element at `selector` is on the page with an entrance running on it: a Web Animation (Smooth), or Motion's own frame loop
 * writing it inline (Snappy's mask, which the Web Animations API cannot run, and its spring), seen as an inline mask or transform not yet at rest.
 */
async function entering(page: Page, selector: string) {
  await page.waitForFunction((s) => {
    const el = document.querySelector<HTMLElement>(s);
    if (!el) return false;
    if (el.getAnimations().some((a) => a.playState === 'running')) return true;
    const mask = el.style.maskImage || el.style.getPropertyValue('-webkit-mask-image');
    return (mask !== '' && mask !== 'none') || (el.style.transform !== '' && el.style.transform !== 'none');
  }, selector, { timeout: 5_000, polling: 'raf' });
}

/** The surface's layer while its entrance runs and once it is at rest. */
async function layersAcross(page: Page, layerOf: (s: string) => Promise<string | null>, selector: string, start: () => Promise<void>) {
  await start();
  await entering(page, selector);
  const during = await layerOf(selector);
  await settled(page, { loops: true });
  await page.waitForTimeout(300);
  const after = await layerOf(selector);
  return { during, after };
}

const LENS = '/?fixture=boards&story=boards-01-lens--five-kinds';
const LENS_BOX = '.kb-float-box.kb-lens';

for (const name of ['smooth', 'snappy'] as const) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    test(`the Lens keeps its layer when its entrance ends (${name}, ${viewport.width})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(LENS);
      await expect(page.getByRole('dialog', { name: 'Cards on this post' })).toBeVisible({ timeout: 15_000 });
      /* The story's Lens enters as the page loads: the feel is changed only once it is at rest, since a change mid-entrance freezes it part-way (#837). */
      await settled(page, { loops: true });
      await feel(page, name);
      /* Closed by Esc, focus is back on its mark; Enter opens it again, now under the feel. */
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Cards on this post' })).toHaveCount(0);
      /* Hidden from the first frame of its exit, it is still on the page until the exit ends; reopened before that, Snappy leaves it at the exit's opacity (#837). */
      await expect(page.locator('[data-kb-exiting]')).toHaveCount(0);
      const { layerOf } = await watchLayers(page);
      const { during, after } = await layersAcross(page, layerOf, LENS_BOX, () => page.keyboard.press('Enter'));
      expect(during, 'the Lens has a layer while it enters').not.toBeNull();
      expect(after, 'the Lens has the same layer at rest').toBe(during);
    });
  }

  test(`a glass screen keeps its layer when it changes (${name})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/b/general');
    await page.locator('.kb-hud button', { hasText: 'Menu' }).first().click();
    await expect(page.locator('.kb-glass-menu')).toBeVisible({ timeout: 15_000 });
    await settled(page, { loops: true });
    await feel(page, name);
    const { layerOf } = await watchLayers(page);
    const arriving = '.kb-glass-screen:not([data-kb-exiting])';
    const { during, after } = await layersAcross(page, layerOf, arriving, () => page.locator('.kb-glass-menu-tab', { hasText: 'Season' }).click());
    expect(during, 'the screen has a layer while it enters').not.toBeNull();
    expect(after, 'the screen has the same layer at rest').toBe(during);
  });
}
