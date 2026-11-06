/**
 * A busy thread for the shine loop (docs/plans/2026-11-06-shine-plan.md, Task 11): seventeen posts of the boards fixture's thread at
 * the Main board's moment, #41 to #57, sixteen of them shiny (four of each Feelin' Fab level, four Glitter Bomb, in turn) and the
 * last one plain. The plan's "12 posts" does not add up with its own list (4 x 3 + 4 + 1); this story builds the list. At 1200 by 900
 * about five are in view, and the rest wait their turn below. `Still` is the same page under reduced motion.
 *
 * The story page hands e2e/shine.spec.ts the loop's probe as `window.__kbShine`: each shiny post's draws, its place on the page (in
 * document order) and its size in device px, the loop's frame count and whether it runs, and the canvas pixels the page's 2D contexts
 * have rastered since it last asked (`raster`, below). The application exposes nothing.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../engine/ui/context.tsx';
import type { Fake } from '../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../engine/ui/router.tsx';
import { probe } from '../../../engine/ui/shine/loop.ts';
import { LoadedThread } from '../../../engine/ui/loaded.tsx';

declare global {
  interface Window {
    __kbPoison?: string;
    __kbShine?: {
      /** Every shiny post on the page, top to bottom: the loop's draws of it, its box in the viewport and its area in device px. */
      hosts: () => { draws: number; top: number; bottom: number; area: number }[];
      frames: () => number;
      /** The loop's own time in each of its last `n` frames, in milliseconds. */
      work: (n: number) => number[];
      running: () => boolean;
      /**
       * Counting the canvas pixels the page's 2D contexts raster (`countRaster`): `start` patches the contexts (a timed run leaves it
       * off, so the count costs the loop nothing there), `take` gives the pixels since the last take (all of them, and those a
       * drawImage scaled at 'high' smoothing quality), `stop` puts the contexts back.
       */
      raster: { start: () => void; take: () => { px: number; high: number }; stop: () => void };
    };
  }
}

const SHINY = '[data-kb-fab], [data-kb-glitter]';

/**
 * Story-only poisons for e2e/shine.spec.ts, which plants each to see its check go red (a guard never red is not known to work).
 * `window.__kbPoison = 'slow'` (set by the spec before the page loads; the app rewrites its address, so a query would not survive) makes the third shiny post's canvas cost 25 ms every time it is drawn on (a busy-wait in `getContext`, which both
 * effects call on each paint); `'keep'` makes the first shiny post's canvases ignore being freed (a width or height of 0).
 * Nothing but this story reads the flag, and without it nothing is patched.
 */
function plant(poison: string | null): () => void {
  if (poison !== 'slow' && poison !== 'keep') return () => {};
  const proto = HTMLCanvasElement.prototype;
  const nth = (cv: HTMLCanvasElement, n: number) => { const host = cv.closest(SHINY); return host !== null && [...document.querySelectorAll(SHINY)].indexOf(host) === n; };
  if (poison === 'slow') {
    const get = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement, ...a: Parameters<typeof get>) {
      if (nth(this, 2)) for (const until = performance.now() + 25; performance.now() < until;) { /* busy */ }
      return get.apply(this, a);
    } as typeof get;
    return () => { proto.getContext = get; };
  }
  const undo: (() => void)[] = [];
  for (const key of ['width', 'height'] as const) {
    const d = Object.getOwnPropertyDescriptor(proto, key)!;
    Object.defineProperty(proto, key, { ...d, set(this: HTMLCanvasElement, v: number) { if (v === 0 && nth(this, 0)) return; d.set!.call(this, v); } });
    undo.push(() => Object.defineProperty(proto, key, d));
  }
  return () => undo.forEach((u) => u());
}

/**
 * Counts the canvas pixels the page's 2D contexts raster: the area each clearRect, fillRect, putImageData and drawImage covers, in the
 * canvas's own px (its transform's scale applied), and a drawImage no larger than the clip it is drawn in when the clip is a set of
 * rects (`rect` then `clip`). The pixels a drawImage scales with 'high' smoothing quality are counted apart too: that filter costs
 * far more a pixel than bilinear. A browser rasters what a frame's draws cover when it produces the frame, and then hands each
 * changed canvas to the compositor; a frame that clears and redraws whole post-sized canvases on every shiny post in view, or scales
 * them at 'high', costs a slow machine its frame, which the loop's own time never shows (e2e/shine.spec.ts). Story-only: it patches
 * the prototype from `start` until `stop`.
 */
function countRaster(): { take: () => { px: number; high: number }; stop: () => void } {
  const proto = CanvasRenderingContext2D.prototype;
  let total = 0, high = 0;
  const clips = new WeakMap<CanvasRenderingContext2D, { pending: number; clip: number; stack: number[] }>();
  const of = (c: CanvasRenderingContext2D) => { let s = clips.get(c); if (!s) { s = { pending: 0, clip: Infinity, stack: [] }; clips.set(c, s); } return s; };
  const scale = (c: CanvasRenderingContext2D) => { const m = c.getTransform(); return Math.abs(m.a * m.d - m.b * m.c); };
  const orig = {
    clearRect: proto.clearRect, fillRect: proto.fillRect, putImageData: proto.putImageData, drawImage: proto.drawImage,
    beginPath: proto.beginPath, rect: proto.rect, clip: proto.clip, save: proto.save, restore: proto.restore,
  };
  const area = (c: CanvasRenderingContext2D, w: number, h: number) => Math.min(Math.abs(w * h) * scale(c), c.canvas.width * c.canvas.height);
  proto.clearRect = function (this: CanvasRenderingContext2D, x, y, w, h) { total += area(this, w, h); orig.clearRect.call(this, x, y, w, h); };
  proto.fillRect = function (this: CanvasRenderingContext2D, x, y, w, h) { total += area(this, w, h); orig.fillRect.call(this, x, y, w, h); };
  proto.putImageData = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
    const img = a[0] as ImageData;
    total += img.width * img.height;
    (orig.putImageData as (...b: unknown[]) => void).apply(this, a);
  };
  proto.drawImage = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
    const n = a.length, img = a[0] as { width: number; height: number };
    const [w, h] = n >= 9 ? [a[7] as number, a[8] as number] : n >= 5 ? [a[3] as number, a[4] as number] : [img.width, img.height];
    const [sw, sh] = n >= 9 ? [a[3] as number, a[4] as number] : [img.width, img.height];
    const px = Math.min(area(this, w, h), of(this).clip);
    total += px;
    if (this.imageSmoothingEnabled && this.imageSmoothingQuality === 'high' && px > Math.abs(sw * sh) * 1.5) high += px;
    (orig.drawImage as (...b: unknown[]) => void).apply(this, a);
  };
  proto.beginPath = function (this: CanvasRenderingContext2D) { of(this).pending = 0; orig.beginPath.call(this); };
  proto.rect = function (this: CanvasRenderingContext2D, x, y, w, h) { of(this).pending += area(this, w, h); orig.rect.call(this, x, y, w, h); };
  proto.clip = function (this: CanvasRenderingContext2D, ...a: unknown[]) { const s = of(this); s.clip = Math.min(s.clip, s.pending); (orig.clip as (...b: unknown[]) => void).apply(this, a); };
  proto.save = function (this: CanvasRenderingContext2D) { const s = of(this); s.stack.push(s.clip); orig.save.call(this); };
  proto.restore = function (this: CanvasRenderingContext2D) { const s = of(this); s.clip = s.stack.pop() ?? Infinity; orig.restore.call(this); };
  return {
    take: () => { const t = { px: total, high }; total = 0; high = 0; return t; },
    stop: () => { Object.assign(proto, orig); },
  };
}

interface Args { readonly reduced: boolean }

function Busy({ reduced }: Args) {
  const { api } = useKayfa();
  const [ready, setReady] = useState(false);
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', 'light');
    root.setAttribute('data-kb-motion', reduced ? 'reduce' : 'full');
    return () => { root.removeAttribute('data-kb-mode'); root.removeAttribute('data-kb-motion'); };
  }, [reduced]);
  useEffect(() => plant(window.__kbPoison ?? null), []);
  useEffect(() => {
    let raster: ReturnType<typeof countRaster> | null = null;
    window.__kbShine = {
      hosts: () => [...document.querySelectorAll(SHINY)].map((el) => {
        const r = el.getBoundingClientRect(), d = window.devicePixelRatio || 1;
        return { draws: probe.draws(el), top: r.top, bottom: r.bottom, area: r.width * r.height * d * d };
      }),
      frames: probe.frames,
      work: (n) => probe.work(n),
      running: probe.running,
      raster: {
        start: () => { raster ??= countRaster(); },
        take: () => raster?.take() ?? { px: 0, high: 0 },
        stop: () => { raster?.stop(); raster = null; },
      },
    };
    return () => { raster?.stop(); delete window.__kbShine; };
  }, []);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const [[target], [caster]] = await Promise.all([api.acts(thread, 41, 41), api.acts(thread, 42, 42)]);
      if (!target?.character || !caster?.character) return;
      const fake = api as Fake;
      /* Glitter Bomb sparkles every post of the character it is cast on, so the four glitter posts are a character's of their own. */
      const sparkly = fake.seed.character(fake.seed.account('Glitterer'), 'Sparkles', 'face');
      /* The fixture has #41 to #46; eleven more make seventeen: four by the sparkly character, the last one plain. */
      const mine: string[] = [];
      for (let i = 0; i < 11; i += 1) {
        const by = i % 2 === 1 && i < 8 ? sparkly : target.character;
        const id = fake.seed.post(thread, by, `Post ${i + 47} of the busy thread. ${'The shine sits under these words, which must stay readable as it moves. '.repeat(1 + (i % 3))}`);
        if (by === sparkly) mine.push(id);
      }
      const page = (await api.acts(thread, 41, 57)).filter((a) => a.kind === 'post');
      let fabbed = 0;
      page.forEach((post, i) => {
        if (post.character === sparkly || i === page.length - 1) return;
        /* Played on by a character that is not its author, at levels one to three in turn. */
        const from = post.character === caster.character ? target.character! : caster.character!;
        for (let layer = 1; layer <= (fabbed % 3) + 1; layer += 1) fake.seed.card(from, post.id, 'feelin-fab', { layer, config: {}, message: `Fab ${layer}` });
        fabbed += 1;
      });
      fake.seed.reach(caster.character, 'character', sparkly, 'glitter-bomb', { post: mine[0]!, ends: Date.now() + 5 * 86_400_000, message: 'Sparkle.' });
      /* The page is drawn once everything is seeded, as the page reads plays on a character when it loads. */
      if (live) setReady(true);
    })().catch((e: unknown) => { console.error('the busy thread could not be seeded', e); });
    return () => { live = false; };
  }, [api, thread]);
  return <Frame>{thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Busy> = {
  title: 'Boards/15 Shine',
  component: Busy,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { reduced: false },
};
export default meta;

type Story = StoryObj<typeof Busy>;

export const Full: Story = { args: { reduced: false } };
export const Still: Story = { args: { reduced: true } };
