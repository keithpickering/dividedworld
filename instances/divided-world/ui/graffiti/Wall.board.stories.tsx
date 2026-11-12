/**
 * Graffiti's wall on posts #41 and #42 of the boards fixture, as stories for the owner (docs/plans/2026-11-11-graffiti-plan.md, Task 12; the mockup they are set
 * against is docs/research/2026-11-11-graffiti/01-tool-styles.html, style D, the glass with drawn cans). `Drawing` is the mockup's moment: a wall at 31% of its
 * 40% limit on #42 that Mrs. Hooligan tagged earlier, and the reader's Draw tile pressed, so the toolbar is open under the post with a cyan stroke
 * in progress, the pointer still down. `UnderASplat` is #41 with the fixture's Whoops! over the same wall: the splat always covers the paint, so the wall shows
 * through only where the splat has none. No board draws these. Open each at 1200 by 900, and its `Phone` twin at 360 by 800.
 *
 * The wall is handed to the fake through its seed before the thread is read: Gloomba's play of the card, then Mrs. Hooligan's tag as a real draw (the fake runs
 * the surface model, so the figure the toolbar reads is the engine's). The stroke in progress is sent to the drawing surface as the pointer events a mouse
 * makes, with no release, so the toolbar's meter reads the cells it would add.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';
import type { Can, Cap } from '../../cards/graffiti.ts';

const MINUTE = 60_000;
/** The aspect the seeded strokes are drawn at (a body three times as wide as it is tall); the cells they cover are shares of the box, so any body reads the same figure. */
const ASPECT = 3;

/** A wave across the body, `n` points from `x0` to `x1` about the height `y`: a stroke with no two points on a line. */
function wave(y: number, x0: number, x1: number, amp: number, n = 24): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [Math.round((x0 + (x1 - x0) * t) * 1e4) / 1e4, Math.round((y + amp * Math.sin(t * Math.PI * 2)) * 1e4) / 1e4] as [number, number];
  });
}

/** Five strokes that cover 3,140 of the grid's 10,000 cells, which the toolbar and the Lens say as "31%". */
const TAG: readonly { can: Can; cap: Cap; aspect: number; points: [number, number][] }[] = [
  { can: 'red', cap: 'fat', aspect: ASPECT, points: wave(0.3, 0.04, 0.7, 0.08) },
  { can: 'orange', cap: 'fat', aspect: ASPECT, points: wave(0.62, 0.2, 0.9, 0.1) },
  { can: 'pink', cap: 'stock', aspect: ASPECT, points: wave(0.82, 0.05, 0.6, 0.06) },
  { can: 'lime', cap: 'fat', aspect: ASPECT, points: wave(0.12, 0.4, 0.95, 0.05) },
  { can: 'purple', cap: 'fat', aspect: ASPECT, points: wave(0.45, 0.05, 0.54, 0.12) },
];

/** Hand post `post` a Graffiti wall, drawn on, then say the thread is ready to be read. */
function useSeeded(thread: string | null, post: number): boolean {
  const { api, instance } = useKayfa();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      /* Every card met, so no callout hangs off a mark. */
      for (const c of instance.cards) await api.meetCard(c.key);
      const acts = await api.acts(thread, 40, 46);
      const target = acts.find((a) => a.seq === post);
      const caster = acts.find((a) => a.seq === 45)?.character ?? null;
      const drawer = acts.find((a) => a.seq === 40)?.character ?? null;
      if (!target || !caster || !drawer) throw new Error(`the boards fixture has no #${post}, or no author of #40 or #45`);
      fake.clock.advance(MINUTE);
      const play = fake.seed.card(caster, target.id, 'graffiti', { layer: 2 });
      const drawn = await api.draw(play, drawer, { strokes: TAG });
      if (!drawn.ok) throw new Error(`the tag was refused: ${drawn.error}`);
      /* The story's name is its figure: a wall that is not 31% is a story that says what it is not. */
      const covered = (await api.surfaceActs(play))?.covered;
      if (covered === undefined || Math.floor(covered / 100) !== 31) throw new Error(`the Graffiti wall story's wall is ${covered === undefined ? 'unread' : `${Math.floor(covered / 100)}%`}, not 31%`);
      if (live) setReady(true);
      /* A seed or a draw refused leaves the story loading (aria-busy), and says why, rather than drawing a state its name does not. */
    })().catch((e: unknown) => { console.error('the Graffiti wall story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, post]);
  return ready;
}

/**
 * Presses the post's Draw tile once the wall is drawn and puts a cyan stroke in progress on the drawing surface, as a mouse does: a press, then moves, and no release. The
 * surface holds a pointer it was never given, so it is handed a capture that does nothing (the real one needs a pointer the browser knows).
 */
function Look({ drawing, post: n }: { readonly drawing: boolean; readonly post: number }) {
  useEffect(() => {
    /* The phone's toolbar is fixed to the foot, so the post is put at the top of the window above it. */
    const place: ScrollLogicalPosition = window.matchMedia?.('(max-width: 719px)').matches ? 'start' : 'center';
    let tiled = false;
    const moves: ReturnType<typeof setTimeout>[] = [];
    const timer = setInterval(() => {
      const post = document.getElementById(`post-${n}`);
      if (!post) return;
      if (!drawing) {
        clearInterval(timer);
        post.scrollIntoView?.({ block: place });
        return;
      }
      if (!tiled) {
        const tile = post.querySelector<HTMLElement>('.kb-graffiti-draw');
        if (!tile) return;
        post.scrollIntoView?.({ block: place });
        tile.click();
        tiled = true;
        return;
      }
      const surface = post.querySelector<HTMLElement>('[data-kb-draw-surface]');
      /* jsdom, where the stories are swept for accessibility, has no pointer events; the story rests at the open toolbar there. */
      if (!surface || typeof PointerEvent !== 'function') return;
      clearInterval(timer);
      surface.setPointerCapture = () => {};
      const r = surface.getBoundingClientRect();
      const at = (x: number, y: number, type: string) => surface.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, clientX: r.left + x * r.width, clientY: r.top + y * r.height,
      }));
      const path = wave(0.72, 0.58, 0.9, 0.16, 16);
      path.forEach(([x, y], i) => moves.push(setTimeout(() => at(x, y, i === 0 ? 'pointerdown' : 'pointermove'), i * 30)));
    }, 100);
    return () => { clearInterval(timer); for (const m of moves) clearTimeout(m); };
  }, [drawing, n]);
  return null;
}

function Wall({ drawing, post }: { readonly drawing: boolean; readonly post: number }) {
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, post);
  return (
    <Frame>
      <Look drawing={drawing} post={post} />
      {thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Wall> = {
  title: 'Boards/01 Graffiti wall',
  component: Wall,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Wall>;
const phone = { parameters: { moment: '02-phone' } } as const;

/** The mockup's moment: a wall at 31%, the toolbar open under #42, a cyan stroke in progress. */
export const Drawing: Story = { args: { drawing: true, post: 42 } };
export const DrawingPhone: Story = { args: { drawing: true, post: 42 }, ...phone };
/** The same wall under the fixture's Whoops! splat on #41: the splat covers the paint. */
export const UnderASplat: Story = { args: { drawing: false, post: 41 } };
export const UnderASplatPhone: Story = { args: { drawing: false, post: 41 }, ...phone };
