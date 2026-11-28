/**
 * Hot Box as stories for the owner's word (docs/plans/2026-11-15-hot-box-plan.md, Task 7; design, section 2.2): post #43 of the boards fixture at the
 * Main board's moment (the one post of the page that carries no Whoops! ink over its words, so the smoke's pixels are the only thing over them), under a
 * Hot Box that #42's author played, in hot pink (#ff69b4). The story route renders no play function, so e2e/hot-box.spec.ts moves the pointer and holds the
 * control itself.
 *
 * `FreshLight` and `FreshDark` are the smoke as it lands, at full strength, on the light board and on the dark. `Thinning` is the same post two and a
 * half days in, with half a day left, so the fog has thinned most of the way to its least. `LongPost` gives the post twelve paragraphs with a link in the
 * ninth, which the smoke makes inert until a sweep is held to its end. `Reduced` is the fresh smoke with motion reduced (`data-kb-motion="reduce"`), where
 * nothing drifts and a clearing opens and closes with no steps between. Open them at 1440 by 1120.
 *
 * `Parted` is the fog with a mouse parked on the post's second line and a trail behind it. The story route renders no play function, so the story drives the
 * pointer itself: it dispatches a short run of `pointermove` events along the second line (40 ms apart, the last the parked point) and runs it again every
 * second, so the trail (the wake of `SMOKE.wake`, 1.5 s) is always in the picture. That is the one thing here that depends on a clock: the events are the
 * page's, read against `api.now()`, so a tool that holds the page's clock still holds the pointer where its last run left it and the wake as it stood.
 * `FoldUnderSmoke` is the post under Below the Fold (played first) and then Hot Box: the fold's bar is under the smoke like the words, and neither looks nor is
 * pressable until the post is waved. `Degraded` draws the fog at the ladder's last rung (`forceFogLevel(4)`: the fog drawn from the model with no field), put
 * back when the story goes, so it cannot reach another story.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';
import { cardOf } from '../../../../engine/ui/story.tsx';
import { probe } from '../../../../engine/ui/cards/tileLoop.ts';
import { forceFogLevel } from './Effect.tsx';

declare global {
  interface Window {
    /** The tile loop's probe (engine/ui/cards/tileLoop.ts), for e2e/hot-box.spec.ts's cost cases: the one measure the budget stories hand over, not another. */
    __kbTiles?: typeof probe;
    /** Draws every smoked post at this rung (null gives each its own back), so e2e/hot-box.spec.ts can measure each rung alone. */
    __dwFogLevel?: typeof forceFogLevel;
  }
}

const DAY = 86_400_000;
/** The smoke's color in every story: hot pink, as hex (the named list `color()` reads has no `hotpink`). */
const COLOR = '#ff69b4';

/** Twelve paragraphs, the ninth with a link in it: long enough that the sweep is a long hold and a reader has to find the link. */
const LONG = Array.from({ length: 12 }, (_, i) => (i === 8
  ? 'Paragraph nine has the link: the full notes are [url=https://example.com/hot-box-notes]on the notes page[/url], which is worth reading before you reply, and it goes on a little so that it takes a line or two.'
  : `Paragraph ${i + 1} of the long post. It runs on for a couple of lines so that the smoke has a good many lines to cover and a reader has a good many to clear, one patch at a time, with the pointer or a finger or a held control.`)).join('\n\n');

interface Args {
  readonly mode: 'light' | 'dark';
  /** Days into the three the smoke lasts. */
  readonly into?: number;
  readonly long?: boolean;
  readonly reduced?: boolean;
  /** A mouse parked on the second line with a trail behind it. */
  readonly parted?: boolean;
  /** Below the Fold played on the post before the smoke. */
  readonly folded?: boolean;
  /** The ladder's rung every smoked post is drawn at (4 is the fog drawn from the model alone). */
  readonly level?: number;
}

/** The moves of one run of the pointer, ms apart; the last is where it stays. */
const RUN_MOVES = 6;
const RUN_STEP_MS = 40;
/** How often the run starts again: inside the wake (`SMOKE.wake`, 1.5 s), so the trail is never gone. */
const RUN_EVERY_MS = 1000;

/**
 * Drives a mouse along the post's second line, from 60 px in to 260 px in, and parks it there, again every second. Dispatched on the content area (in a thread's row the pointer is read on the row, which holds it), where the
 * smoke reads the pointer; it waits for the post's words and for the smoke's canvas, so that the first run is not lost to a post still being drawn.
 */
function useParted(on: boolean, thread: string | null, ready: boolean) {
  useEffect(() => {
    if (!on || !ready || thread === null) return;
    /* Where the page cannot measure a line (jsdom's `Range` has no `getClientRects`, as in web/a11y.test.tsx), there is no second line to walk: do nothing, and start no timer. */
    if (typeof Range.prototype.getClientRects !== 'function') return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let every: ReturnType<typeof setInterval> | undefined;
    const secondLine = () => {
      const words = document.querySelector('#post-43 .kb-act-grid > [data-kb-content-area] [data-kb-words-box]');
      if (!words) return null;
      const tops = new Map<number, { left: number; top: number; height: number }>();
      const walk = document.createTreeWalker(words, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!(n.textContent ?? '').trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) tops.set(Math.round(r.top / 4), { left: r.left, top: r.top, height: r.height });
      }
      return [...tops.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])[1] ?? null;
    };
    const run = () => {
      const area = document.querySelector<HTMLElement>('#post-43 .kb-act-main');
      const line = secondLine();
      if (!area || !line) return;
      for (let i = 0; i < RUN_MOVES; i++) {
        const timer = setTimeout(() => {
          /* A finished timer leaves the set, so it holds only the ones still to come. */
          timers.delete(timer);
          const x = line.left + 60 + (200 * i) / (RUN_MOVES - 1), y = line.top + line.height / 2;
          area.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 1, isPrimary: true, clientX: x, clientY: y, bubbles: true }));
        }, i * RUN_STEP_MS);
        timers.add(timer);
      }
    };
    const begin = setTimeout(() => { run(); every = setInterval(run, RUN_EVERY_MS); }, 300);
    return () => { clearTimeout(begin); clearInterval(every); for (const t of timers) clearTimeout(t); timers.clear(); };
  }, [on, thread, ready]);
}

function Smoked({ mode, into = 0, long = false, reduced = false, parted = false, folded = false, level }: Args) {
  const { api, instance } = useKayfa();
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  /* The thread is drawn once the play is seeded: its page is read once, so a play seeded after the read is never drawn. */
  const [seeded, setSeeded] = useState<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    return () => { root.removeAttribute('data-kb-mode'); };
  }, [mode]);
  useEffect(() => {
    if (!reduced) return;
    document.documentElement.setAttribute('data-kb-motion', 'reduce');
    return () => { document.documentElement.removeAttribute('data-kb-motion'); };
  }, [reduced]);
  useEffect(() => {
    window.__kbTiles = probe;
    window.__dwFogLevel = forceFogLevel;
    return () => { delete window.__kbTiles; delete window.__dwFogLevel; };
  }, []);
  /* A rung forced for the story is put back when it goes: a module's own state would otherwise stay in the next story of the page. */
  useLayoutEffect(() => {
    if (level === undefined) return;
    forceFogLevel(level);
    return () => { forceFogLevel(null); };
  }, [level]);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const [[target], [caster]] = await Promise.all([api.acts(thread, 43, 43), api.acts(thread, 42, 42)]);
      if (!target?.character || !caster?.character) return;
      const fake = api as Fake;
      if (long) fake.seed.edit(target.id, target.character, LONG);
      const now = api.now();
      if (folded) fake.seed.card(caster.character, target.id, 'below-the-fold', { layer: 1, live: true, config: {}, message: 'Below the fold' });
      fake.seed.card(caster.character, target.id, cardOf(instance.cards, 'hot-box').key, {
        layer: folded ? 2 : 1, live: true, config: { color: COLOR }, message: 'Smoke out', at: now - into * DAY, ends: new Date(now + (3 - into) * DAY).toISOString(),
      });
      if (live) setSeeded(thread);
    })();
    return () => { live = false; };
  }, [api, instance, thread, into, long, folded]);
  useParted(parted, thread, seeded === thread);
  return <Frame>{thread && seeded === thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Smoked> = {
  title: 'Boards/24 Hot Box',
  component: Smoked,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { mode: 'light' },
};
export default meta;

type Story = StoryObj<typeof Smoked>;

export const FreshLight: Story = { args: { mode: 'light' } };
export const FreshDark: Story = { args: { mode: 'dark' } };
export const Thinning: Story = { args: { mode: 'light', into: 2.5 } };
export const LongPost: Story = { args: { mode: 'light', long: true } };
export const Reduced: Story = { args: { mode: 'light', reduced: true } };
export const Parted: Story = { args: { mode: 'light', parted: true } };
export const FoldUnderSmoke: Story = { args: { mode: 'light', folded: true } };
export const Degraded: Story = { args: { mode: 'light', level: 4 } };
