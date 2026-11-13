/**
 * Whoops!'s layers on one post, as stories for the owner (docs/plans/2026-10-31-plays-on-a-post-plan.md, Task 6;
 * the design's section 5): post #41 of the boards fixture, with the fixture's one layer (Mrs. Hooligan's magenta), two
 * (Spritey's yellow on top) or three (Gloomba's cyan between), each untouched, its top layer partly washed, or its
 * bottom layer washed clean; two with the top layer written on and scrubbed through (the ink field's look). Each story opens the Lens from #41's Whoops! mark: its state line names the top layer,
 * its caster and its ink in words, with its own share washed, its Who row has a line for each layer, and its meter is the
 * mark's edge. No board draws these.
 * One more, `ThreeLayersTall`, is a post about 12,000px tall with three layers, left unopened at its top: the banded ink's story, which e2e/whoops.spec.ts scrolls to its end and scrubs.
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
import { packStroke } from '../../cards/whoops/points.ts';
import { BRUSH_PX, PEN_PX, brushOf, type Pt, type Stroke } from '../../cards/whoops/scrub.ts';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';

const MINUTE = 60_000;
const YELLOW = '#ffd93d';
const CYAN = '#19e3ff';

type Layers = 1 | 2 | 3;
type Washed = 'none' | 'partly' | 'bottom-clean' | 'written';

/*
 * A post about 12,000px tall (the banded ink design, docs/plans/2026-11-12-whoops-followups-design.md): #41's words are replaced by an edit of
 * its author's, 270 short paragraphs of plain filler (a body is held to 20,000 characters, so the height is in the breaks), so its height comes from its text as any long post's does. Its ink is a canvas for each
 * band of 512px near the viewport and each layer, so at its top the first bands are drawn and at its end the last.
 */
const TALL_BODY = Array.from({ length: 270 }, (_, i) => `Line ${i + 1} of the changelog.`).join('\n\n');

/* Strokes across the top band of a 988x330 body, in shares with its aspect, a brush apart: enough to wash part of a splat, never all of it. */
const BOX = { w: 988, h: 330 };
const WHERE = brushOf(BRUSH_PX, BOX);
const PEN = brushOf(PEN_PX, BOX);
const along = (n: number, at: (t: number) => Pt): Pt[] => Array.from({ length: n }, (_, i) => at(i / (n - 1)));
const PARTLY = Array.from({ length: 14 }, (_, i) => {
  const y = 0.05 + i * (WHERE.width * WHERE.aspect) * 0.7;
  return packStroke({ tool: 'wash', ...WHERE, points: [[0, y], [1, y]] });
});

/*
 * The ink field's look (docs/plans/2026-11-12-whoops-ink-field-design.md): the author's pen lines on the top layer, each ending in
 * the bulb its end gets (the second throws two drops), and holes scrubbed through the splat's body, a few passes deep each, so the core
 * is thinned where a pass has left some and open where several have. Points are the decoded shape; they are packed as the card saves them.
 */
const written = (color: string): Stroke[] => {
  const holes = (y: number, x0: number, x1: number, passes: number): Stroke[] => Array.from({ length: passes }, (_, i) => ({
    tool: 'wash' as const, ...WHERE, points: i % 2 === 0 ? [[x0, y], [x1, y]] as Pt[] : [[x1, y], [x0, y]] as Pt[],
  }));
  return [
    { tool: 'ink', color, ...PEN, drops: 0, points: along(40, (t) => [0.08 + t * 0.5, 0.82 + 0.05 * Math.sin(t * 9)]) },
    { tool: 'ink', color, ...PEN, drops: 2, points: along(30, (t) => [0.9 - t * 0.35, 0.18 + 0.08 * Math.cos(t * 7)]) },
    ...holes(0.5, 0.4, 0.62, 2),
    ...holes(0.58, 0.45, 0.58, 4),
  ];
};

/** Hand #41 its layers and their washes, then say it is ready to be read. */
function useSeeded(thread: string | null, layers: Layers, washed: Washed, tall: boolean): boolean {
  const { api } = useKayfa();
  const [ready, setReady] = useState(layers === 1 && washed === 'none' && !tall);
  useEffect(() => {
    if (thread === null || (layers === 1 && washed === 'none' && !tall)) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      const acts = await api.acts(thread, 41, 46);
      const by = (seq: number) => acts.find((a) => a.seq === seq)?.character ?? null;
      const target = acts.find((a) => a.seq === 41);
      const [bottom] = target ? await api.cardsOn(target.id, 1) : [];
      const spritey = target?.character ?? null;
      const gloomba = by(45);
      if (!target || !bottom || !spritey || !gloomba) throw new Error('the boards fixture has no #41 with its play, or no #45');
      let top = bottom.id;
      if (tall) fake.seed.edit(target.id, spritey, TALL_BODY);
      if (layers === 3) {
        fake.clock.advance(MINUTE);
        top = fake.seed.card(gloomba, target.id, 'whoops', { layer: 2, config: { color: CYAN, seed: 202 }, message: 'cyan, obviously' });
      }
      if (layers >= 2) {
        fake.clock.advance(MINUTE);
        top = fake.seed.card(spritey, target.id, 'whoops', { layer: layers, config: { color: YELLOW, seed: 303 }, message: 'two can play' });
      }
      if (washed === 'written' && layers === 1) throw new Error('the written layer is a top layer with a color of its own: use two or three layers');
      const saved = washed === 'written' ? await api.saveEffect(top, spritey, { strokes: written(YELLOW).map(packStroke) })
        : washed === 'partly' ? await api.saveEffect(top, spritey, { strokes: PARTLY })
        : washed === 'bottom-clean' ? await api.saveEffect(bottom.id, spritey, { strokes: [], clean: true }) : null;
      if (saved && !saved.ok) throw new Error(`the wash was refused: ${saved.error}`);
      if (live) setReady(true);
      /* A seed or a wash refused leaves the story loading (aria-busy), and says why, rather than drawing a state its name does not. */
    })().catch((e: unknown) => { console.error('the Whoops! layers story could not be seeded', e); });
    return () => { live = false; };
  }, [api, thread, layers, washed, tall]);
  return ready;
}

/** Scrolls #41 into view once its mark is drawn, and opens the Lens from the mark, as a player would; a tall post is scrolled to its top and left unopened. */
function Look({ tall }: { readonly tall: boolean }) {
  useEffect(() => {
    const timer = setInterval(() => {
      const el = document.querySelector<HTMLElement>('#post-41 .kb-mark[data-kb-card="whoops"]');
      if (!el) return;
      clearInterval(timer);
      if (tall) { document.querySelector('#post-41')?.scrollIntoView?.({ block: 'start' }); return; }
      el.scrollIntoView?.({ block: 'center' });
      el.click();
    }, 100);
    return () => clearInterval(timer);
  }, [tall]);
  return null;
}

function Layered({ layers, washed, tall = false }: { readonly layers: Layers; readonly washed: Washed; readonly tall?: boolean }) {
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, layers, washed, tall);
  return (
    <Frame>
      <Look tall={tall} />
      {thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}
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
/** The top layer partly washed: the state line gives its own share, not a sum. */
export const ThreeLayersPartlyWashed: Story = { args: { layers: 3, washed: 'partly' } };
/** The bottom layer washed clean: its segment is faded, and the count stays three, as each panel counts them ("Layer 1 of 3"). */
export const ThreeLayersOneClean: Story = { args: { layers: 3, washed: 'bottom-clean' } };
/** The top layer with the author's pen lines (each ending in a bulb, one with drops) and holes scrubbed through its body, some a few passes deep: the ink field's look. */
export const TwoLayersWritten: Story = { args: { layers: 2, washed: 'written' } };
export const TwoLayersWrittenPhone: Story = { args: { layers: 2, washed: 'written' }, ...phone };
export const OneLayerPhone: Story = { args: { layers: 1, washed: 'none' }, ...phone };
export const TwoLayersPhone: Story = { args: { layers: 2, washed: 'none' }, ...phone };
export const ThreeLayersPhone: Story = { args: { layers: 3, washed: 'none' }, ...phone };
export const ThreeLayersPartlyWashedPhone: Story = { args: { layers: 3, washed: 'partly' }, ...phone };
export const ThreeLayersOneCleanPhone: Story = { args: { layers: 3, washed: 'bottom-clean' }, ...phone };
/** A post about 12,000px tall with three layers, at its top and open to scroll: its ink is banded, so only the bands near the viewport are drawn (e2e/whoops.spec.ts scrubs it at its far end). */
export const ThreeLayersTall: Story = { args: { layers: 3, washed: 'none', tall: true } };
