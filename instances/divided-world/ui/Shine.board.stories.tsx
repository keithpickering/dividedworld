/**
 * A busy thread for the shine loop (docs/plans/2026-11-06-shine-plan.md, Task 11): seventeen posts of the boards fixture's thread at
 * the Main board's moment, #41 to #57, sixteen of them shiny (four of each Feelin' Fab level, four Glitter Bomb, in turn) and the
 * last one plain. The plan's "12 posts" does not add up with its own list (4 x 3 + 4 + 1); this story builds the list. At 1200 by 900
 * about five are in view, and the rest wait their turn below. `Still` is the same page under reduced motion.
 *
 * The story page hands e2e/shine.spec.ts the loop's probe as `window.__kbShine`: each shiny post's draws, its place on the page (in
 * document order) and its size in device px, both the box it paints (its first canvas's: the post's whole body, engine/ui/cards/body.ts), the loop's frame count and whether it runs, the size of every canvas each post holds
 * (`held`), and the canvas pixels the 2D contexts have rastered (`raster`, below). The application exposes nothing.
 *
 * A Feelin' Fab is drawn in a worker where the browser can (engine/ui/shine/foilClient.ts), a Glitter Bomb on the page, so every
 * instrument reads both threads. The story gives the foil its own worker entry (shine-probe.worker.ts: the foil server plus a pixel
 * counter and the worker-side poisons) with `setFoilWorker` before any post mounts. A transferred canvas cannot be read from the
 * page, so `held` asks the worker for the Fab canvases' sizes; `workerWork` is the worker's own time per batch, the cost of the foil
 * that the loop's own time no longer includes; and a frame's rastered pixels are the page's plus the worker's for the batch with the
 * same `t`, the animation frame's timestamp.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../engine/ui/context.tsx';
import type { Fake } from '../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../engine/ui/router.tsx';
import { probe } from '../../../engine/ui/shine/loop.ts';
import { foilProbe, setFoilWorker } from '../../../engine/ui/shine/foilClient.ts';
import { LoadedThread } from '../../../engine/ui/loaded.tsx';
import { countRaster, type Counter, type RasterFrame, type StoryAnswer, type StoryAsk } from './shine-probes.ts';

declare global {
  interface Window {
    __kbPoison?: string;
    __kbShine?: {
      /**
       * Every shiny post on the page, top to bottom: the loop's draws of it, the box it paints in the viewport (its width too, in CSS
       * px) and its area in device px, its words' own box in the viewport, and the share of the loop's rate it is drawn at.
       */
      hosts: () => { draws: number; top: number; bottom: number; width: number; area: number; own: { top: number; bottom: number; width: number }; share: number }[];
      frames: () => number;
      /** The loop's own time in each of its last `n` frames, in milliseconds. */
      work: (n: number) => number[];
      /** The foil worker's own time in each of its last `n` batches (oldest first, ms) and how many batches it has drawn in all; none where there is no worker. */
      workerWork: (n: number) => Promise<{ batches: number; work: number[] }>;
      running: () => boolean;
      /** Every shiny post's box and the size of each canvas inside it, a worker's canvases read from the worker (a transferred canvas's own attributes say nothing). */
      held: () => Promise<{ top: number; bottom: number; area: number; own: number; sizes: { w: number; h: number }[]; shine: { w: number; h: number }[] }[]>;
      /**
       * Counting the canvas pixels the 2D contexts raster (shine-probes.ts, on the page and in the worker): `start` patches the contexts
       * (a timed run leaves it off, so the count costs the loop nothing there), `take` gives the page's pixels since the last take (all
       * of them, and those a drawImage scaled at 'high' smoothing quality), `worker` gives the worker's pixels by batch (the `t` of the
       * frame each belongs to), `stop` puts the contexts back.
       */
      raster: { start: () => void; take: () => { px: number; high: number }; worker: () => Promise<RasterFrame[]>; stop: () => void };
    };
  }
}

const SHINY = '[data-kb-fab], [data-kb-glitter]';

/**
 * Story-only poisons for e2e/shine.spec.ts, which plants each to see its check go red (a guard never red is not known to work).
 * `window.__kbPoison` is set by the spec before the page loads (the app rewrites its address, so a query would not survive). Nothing
 * but this story reads the flag, and without it nothing is patched.
 *  - `'slow'`: every Glitter Bomb post's first canvas costs 25 ms every time it is drawn on (a busy-wait in `getContext`, which the
 *    effect calls on each paint). A Feelin' Fab is no longer drawn on the page, so the page-side cost is planted on a Glitter Bomb. It
 *    was one post's until its body was drawn at a share of the rate (issue #304): one post drawn on a frame in three or four no longer
 *    held the frame gap's 95th percentile, though it still held the loop's own time; every glitter post in view holds both.
 *  - `'slow-worker'`: every batch the foil worker draws takes 25 ms more (shine-probe.worker.ts).
 *  - `'keep'`: the first shiny post's canvas ignores being freed (a width or height of 0), in the worker where its canvas lives.
 */
function plant(poison: string | null): () => void {
  if (poison === 'slow') {
    const proto = HTMLCanvasElement.prototype, get = proto.getContext;
    proto.getContext = function (this: HTMLCanvasElement, ...a: Parameters<typeof get>) {
      const host = this.closest('[data-kb-glitter]');
      if (host !== null && host.querySelector('canvas') === this) {
        for (const until = performance.now() + 25; performance.now() < until;) { /* busy */ }
      }
      return get.apply(this, a);
    } as typeof get;
    return () => { proto.getContext = get; };
  }
  if (poison === 'keep') {
    /* Once the first shiny post's canvas has been handed over, tell the worker which canvas it is. */
    const timer = setInterval(() => {
      const cv = document.querySelector(SHINY)?.querySelector('canvas'), w = foilProbe.worker();
      const id = cv ? foilProbe.idOf(cv) : undefined;
      if (id === undefined || !w) return;
      w.postMessage({ kind: 'story', what: 'poison', poison: 'keep', id } satisfies StoryAsk);
      clearInterval(timer);
    }, 20);
    return () => clearInterval(timer);
  }
  return () => {};
}

/** The story's worker: the foil server with this story's instruments (shine-probe.worker.ts), told its poison at birth. */
function probeWorker(poison: string | null): () => Worker {
  return () => {
    const w = new Worker(new URL('./shine-probe.worker.ts', import.meta.url), { type: 'module' });
    if (poison === 'slow-worker') w.postMessage({ kind: 'story', what: 'poison', poison: 'slow-worker' } satisfies StoryAsk);
    return w;
  };
}

let asked = 0;
/** What the story worker rastered, by batch; none where there is no worker. */
function workerRaster(): Promise<RasterFrame[]> {
  const w = foilProbe.worker();
  if (!w) return Promise.resolve([]);
  return new Promise((resolve) => {
    const nonce = ++asked;
    const on = (e: MessageEvent): void => {
      const m = e.data as Partial<StoryAnswer> | null;
      if (m?.kind !== 'story' || m.nonce !== nonce) return;
      w.removeEventListener('message', on);
      resolve([...(m.frames ?? [])]);
    };
    w.addEventListener('message', on);
    w.postMessage({ kind: 'story', what: 'frames', nonce } satisfies StoryAsk);
  });
}

/**
 * Every shiny post's painted box, its own box (the words' element, which a post's pixels are held to: engine/ui/cards/body.ts
 * `paintScale`) and its canvases' sizes: a canvas handed to the worker is read there, any other from its own attributes.
 */
async function held(): Promise<{ top: number; bottom: number; area: number; own: number; sizes: { w: number; h: number }[]; shine: { w: number; h: number }[] }[]> {
  const worked = await foilProbe.sizes();
  return [...document.querySelectorAll(SHINY)].map((el) => {
    const r = painted(el);
    const sizeOf = (c: HTMLCanvasElement) => {
      const there = worked.get(c);
      if (there) return there;
      if (foilProbe.idOf(c) !== undefined) throw new Error('a canvas handed to the foil worker is not in the worker\'s list: the buffer check would read its placeholder');
      return { w: c.width, h: c.height };
    };
    const sizes = [...el.querySelectorAll('canvas')].map(sizeOf);
    /* The shine effect's own canvases, without another card's drawn inside its words (#41 carries Whoops!'s ink too). */
    const shine = [...el.querySelectorAll<HTMLCanvasElement>(':scope > canvas.dw-fab-foil, :scope > .dw-glitter-surface > canvas')].map(sizeOf);
    const o = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, area: r.width * r.height, own: o.width * o.height, sizes, shine };
  });
}

/** The box a shiny post paints, its first canvas's: the post's whole body in the thread, not the words' own box (engine/ui/cards/body.ts). */
function painted(el: Element): DOMRect {
  return (el.querySelector('canvas') ?? el).getBoundingClientRect();
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
  /* Before any post mounts (they wait for the thread to be seeded): the foil is drawn by this story's worker, and put back on unmount. */
  useEffect(() => {
    setFoilWorker(probeWorker(window.__kbPoison ?? null));
    return () => { setFoilWorker(null); };
  }, []);
  useEffect(() => plant(window.__kbPoison ?? null), []);
  useEffect(() => {
    let raster: Counter | null = null;
    const tell = (on: boolean): void => { foilProbe.worker()?.postMessage({ kind: 'story', what: 'raster', on } satisfies StoryAsk); };
    window.__kbShine = {
      hosts: () => [...document.querySelectorAll(SHINY)].map((el) => {
        const r = painted(el), o = el.getBoundingClientRect(), d = window.devicePixelRatio || 1;
        return {
          draws: probe.draws(el), top: r.top, bottom: r.bottom, width: r.width, area: r.width * r.height * d * d,
          own: { top: o.top, bottom: o.bottom, width: o.width }, share: probe.share(el),
        };
      }),
      frames: probe.frames,
      work: (n) => probe.work(n),
      workerWork: (n) => foilProbe.work(n),
      running: probe.running,
      held,
      raster: {
        start: () => { raster ??= countRaster(CanvasRenderingContext2D.prototype); tell(true); },
        take: () => raster?.take() ?? { px: 0, high: 0 },
        worker: workerRaster,
        stop: () => { raster?.stop(); raster = null; tell(false); },
      },
    };
    return () => { raster?.stop(); tell(false); delete window.__kbShine; };
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
