/**
 * Card effects in a spun thread's ORIGIN box as stories for the owner's word (docs/plans/2026-11-15-origin-box-effects-plan.md, Task 3; design, sections 2 to 7):
 * a thread of a board with a post by another character and the play or plays on it, then a thread spun from the post (or from the play), drawn at its first
 * page, where the ORIGIN box shows the post live, or as a moment. e2e/origin-effects.spec.ts measures each against the box's content area. The story route
 * renders no play function, so the spec moves the pointer itself. Open them at 1440 by 1120, the phone's twin at 390 by 844.
 *
 * - `Whoops`: a post of three lines, edited (so Last edited shows), with Whoops! on it, the box showing it live. `WhoopsLanded`: the same, spun from the
 *   Whoops! play, so the box shows the play's moment, "as it landed". `WhoopsPhone`: as `Whoops`, at the phone's width.
 * - `Fab`: one line with Feelin' Fab on it, live. `FabBright`: the same with a quote in it, Brighter effects on, and Feelin' Fab on the spin's opening
 *   post too.
 * - `GlitterSpun`: a Glitter Bomb on a character, spun from a post of theirs ("as it was spun"), its glitter still.
 * - `HotBox`: three lines with Hot Box on it, live. `Chair`: three lines with Steel Chair on it, live. `ChairShort`: one short line with Steel Chair.
 * - `GlitterOver`: Glitter Bomb on the character who spun the thread (who also has a post on its first page, as the server requires), the box a plain post by another character, live, over the glittered opening post.
 * - `Under`: a plain post in the box (with a 4D Chess play, which draws nothing, so that it has a mark), and Whoops! and Hot Box on the spin's opening post around it: the box stands above them and takes none of their presses.
 *
 * The spin is made through the fake's own `spin`, by the signed-in player's character, and the thread is read once it has answered. The plays on the
 * spin's opening post are seeded once the page is up, as they would arrive while it is open: the fake's thread page carries the plays of posts, not of a spin's own Act.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';
import { Frame } from '../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../engine/ui/context.tsx';
import type { Fake } from '../../../engine/ui/data/fake.ts';
import type { ThreadSummary } from '../../../engine/ui/data/api.ts';
import { LoadedThread } from '../../../engine/ui/loaded.tsx';
import { foilProbe } from '../../../engine/ui/shine/foilClient.ts';
import { cling } from '../../../engine/ui/shine/flakes.ts';
import { probe } from '../../../engine/ui/shine/loop.ts';
import { cardOf, type World } from '../../../engine/ui/story.tsx';

declare global {
  interface Window {
    /** The nth foil canvas of the ORIGIN box, as the worker that draws it holds it (the canvas's own size where the page draws it): e2e/origin-effects.spec.ts reads the backing size through it, since a handed-over canvas cannot be read on the page. */
    __kbOriginFab?: { size(nth: number): Promise<{ w: number; h: number } | null> };
    /**
     * What e2e/origin-effects.spec.ts reads of the shine loop and the cling layer, as e2e/shine.spec.ts reads `window.__kbShine` (Shine.board.stories.tsx, which this page does not mount): each
     * Feelin' Fab on the page in document order with the loop's draws of it, the box it paints (its canvas's) and its words' own box in the viewport, the share of the loop's rate it is
     * drawn at, and whether it is the ORIGIN box's; the loop's frames and whether it runs; and how many flakes the page-fixed cling layer carries.
     */
    __kbOriginShine?: {
      hosts(): { draws: number; top: number; bottom: number; width: number; own: { top: number; bottom: number; width: number }; share: number; inBox: boolean }[];
      frames(): number;
      running(): boolean;
      carried(): number;
    };
  }
}

type Case = 'whoops' | 'landed' | 'fab' | 'bright' | 'glitter' | 'hotbox' | 'chair' | 'chair-short' | 'under' | 'over';

const DAY = 86_400_000;
/** The spun thread's title, which the page finds it by. */
const SPUN = 'Spun out of the box';
/** The world's spin, done: a story's world is made before it renders, and the thread's page is read once, so it is read after this. */
let seeded: Promise<void> = Promise.resolve();
/**
 * The plays on the spun thread's opening post, which the case seeds once the page is up. The fake's thread page carries the plays of posts and
 * not of a spin's own Act, so they arrive as a play does while a page is open: `live` sends the Act to the page that listens.
 */
let onOpening: ((act: string) => void) | null = null;
const CYAN = '#19e3ff';
const PINK = '#ff69b4';

const THREE = [
  'The physics in the original engine were never the problem, and I will say so again.',
  'I played forty of the contest entries last weekend, and the ones that felt good all used the default settings.',
  'Anyway the new level editor is fine. Stop asking for slopes. That is all, and I will not be taking questions.',
].join('\n\n');
/** The same three lines, after an edit (the box's Last edited line shows only for a post that was). */
const THREE_EDITED = THREE.replace('and I will say so again', 'and I stand by that');
const ONE = 'Luigi wins, and that is the whole post.';
const SHORT = 'Luigi wins.';
const QUOTED = '[quote=Kooper Trooper]The best driver in the series is Luigi.[/quote]The best driver in the series is, in fact, Luigi.';
const PLAIN = 'A plain post, with nothing on it of its own, and a box that stands over its opening post\'s effects.';

/** A thread with a post by another character and the plays each case calls for, a thread spun from it by the player's character, and the plays on that thread's opening post. */
const worldOf = (shown: Case): World => (fake, instance) => {
  const [first, second] = instance.classes;
  const player = fake.seed.account('story-player', { seasoned: true });
  const mine = fake.seed.character(player, 'Pipewrench', first!.key);
  /* The fake's clock is brought to the page's (a play's end, and the smoke's strength, are read against it), as the Jimmy Wails stories do. */
  fake.clock.advance(Date.now() - fake.clock.now());
  const author = fake.seed.character(fake.seed.account('kooper'), 'Kooper Trooper', first!.key);
  const caster = fake.seed.character(fake.seed.account('spritey'), 'Spritey', (second ?? first)!.key);
  const board = instance.boards.find((b) => !b.system)!.slug;
  const made = fake.seed.thread(board, author, 'Ranking every Mario Kart', 'Ranking every Mario Kart, worst to best.');
  const now = fake.clock.now();
  const words = shown === 'whoops' || shown === 'landed' || shown === 'hotbox' || shown === 'chair' ? THREE
    : shown === 'chair-short' ? SHORT
      : shown === 'bright' ? QUOTED
        : shown === 'under' || shown === 'over' ? PLAIN
          : ONE;
  const post = fake.seed.post(made.thread, author, words);
  if (shown === 'whoops' || shown === 'landed') fake.seed.edit(post, author, THREE_EDITED);
  /* The seed is one whose splat holds the byline's middle and the area's bottom-left corner at both the Main board's width and the phone's (found by running `makeSplat`/`fieldAt` over seeds against the measured areas: field 1.97 at the four points, the ink's threshold being 0.42), so that e2e/origin-effects.spec.ts case 2 reads solid ink in parts of the area that are not the words' box, on both. A splat is only where its seed put it. */
  const whoops = () => ({ layer: 1, live: true, config: { color: CYAN, seed: 2591 }, message: 'cyan, obviously' });
  fake.signInAs(player);
  /*
   * The opening post's own plays, seeded when the page is up and given the spin's first Act. These are fixtures of the engine's rule and not a state today's
   * server produces (issue #739): a spun thread's opening Act is a `spin` Act, the server returns post-reach plays only for `post` Acts and refuses a card of post
   * reach on anything else. So `FabBright`'s Feelin' Fab and `Under`'s Whoops! and Hot Box on the opening post show what the engine does for whatever effect is
   * on it. They are seeded as live deliveries because the fake, like the server, returns none for a `spin` Act. What the server really does produce is
   * `GlitterOver`: a play on the character, which the server delivers with any post of theirs on the page.
   */
  const opening = (act: string): void => {
    if (shown === 'bright') fake.seed.card(caster, act, cardOf(instance.cards, 'feelin-fab').key, { layer: 1, live: true, config: {}, message: 'Fab' });
    if (shown === 'under') {
      fake.seed.card(caster, act, cardOf(instance.cards, 'whoops').key, { layer: 1, live: true, config: { color: '#ff2bd6', seed: 20261115 }, message: 'pink, obviously' });
      fake.seed.card(author, act, cardOf(instance.cards, 'hot-box').key, { layer: 2, live: true, config: { color: PINK }, message: 'Smoke out', ends: new Date(now + 3 * DAY).toISOString() });
    }
  };
  const spun = (from: string, at?: string) => {
    seeded = fake.spin(from, mine, SPUN, 'Carrying on over here.', undefined, at).then((answer) => {
      if (!answer.ok) throw new Error(`the spin was refused: ${answer.error}`);
      /* Glitter Bomb is a play on a character, and the server delivers a character's plays only with a post of that character on the page: so the spinner has a post on the first page too. */
      if (shown === 'over') fake.seed.post(answer.value.thread.id, mine, 'And a post of my own, so that the glitter on me is delivered with this page.');
    });
    onOpening = opening;
  };
  if (shown === 'glitter') {
    /* A card on a character, cast from a post of one thread and pressed on a post of that character's in another, as the spin-at-post stories do. */
    const cast = fake.seed.thread(board, author, 'Where the bomb was cast', 'The post the bomb was cast from.');
    const shiny = fake.seed.thread(board, mine, 'Why are my posts shiny', 'A post of mine.');
    const pressed = fake.seed.post(shiny.thread, author, THREE);
    const play = fake.seed.reach(caster, 'character', author, cardOf(instance.cards, 'glitter-bomb').key, { post: cast.act, ends: now + 5 * DAY, message: 'Sparkle.' });
    spun(play, pressed);
    return;
  }
  if (shown === 'over') {
    /* A play on the spinner, cast from a post of theirs, delivered by the server as it delivers any character's: the spin's opening Act is the spinner's, so the glitter is on it. */
    const home = fake.seed.thread(board, mine, 'Where the bomb was cast on me', 'A post of mine, which the bomb was cast from.');
    fake.seed.reach(caster, 'character', mine, cardOf(instance.cards, 'glitter-bomb').key, { post: home.act, ends: now + 5 * DAY, message: 'Sparkle.' });
  }
  if (shown === 'whoops') fake.seed.card(caster, post, cardOf(instance.cards, 'whoops').key, whoops());
  if (shown === 'landed') {
    const play = fake.seed.card(caster, post, cardOf(instance.cards, 'whoops').key, whoops());
    spun(play);
    return;
  }
  if (shown === 'fab' || shown === 'bright') fake.seed.card(caster, post, cardOf(instance.cards, 'feelin-fab').key, { layer: 1, live: true, config: {}, message: 'Fab' });
  if (shown === 'hotbox') fake.seed.card(caster, post, cardOf(instance.cards, 'hot-box').key, { layer: 1, live: true, config: { color: PINK }, message: 'Smoke out', at: now, ends: new Date(now + 3 * DAY).toISOString() });
  /* A card with no effect on the words, so that the box's plain post still has a mark, and the mark's Go to post, to press. */
  if (shown === 'under') fake.seed.card(caster, post, cardOf(instance.cards, '4d-chess').key, { layer: 1, live: true, config: {}, message: 'Check.' });
  if (shown === 'chair' || shown === 'chair-short') fake.seed.card(caster, post, cardOf(instance.cards, 'steel-chair').key, { layer: 1, live: true, config: {}, message: 'Steel Chair' });
  spun(post);
};

/** The thread with the spun title, once the world's spin has made it. */
function useSpun(): ThreadSummary | null {
  const { api } = useKayfa();
  const [found, setFound] = useState<ThreadSummary | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await seeded;
      for (let attempt = 0; attempt < 40 && live; attempt++) {
        for (const board of await api.boards()) {
          const hit = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === SPUN);
          if (hit) { if (live) setFound(hit); return; }
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
    return () => { live = false; };
  }, [api]);
  return found;
}

interface Args { readonly shown: Case; readonly mode?: 'light' | 'dark'; readonly bright?: boolean }

function Spun({ mode = 'light', bright = false }: Args) {
  const spun = useSpun();
  const sown = useRef(false);
  useEffect(() => {
    if (!spun?.firstAct || sown.current) return;
    sown.current = true;
    const first = spun.firstAct;
    /* Once the box is drawn, and the page has had a moment to listen. */
    let tries = 0;
    const tick = () => {
      if (document.querySelector('.kb-origin')) setTimeout(() => onOpening?.(first), 300);
      else if (++tries < 200) setTimeout(tick, 50);
    };
    tick();
  }, [spun]);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    root.setAttribute('data-kb-motion', 'full');
    if (bright) root.setAttribute('data-kb-effects', 'bright');
    return () => { root.removeAttribute('data-kb-mode'); root.removeAttribute('data-kb-motion'); root.removeAttribute('data-kb-effects'); };
  }, [mode, bright]);
  useEffect(() => {
    window.__kbOriginFab = {
      async size(nth) {
        const cv = document.querySelectorAll<HTMLCanvasElement>('.kb-origin canvas.dw-fab-foil')[nth];
        if (!cv) return null;
        if (foilProbe.idOf(cv) === undefined) return { w: cv.width, h: cv.height };
        return (await foilProbe.sizes()).get(cv) ?? null;
      },
    };
    window.__kbOriginShine = {
      hosts: () => [...document.querySelectorAll('[data-kb-fab]')].map((el) => {
        const r = (el.querySelector(':scope > canvas') ?? el).getBoundingClientRect(), o = el.getBoundingClientRect();
        return { draws: probe.draws(el), top: r.top, bottom: r.bottom, width: r.width, own: { top: o.top, bottom: o.bottom, width: o.width }, share: probe.share(el), inBox: el.closest('.kb-origin') !== null };
      }),
      frames: probe.frames,
      running: probe.running,
      carried: cling.carried,
    };
    return () => { delete window.__kbOriginFab; delete window.__kbOriginShine; };
  }, []);
  return <Frame>{spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Spun> = {
  title: 'Boards/26 Origin effects',
  component: Spun,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Spun>;
const phone = { viewport: { value: 'glassPhone390', isRotated: false } };
const of = (shown: Case, args: Partial<Args> = {}): Story => ({ args: { shown, ...args }, parameters: { world: worldOf(shown) } });

/** Whoops! on a three-line, edited post, the box showing it live. */
export const Whoops: Story = of('whoops');
/** The same, spun from the Whoops! play: the box shows the play's moment. */
export const WhoopsLanded: Story = of('landed');
/** Feelin' Fab on one line, live. */
export const Fab: Story = of('fab');
/**
 * Feelin' Fab under Brighter effects, a quote in the box, and Feelin' Fab on the spin's opening post too. A fixture of the engine's rule, not a state the server
 * produces (issue #739): the opening Act of a spun thread is a `spin` Act, and the server returns plays of post reach only for `post` Acts, refusing a post-reach
 * card on anything else. The play is seeded as a live delivery because the fake, like the server, returns none for a `spin` Act; the story holds what the engine
 * does for whatever effect is on the opening post.
 */
export const FabBright: Story = of('bright', { bright: true });
/** Glitter Bomb on a character, spun from a post of theirs: the box shows it as it was spun. */
export const GlitterSpun: Story = of('glitter');
/** Hot Box on a three-line post, live. */
export const HotBox: Story = of('hotbox');
/** Steel Chair on a three-line post, live. */
export const Chair: Story = of('chair');
/** Steel Chair on one short line, live. */
export const ChairShort: Story = of('chair-short');
/**
 * A plain post in the box, under Whoops! and Hot Box on the opening post around it. A fixture of the engine's rule, not a state the server produces (issue #739):
 * the opening Act of a spun thread is a `spin` Act, the server returns plays of post reach only for `post` Acts and refuses a post-reach card (Whoops!, Hot Box) on
 * anything else, so these two plays are seeded as live deliveries, the fake returning none for a `spin` Act as the server does. The story holds the engine's rule:
 * the box stands over whatever effect is on its opening post, and takes none of its presses.
 */
export const Under: Story = of('under');
/**
 * Glitter Bomb on the character who spun the thread, who also has a post on the thread's first page (the server delivers a character's plays only when that
 * character has a `post` Act on the page): the opening post is really glittered, and the box shows a plain post by another character, live, over it.
 */
export const GlitterOver: Story = of('over');
/** Whoops! at the phone's width. */
export const WhoopsPhone: Story = { ...of('whoops'), globals: phone };
