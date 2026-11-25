/**
 * It's Curtains as stories for the owner's word (docs/plans/2026-11-23-its-curtains-plan.md, Task 6): a post of a thread of the boards fixture, by Kooper Trooper, under
 * the curtains the story's casters hung on it, drawn on the light board and read by the player (who is nobody in the story). The story route renders no play function,
 * so the specs press the curtain themselves; `Opened` has one for the owner to open in Storybook. Open them at 1440 by 1120.
 *
 * - `OneShut`, `OneShutDark`: one Red curtain, closed. `Opened`: the same with the curtain pressed by the play function, the post under it, and the Lens's Encore to shut it again.
 * - `Three`: three stacked, Red outermost, then Royal Blue, then Gold: three presses, each showing the next fabric, the third the post.
 * - `WithBelowTheFold`: Below the Fold and a curtain on one post: the bar is outermost, and unfolding it shows the curtain.
 * - `OverSteelChair`: a curtain over a post a chair is thrown at, which throws only when the curtain is opened (an effect that starts on sight waits under a curtain).
 * - `Reduced`: one curtain with motion reduced (`data-kb-motion="reduce"`): the press opens it at once, with no confetti, and the sounds still play.
 * - `ForcedColors`: one curtain, closed, for the spec that emulates `forced-colors: active`: a solid `CanvasText` panel with "Open the curtain" in `Canvas`.
 * - `InTheOriginBox`: a thread spun from the curtained post, whose ORIGIN box shows the post live: the curtain fills the box's content area under its band, border to border, and opens on a press.
 * - `DrumrollLoop`: one curtain, closed, and a button that loops the drumroll as the curtain does while a mouse moves over it (the plan's check that the cut loops without a click): press Loop the
 *   drumroll with Game sounds on, listen for a seam over a minute, press it again to stop.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { userEvent, within } from 'storybook/test';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useSound } from '../../../../engine/ui/audio/sound.ts';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { ThreadSummary } from '../../../../engine/ui/data/api.ts';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';
import { cardOf, type World } from '../../../../engine/ui/story.tsx';
import type { Fabric } from '../../cards/its-curtains.ts';

type Case = 'one' | 'three' | 'fold' | 'chair' | 'origin';

/** The thread the world seeded: a story's world is made before it renders. */
let thread = '';
/** The spun thread's title, which the ORIGIN story finds it by, and the world's spin, done: the thread's page is read once, so it is read after this. */
const SPUN = 'Spun out of the curtain';
let spun: Promise<void> = Promise.resolve();

const WORDS = [
  'I would like to formally announce that I have been Toadsworth the whole time. This is the post that proves it.',
  'Thank you for coming to my talk. There is a second paragraph here so that the row is tall enough to see the pleats hang properly, and a third so that nobody can say the curtain had nothing to hide.',
  'Anyway, Double Dash is still the greatest game ever made, and I would die on that hill. That is all.',
].join('\n\n');

const FABRICS_THREE: readonly Fabric[] = ['gold', 'royal-blue', 'red'];

/** A thread with a post by Kooper Trooper and the plays each case calls for: curtains by Spritey, Gloomba and Bob-omb Bill, one for each fabric, innermost first. */
const worldOf = (shown: Case): World => (fake, instance) => {
  const rules = cardOf(instance.cards, 'its-curtains');
  const [first, second] = instance.classes;
  const player = fake.seed.account('story-player', { seasoned: true });
  const mine = fake.seed.character(player, 'Pipewrench', first!.key);
  fake.clock.advance(Date.now() - fake.clock.now());
  const kooper = fake.seed.character(fake.seed.account('kooper'), 'Kooper Trooper', first!.key);
  const board = instance.boards.find((b) => !b.system)!.slug;
  const made = fake.seed.thread(board, kooper, 'Ranking every Mario Kart', 'Ranking every Mario Kart, worst to best. Number one is Double Dash.');
  const post = fake.seed.post(made.thread, kooper, WORDS);
  const names = ['Spritey', 'Gloomba', 'Bob-omb Bill'];
  const caster = (i: number) => fake.seed.character(fake.seed.account(`caster-${i}`), names[i]!, (i % 2 === 0 ? (second ?? first) : first)!.key);
  const curtain = (i: number, fabric: Fabric) => fake.seed.card(caster(i), post, rules.key, { layer: i + 1, live: true, config: { fabric }, message: `A ${fabric} curtain` });
  if (shown === 'three') FABRICS_THREE.forEach((fabric, i) => curtain(i, fabric));
  else curtain(0, 'red');
  if (shown === 'fold') fake.seed.card(caster(1), post, cardOf(instance.cards, 'below-the-fold').key, { layer: 1, live: true, config: {}, message: 'Below the fold' });
  if (shown === 'chair') fake.seed.card(caster(1), post, cardOf(instance.cards, 'steel-chair').key, { layer: 1, live: true, config: {}, message: 'Steel Chair' });
  fake.signInAs(player);
  if (shown === 'origin') {
    /* Every card met, so that no first-meet tip hangs off a mark over the box. */
    spun = (async () => {
      const answer = await fake.spin(post, mine, SPUN, 'Carrying on over here.', undefined, undefined);
      if (!answer.ok) throw new Error(`the spin was refused: ${answer.error}`);
    })();
  }
  thread = made.thread;
};

/** The thread with the spun title, once the world's spin has made it. */
function useSpun(on: boolean): ThreadSummary | null {
  const { api, instance } = useKayfa();
  const [found, setFound] = useState<ThreadSummary | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    void (async () => {
      await spun;
      for (const c of instance.cards) await api.meetCard(c.key);
      for (let attempt = 0; attempt < 40 && live; attempt++) {
        for (const board of await api.boards()) {
          const hit = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === SPUN);
          if (hit) { if (live) setFound(hit); return; }
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
    return () => { live = false; };
  }, [api, instance, on]);
  return found;
}

interface Args {
  readonly mode: 'light' | 'dark';
  readonly reduced?: boolean;
  /** Draws the thread the world spun from the post, whose ORIGIN box holds it. */
  readonly origin?: boolean;
  /** A button that loops the drumroll, for the ear. */
  readonly loop?: boolean;
}

/** Loops the drumroll as the curtain does, for as long as the reader wants to listen: the seam of the cut is heard only over a good many laps. */
function LoopButton() {
  const sound = useSound();
  const handle = useRef<{ setGain(g: number): void; stop(fadeMs: number): void } | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => () => handle.current?.stop(100), []);
  const press = () => {
    if (handle.current) { handle.current.stop(100); handle.current = null; setOn(false); return; }
    const h = sound.loop('its-curtains.drumroll', { group: 'its-curtains', id: 'story-loop' });
    h.setGain(1);
    handle.current = h;
    setOn(true);
  };
  return (
    <p style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 80, margin: 0 }}>
      <button type="button" onClick={press} aria-pressed={on}>{on ? 'Stop the drumroll' : 'Loop the drumroll'}</button>
    </p>
  );
}

function Curtained({ mode, reduced = false, origin = false, loop = false }: Args) {
  const found = useSpun(origin);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    if (reduced) root.setAttribute('data-kb-motion', 'reduce');
    return () => { root.removeAttribute('data-kb-mode'); root.removeAttribute('data-kb-motion'); };
  }, [mode, reduced]);
  const shown = origin ? found?.id ?? null : thread;
  return (
    <Frame>
      {shown ? <LoadedThread thread={shown} /> : <div aria-busy="true" />}
      {loop && <LoopButton />}
    </Frame>
  );
}

const meta: Meta<typeof Curtained> = {
  title: "Boards/28 It's Curtains",
  component: Curtained,
  parameters: { world: worldOf('one'), layout: 'fullscreen' },
  args: { mode: 'light' },
};
export default meta;

type Story = StoryObj<typeof Curtained>;

export const OneShut: Story = { args: { mode: 'light' } };
export const OneShutDark: Story = { args: { mode: 'dark' } };
export const Opened: Story = {
  args: { mode: 'light' },
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: /^Open the curtain/u })); },
};
export const Three: Story = { args: { mode: 'light' }, parameters: { world: worldOf('three') } };
export const WithBelowTheFold: Story = { args: { mode: 'light' }, parameters: { world: worldOf('fold') } };
/** The chair is thrown only when the curtain is opened: an effect that starts on sight treats a covered post as out of view. */
export const OverSteelChair: Story = { args: { mode: 'light' }, parameters: { world: worldOf('chair') } };
export const Reduced: Story = { args: { mode: 'light', reduced: true } };
export const ForcedColors: Story = { args: { mode: 'light' } };
export const InTheOriginBox: Story = { args: { mode: 'light', origin: true }, parameters: { world: worldOf('origin') } };
export const DrumrollLoop: Story = { args: { mode: 'light', loop: true } };
