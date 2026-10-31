/**
 * Whoops!'s layers on one post, as stories for the owner (docs/plans/2026-10-31-plays-on-a-post-plan.md, Task 6;
 * the design's section 5): post #41 of the boards fixture, with the fixture's one layer (Mrs. Hooligan's magenta), two
 * (Spritey's yellow on top) or three (Gloomba's cyan between), each untouched, its top layer partly washed, or its
 * bottom layer washed clean. The plate's readout names the top layer, its caster and its ink in words, with its own
 * share washed, and its meter has a segment for each layer in its ink, the top first and lit. No board draws these.
 * Open each at 1440 by 1120, and its `Phone` twin at 390 by 844.
 *
 * The layers are handed to the fake through its seed before the thread is read, and a wash is saved as #41's author
 * (Spritey, the fixture's signed-in player's) saves one: strokes across the top of the splat, or a layer marked clean.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { ThreadScreen } from '../../../../engine/ui/thread/Thread.tsx';
import { BRUSH } from '../../cards/whoops/scrub.ts';

const MINUTE = 60_000;
const YELLOW = '#ffd93d';
const CYAN = '#19e3ff';

type Layers = 1 | 2 | 3;
type Washed = 'none' | 'partly' | 'bottom-clean';

/* Strokes across the top band of the layout, a brush apart: enough to wash part of a splat, never all of it. */
const PARTLY = Array.from({ length: 14 }, (_, i) => ({ tool: 'wash' as const, width: BRUSH, points: [[0, 0.1 + i * BRUSH * 0.7], [1, 0.1 + i * BRUSH * 0.7]] }));

function useSeeded(thread: string | null, layers: Layers, washed: Washed): boolean {
  const { api } = useKayfa();
  const [ready, setReady] = useState(layers === 1 && washed === 'none');
  useEffect(() => {
    if (thread === null || (layers === 1 && washed === 'none')) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      const acts = await api.acts(thread, 41, 46);
      const by = (seq: number) => acts.find((a) => a.seq === seq)?.character ?? null;
      const target = acts.find((a) => a.seq === 41);
      const [bottom] = target ? await api.cardsOn(target.id, 1) : [];
      const spritey = target?.character ?? null;
      const gloomba = by(45);
      if (!target || !bottom || !spritey || !gloomba) return;
      let top = bottom.id;
      if (layers === 3) {
        fake.clock.advance(MINUTE);
        top = fake.seed.card(gloomba, target.id, 'whoops', { layer: 2, config: { color: CYAN, seed: 202 }, message: 'cyan, obviously' });
      }
      if (layers >= 2) {
        fake.clock.advance(MINUTE);
        top = fake.seed.card(spritey, target.id, 'whoops', { layer: layers, config: { color: YELLOW, seed: 303 }, message: 'two can play' });
      }
      if (washed === 'partly') await api.saveEffect(top, spritey, { strokes: PARTLY });
      if (washed === 'bottom-clean') await api.saveEffect(bottom.id, spritey, { strokes: [], clean: true });
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [api, thread, layers, washed]);
  return ready;
}

/** Scrolls #41's plate into view once it is drawn. */
function Look() {
  useEffect(() => {
    const timer = setInterval(() => {
      const el = document.querySelector('#post-41 .kb-effect-strip') ?? null;
      if (!el) return;
      clearInterval(timer);
      el.scrollIntoView?.({ block: 'center' });
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return null;
}

function Layered({ layers, washed }: { readonly layers: Layers; readonly washed: Washed }) {
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, layers, washed);
  return (
    <Frame>
      <Look />
      {thread && ready ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Layered> = {
  title: 'Boards/01 Whoops layers',
  component: Layered,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Layered>;
const phone = { parameters: { moment: '02-phone' } } as const;

export const OneLayer: Story = { args: { layers: 1, washed: 'none' } };
export const TwoLayers: Story = { args: { layers: 2, washed: 'none' } };
export const ThreeLayers: Story = { args: { layers: 3, washed: 'none' } };
/** The top layer partly washed: the readout gives its own share, not a sum. */
export const ThreeLayersPartlyWashed: Story = { args: { layers: 3, washed: 'partly' } };
/** The bottom layer washed clean: its segment is faded, and "3 layers" is now two. */
export const ThreeLayersOneClean: Story = { args: { layers: 3, washed: 'bottom-clean' } };
export const OneLayerPhone: Story = { args: { layers: 1, washed: 'none' }, ...phone };
export const TwoLayersPhone: Story = { args: { layers: 2, washed: 'none' }, ...phone };
export const ThreeLayersPhone: Story = { args: { layers: 3, washed: 'none' }, ...phone };
export const ThreeLayersPartlyWashedPhone: Story = { args: { layers: 3, washed: 'partly' }, ...phone };
export const ThreeLayersOneCleanPhone: Story = { args: { layers: 3, washed: 'bottom-clean' }, ...phone };
