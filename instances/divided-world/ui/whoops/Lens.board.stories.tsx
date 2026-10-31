/**
 * The marks and the Lens on the mockup's post, as stories for the owner (docs/plans/2026-10-31-marks-and-the-lens-plan.md, Task 8;
 * the mockup they are set against is docs/research/2026-10-31-marks-and-the-lens/, whose three shots are `rest.png`, `lens.png`
 * and `held.png`): post #41 of the boards fixture, carrying four plays of two cards, three Whoops! layers (Mrs. Hooligan's magenta
 * under Pipewrench's orange under Gloomba's yellow, the top one's wash 18% done) and one Stick Around by a character with a very
 * long name. No board draws these. Open each at 1440 by 1120, and its `Phone` twin at 390 by 844.
 *
 * `reader` is a player who wrote none of the thread (a new account with one character, signed in before the thread is read);
 * `author` is the moment's own player, who wrote #41 and so is never held and may wash its ink. `Rest` is the page as it opens,
 * `Lens*` the Lens open from a card's mark with its Who row folded or unfolded, and `HeldInside` is Stick Around's view over #44 with
 * Whoops! played under it, the Lens opened from the mark the view draws over the post, beside the hold's own box.
 *
 * Stick Around's hold is set to the thread stage (`HoldStage`), so the page does not take the reader over on its own: a story opens at
 * one state and stays there.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { ThreadScreen } from '../../../../engine/ui/thread/Thread.tsx';
import { BRUSH } from '../../cards/whoops/scrub.ts';
import { HoldStage, type HoldStageValue } from '../stick-around/Effect.tsx';

const MINUTE = 60_000;
const ORANGE = '#ff9f43';
const YELLOW = '#ffd93d';
const LONG_NAME = 'Professor Hootenanny McGillicuddy III';

/** `as-is` keeps the moment's own signed-in player (the Hold board's, a reader who is held). */
type Viewer = 'reader' | 'author' | 'as-is';
type Open = 'none' | 'whoops' | 'stick-around';

/* Strokes across the top band of the layout, a brush apart: enough to wash part of a splat, never all of it. */
const PARTLY = Array.from({ length: 14 }, (_, i) => ({ tool: 'wash' as const, width: BRUSH, points: [[0, 0.1 + i * BRUSH * 0.7], [1, 0.1 + i * BRUSH * 0.7]] }));

/**
 * Hand a post its plays and their reactions, and sign in who is to read it, then say it is ready. `post` is the number the plays
 * go on, `cards` which kinds (Stick Around, as a third, is the caster with the long name's).
 */
function useSeeded(thread: string | null, viewer: Viewer, post: number, stickAround: boolean): boolean {
  const { api, instance } = useKayfa();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      const acts = await api.acts(thread, 38, 46);
      const by = (seq: number) => acts.find((a) => a.seq === seq)?.character ?? null;
      const target = acts.find((a) => a.seq === post);
      const hooligan = by(40);
      const pipewrench = by(43);
      const gloomba = by(45) ?? by(38);
      if (!target || !pipewrench || !gloomba) throw new Error('the boards fixture has no post to play on, or no #43, and no #45 or #38');
      const whoops = instance.cards.find((c) => c.name === 'Whoops!')?.key;
      const hold = instance.cards.find((c) => c.name === 'Stick Around')?.key;
      if (!whoops || !hold) throw new Error('the instance has no Whoops! or Stick Around');
      const played = (await api.cardsOn(target.id, 8)).filter((a) => a.currentPayload.card === whoops);
      let bottom = played[0]?.id ?? null;
      const kinds = instance.reactions.map((r) => r.key);
      let fans = 0;
      const react = (act: string, kind: string | undefined, times: number) => {
        if (kind === undefined) return;
        for (let i = 0; i < times; i++) {
          const account = fake.seed.account(`story-fan-${++fans}`);
          fake.seed.react(account, fake.seed.character(account, `Story fan ${fans}`, instance.classes[0]!.key), act, kind);
        }
      };
      /* The first layer is the fixture's (on #41), or the story's own where the post has none (#44's). */
      if (bottom === null) {
        if (!hooligan) throw new Error('the boards fixture has no #40');
        bottom = fake.seed.card(hooligan, target.id, whoops, { layer: 1, config: { color: '#ff2bd6', seed: 101 }, message: 'you dropped your ink' });
      }
      react(bottom, kinds[0], 6);
      react(bottom, kinds[1], 2);
      fake.clock.advance(MINUTE);
      const second = fake.seed.card(pipewrench, target.id, whoops, { layer: 2, config: { color: ORANGE, seed: 202 }, message: 'for the archive' });
      react(second, kinds[2], 1);
      fake.clock.advance(MINUTE);
      const top = fake.seed.card(gloomba, target.id, whoops, { layer: 3, config: { color: YELLOW, seed: 303 }, message: 'fine, I\'ll do it myself' });
      if (stickAround) {
        const account = fake.seed.account('story-long-name');
        const long = fake.seed.character(account, LONG_NAME, instance.classes[0]!.key);
        fake.clock.advance(MINUTE);
        fake.seed.card(long, target.id, hold, { message: 'required reading' });
      }
      /* The top layer is partly washed, by the post's author, as they would save it. */
      if (target.character && viewer !== 'as-is') {
        const saved = await api.saveEffect(top, target.character, { strokes: PARTLY });
        if (!saved.ok) throw new Error(`the wash was refused: ${saved.error}`);
      }
      if (viewer === 'reader') {
        const account = fake.seed.account('story-reader');
        fake.seed.character(account, 'Story reader', instance.classes[0]!.key);
        fake.signInAs(account);
      }
      if (live) setReady(true);
      /* A seed refused leaves the story loading (aria-busy), and says why, rather than drawing a state its name does not. */
    })().catch((e: unknown) => { console.error('the Lens story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, viewer, post, stickAround]);
  return ready;
}

/** Scrolls the post into view once its mark is drawn, and opens the Lens from the card's mark and unfolds Who, as a player would. */
function Look({ post, open, who }: { readonly post: number; readonly open: string | null; readonly who: boolean }) {
  useEffect(() => {
    const timer = setInterval(() => {
      const article = document.getElementById(`post-${post}`);
      const mark = article?.querySelector<HTMLElement>(`.kb-mark[data-kb-card]${open ? `[data-kb-card="${open}"]` : ''}`);
      if (!article || !mark) return;
      clearInterval(timer);
      /* jsdom, where the stories are swept for accessibility, has no scrollIntoView; a throw in this timer ends the whole test run. */
      article.scrollIntoView?.({ block: 'center' });
      if (open === null) return;
      mark.click();
      if (who) setTimeout(() => { const fold = document.querySelector<HTMLElement>('.kb-lens-fold'); if (fold?.getAttribute('aria-expanded') === 'false') fold.click(); }, 50);
    }, 100);
    return () => clearInterval(timer);
  }, [post, open, who]);
  return null;
}

interface Props { readonly viewer: Viewer; readonly open: Open; readonly who: boolean }

function Post({ viewer, open, who }: Props) {
  const { instance } = useKayfa();
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, viewer, 41, true);
  const card = open === 'none' ? null : instance.cards.find((c) => c.name === (open === 'whoops' ? 'Whoops!' : 'Stick Around'))?.key ?? null;
  const stage: HoldStageValue = { mode: 'thread' };
  return (
    <Frame>
      <Look post={41} open={card} who={who} />
      <HoldStage.Provider value={stage}>
        {thread && ready ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}
      </HoldStage.Provider>
    </Frame>
  );
}

/** Stick Around's view over #44 (the Hold board's moment, a reader who is held), Whoops! played under it, and its Lens opened from the mark the view draws. */
function Held() {
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const ready = useSeeded(thread, 'as-is', 44, false);
  const stage: HoldStageValue = { mode: 'view', level: 0.4 };
  return (
    <Frame>
      <HeldLook />
      <HoldStage.Provider value={stage}>
        {thread && ready ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}
      </HoldStage.Provider>
    </Frame>
  );
}

/** Opens the Lens on Whoops! from the mark inside the hold's view, and unfolds Who. */
function HeldLook() {
  useEffect(() => {
    const timer = setInterval(() => {
      const mark = document.querySelector<HTMLElement>('.kb-hold-view .kb-mark[data-kb-card="whoops"]');
      if (!mark) return;
      clearInterval(timer);
      mark.click();
      setTimeout(() => { const fold = document.querySelector<HTMLElement>('.kb-lens-fold'); if (fold?.getAttribute('aria-expanded') === 'false') fold.click(); }, 50);
    }, 100);
    return () => clearInterval(timer);
  }, []);
  return null;
}

const meta: Meta<typeof Post> = {
  title: 'Boards/01 Lens',
  component: Post,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Post>;
const phone = { parameters: { moment: '02-phone' } } as const;

/** The page as it opens for a reader (the mockup's `rest.png`): #41's marks, no Lens. */
export const Rest: Story = { args: { viewer: 'reader', open: 'none', who: false } };
/** The same for the post's author: the Whoops! mark has its gold notch. */
export const RestAuthor: Story = { args: { viewer: 'author', open: 'none', who: false } };
/** The Lens on Whoops!'s tab, Who folded. */
export const LensWhoops: Story = { args: { viewer: 'reader', open: 'whoops', who: false } };
/** The Lens on Whoops!'s tab, Who unfolded (the mockup's `lens.png`). */
export const LensWhoopsWho: Story = { args: { viewer: 'reader', open: 'whoops', who: true } };
/** The Lens on Stick Around's tab, Who folded. */
export const LensStickAround: Story = { args: { viewer: 'reader', open: 'stick-around', who: false } };
/** The Lens on Stick Around's tab, Who unfolded: the long name in its one row. */
export const LensStickAroundWho: Story = { args: { viewer: 'reader', open: 'stick-around', who: true } };
/** The author's Lens on Whoops!, Who unfolded: Wash and Write in ink beside Hold to scrub. */
export const LensAuthorWhoopsWho: Story = { args: { viewer: 'author', open: 'whoops', who: true } };
/** Stick Around's view with Whoops! played under it, and its Lens opened inside the hold (the mockup's `held.png`). */
export const HeldInside: StoryObj<typeof Held> = { render: () => <Held />, parameters: { moment: '08-hold' } };

export const RestPhone: Story = { args: { viewer: 'reader', open: 'none', who: false }, ...phone };
export const RestAuthorPhone: Story = { args: { viewer: 'author', open: 'none', who: false }, ...phone };
export const LensWhoopsPhone: Story = { args: { viewer: 'reader', open: 'whoops', who: false }, ...phone };
export const LensWhoopsWhoPhone: Story = { args: { viewer: 'reader', open: 'whoops', who: true }, ...phone };
export const LensStickAroundPhone: Story = { args: { viewer: 'reader', open: 'stick-around', who: false }, ...phone };
export const LensStickAroundWhoPhone: Story = { args: { viewer: 'reader', open: 'stick-around', who: true }, ...phone };
export const LensAuthorWhoopsWhoPhone: Story = { args: { viewer: 'author', open: 'whoops', who: true }, ...phone };
export const HeldInsidePhone: StoryObj<typeof Held> = { render: () => <Held />, parameters: { moment: '08-hold' }, globals: { viewport: { value: 'glassPhone390', isRotated: false } } };
