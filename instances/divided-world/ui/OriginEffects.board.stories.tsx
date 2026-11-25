/**
 * Card effects in a spun thread's ORIGIN box as stories for the owner's word (docs/plans/2026-11-15-origin-box-effects-plan.md, Task 3; design, sections 2 to 7):
 * a thread of a board with a post by another character and the play or plays on it, then a thread spun from the post (or from the play), drawn at its first
 * page, where the ORIGIN box shows the post live, or as a moment. e2e/origin-effects.spec.ts measures each against the box's content area. The story route
 * renders no play function, so the spec moves the pointer itself. Open them at 1440 by 1120, the phone's twin at 390 by 844.
 *
 * - `Whoops`: a post of three lines, edited (so Last edited shows), with Whoops! on it, the box showing it live. `WhoopsLanded`: the same, spun from the
 *   Whoops! play, so the box shows the play's moment, "as it landed", which is playable: a scrub washes its ink and Reset brings it back. `WhoopsPhone`: as `Whoops`, at the phone's width.
 * - `Fab`: one line with Feelin' Fab on it, live. `FabBright`: the same with a quote in it, Brighter effects on, and Feelin' Fab on the spin's opening
 *   post too.
 * - `GlitterSpun`: a Glitter Bomb on a character, spun from a post of theirs ("as it was spun"), its glitter live: a moment is playable (docs/plans/2026-11-16-playable-moments-design.md). `GlitterOverWhoops` (and its `Phone` twin): the same, the post carrying an older, part-washed Whoops!, so the box has a second strip of marks for it.
 * - `HotBoxLanded`, `ChairOverWhoops`: a thread spun from a Hot Box play, so the box shows its moment (a smoke to clear by hand), and from a Steel Chair play on a post with an older, part-washed Whoops!, so the box draws both cards and has two marks. Each has a `Phone` twin.
 * - `ChairLanded`: a post that reads `!` with Steel Chair on it, spun from the play, so the box shows the play's moment (issue #768). `ChairLandedPhone`: the same at the phone's width.
 * - `HotBox`: three lines with Hot Box on it, live. `Chair`: three lines with Steel Chair on it, live. `ChairShort`: one short line with Steel Chair.
 * - `GlitterOver`: Glitter Bomb on the character who spun the thread (who also has a post on its first page, as the server requires), the box a plain post by another character, live, over the glittered opening post.
 * - `Under`: a plain post in the box (with a 4D Chess play, which draws nothing, so that it has a mark), and Whoops! and Hot Box on the spin's opening post around it: the box stands above them and takes none of their presses.
 *
 * The spin is made through the fake's own `spin`, by the signed-in player's character, and the thread is read once it has answered. The plays on the
 * spin's opening post are seeded as plays (`fake.seed.card`) on the spin's own Act, as a server holds them (a spun thread's opening post is a post for every
 * card), and the page carries them with the thread.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../engine/ui/context.tsx';
import type { ThreadSummary } from '../../../engine/ui/data/api.ts';
import { LoadedThread } from '../../../engine/ui/loaded.tsx';
import { foilProbe } from '../../../engine/ui/shine/foilClient.ts';
import { cling } from '../../../engine/ui/shine/flakes.ts';
import { probe } from '../../../engine/ui/shine/loop.ts';
import { cardOf, type World } from '../../../engine/ui/story.tsx';
import { packStroke } from '../cards/whoops/points.ts';
import { BRUSH_PX, brushOf } from '../cards/whoops/scrub.ts';

/** A play id that rolls a chair (steel-chair/objects.ts), so that the stories' Steel Chair is the chair e2e/origin-effects.spec.ts measures. */
const CHAIR_PLAY = 'play-0';
/** A play id that rolls a trash can (steel-chair/objects.ts): the lid comes off it at the hit and leaves the box (e2e/steel-chair.spec.ts). */
const CAN_PLAY = 'play-6';

declare global {
  interface Window {
    /** The nth foil canvas of the ORIGIN box, as the worker that draws it holds it (the canvas's own size where the page draws it): e2e/origin-effects.spec.ts reads the backing size through it, since a handed-over canvas cannot be read on the page. */
    /** How many times the page asked the backend to save or release an effect's state since the story mounted (the fake's own `saveEffect` and `releaseEffect`, counted as they are called): e2e/origin-effects.spec.ts holds a moment to none. */
    __kbOriginSaves?: () => number;
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

type Case = 'whoops' | 'landed' | 'fab' | 'bright' | 'glitter' | 'hotbox' | 'hotbox-landed' | 'chair' | 'chair-short' | 'can' | 'chair-landed' | 'chair-whoops' | 'glitter-whoops' | 'under' | 'over';

const DAY = 86_400_000;
const MINUTE = 60_000;
/** The spun thread's title, which the page finds it by. */
const SPUN = 'Spun out of the box';
/** The world's spin, done: a story's world is made before it renders, and the thread's page is read once, so it is read after this. */
let seeded: Promise<void> = Promise.resolve();
/** Every card met, for the cases with marks on the opening post: an unmet card's one-line tip hangs off its mark and would stand over the box's own mark. */
let quiet = false;
const CYAN = '#19e3ff';
const PINK = '#ff69b4';

/* Strokes across the top of the box's area, in shares with its aspect, a brush apart, packed as the card saves them: nine rows, washed twice each, so the older Whoops! of `ChairOverWhoops` is part washed when the chair lands. */
const WHERE = brushOf(BRUSH_PX, { w: 988, h: 330 });
const PARTLY = Array.from({ length: 18 }, (_, n) => packStroke({ tool: 'wash', ...WHERE, points: [[0, 0.05 + (n % 9) * (WHERE.width * WHERE.aspect) * 0.7], [1, 0.05 + (n % 9) * (WHERE.width * WHERE.aspect) * 0.7]] }));

const THREE = [
  'The physics in the original engine were never the problem, and I will say so again.',
  'I played forty of the contest entries last weekend, and the ones that felt good all used the default settings.',
  'Anyway the new level editor is fine. Stop asking for slopes. That is all, and I will not be taking questions.',
].join('\n\n');
/** The same three lines, after an edit (the box's Last edited line shows only for a post that was). */
const THREE_EDITED = THREE.replace('and I will say so again', 'and I stand by that');
const ONE = 'Luigi wins, and that is the whole post.';
const SHORT = 'Luigi wins.';
/** The post of #768: a single `!`, so the ORIGIN box holds one short line and the dent must fit the room the box gives it. */
const BANG = '!';
const QUOTED = '[quote=Kooper Trooper]The best driver in the series is Luigi.[/quote]The best driver in the series is, in fact, Luigi.';
const PLAIN = 'A plain post, with nothing on it of its own, and a box that stands over its opening post\'s effects.';

/** A thread with a post by another character and the plays each case calls for, a thread spun from it by the player's character, and the plays on that thread's opening post. */
const worldOf = (shown: Case): World => (fake, instance) => {
  const [first, second] = instance.classes;
  const player = fake.seed.account('story-player', { seasoned: true });
  const mine = fake.seed.character(player, 'Pipewrench', first!.key);
  /* The fake's clock is brought to the page's (a play's end, and the smoke's strength, are read against it), as the Jimmy Wails stories do. */
  fake.clock.advance(Date.now() - fake.clock.now());
  const kooper = fake.seed.account('kooper');
  const author = fake.seed.character(kooper, 'Kooper Trooper', first!.key);
  const caster = fake.seed.character(fake.seed.account('spritey'), 'Spritey', (second ?? first)!.key);
  const board = instance.boards.find((b) => !b.system)!.slug;
  const made = fake.seed.thread(board, author, 'Ranking every Mario Kart', 'Ranking every Mario Kart, worst to best.');
  const now = fake.clock.now();
  const words = shown === 'whoops' || shown === 'landed' || shown === 'hotbox' || shown === 'hotbox-landed' || shown === 'chair' || shown === 'can' || shown === 'chair-whoops' ? THREE
    : shown === 'chair-short' ? SHORT
      : shown === 'chair-landed' ? BANG
        : shown === 'bright' ? QUOTED
          : shown === 'under' || shown === 'over' ? PLAIN
            : ONE;
  const post = fake.seed.post(made.thread, author, words);
  if (shown === 'whoops' || shown === 'landed') fake.seed.edit(post, author, THREE_EDITED);
  /* The seed (2591) holds the area's bottom-left corner at both widths (field about 2 at 2px in, over the ink's threshold of 0.42, at every area from 300 to 1000 wide and 180 to 400 tall that was tried) and ink along the byline at 965 by 220 and at 348 by 328 (found by running `makeSplat`/`fieldAt` over seeds against the measured areas).
     A search over 60000 seeds for one that clears the threshold over a whole byline band and the corner at every size of that spread found none (a splat is centered, and the byline is a thin strip at the top-left), so the spec reads along the byline's own row for a run of solid ink and does not rely on one point. A splat is only where its seed put it. */
  const whoops = () => ({ layer: 1, live: true, config: { color: CYAN, seed: 2591 }, message: 'cyan, obviously' });
  fake.signInAs(player);
  quiet = shown === 'under' || shown === 'bright' || shown === 'chair-landed' || shown === 'chair-whoops' || shown === 'hotbox-landed' || shown === 'glitter-whoops';
  /*
   * The opening post's own plays, seeded on the spin's own Act once the spin has answered: a spun thread's opening Act is a post for every card (cards on a spun
   * thread, docs/plans/2026-11-16-cards-on-a-spun-thread-design.md), so `FabBright`'s Feelin' Fab and `Under`'s Whoops! and Hot Box on the opening post are plays the
   * page carries with the thread. `GlitterOver` is a play on the character, which the server delivers with any post of theirs on the page.
   */
  const opening = (act: string): void => {
    if (shown === 'bright') fake.seed.card(caster, act, cardOf(instance.cards, 'feelin-fab').key, { layer: 1, live: true, config: {}, message: 'Fab' });
    if (shown === 'under') {
      fake.seed.card(caster, act, cardOf(instance.cards, 'whoops').key, { layer: 1, live: true, config: { color: '#ff2bd6', seed: 20261115 }, message: 'pink, obviously' });
      fake.seed.card(author, act, cardOf(instance.cards, 'hot-box').key, { layer: 2, live: true, config: { color: PINK }, message: 'Smoke out', ends: new Date(now + 3 * DAY).toISOString() });
    }
  };
  const spun = (from: string | Promise<string>, at?: string) => {
    seeded = Promise.resolve(from).then((play) => fake.spin(play, mine, SPUN, 'Carrying on over here.', undefined, at)).then((answer) => {
      if (!answer.ok) throw new Error(`the spin was refused: ${answer.error}`);
      opening(answer.value.act.id);
      /* Glitter Bomb is a play on a character, and the server delivers a character's plays only with a post of that character on the page: so the spinner has a post on the first page too. */
      if (shown === 'over') fake.seed.post(answer.value.thread.id, mine, 'And a post of my own, so that the glitter on me is delivered with this page.');
    });
  };
  if (shown === 'glitter' || shown === 'glitter-whoops') {
    /* A card on a character, cast from a post of one thread and pressed on a post of that character's in another, as the spin-at-post stories do. */
    const cast = fake.seed.thread(board, author, 'Where the bomb was cast', 'The post the bomb was cast from.');
    const shiny = fake.seed.thread(board, mine, 'Why are my posts shiny', 'A post of mine.');
    const pressed = fake.seed.post(shiny.thread, author, THREE);
    const play = fake.seed.reach(caster, 'character', author, cardOf(instance.cards, 'glitter-bomb').key, { post: cast.act, ends: now + 5 * DAY, message: 'Sparkle.' });
    if (shown === 'glitter') { spun(play, pressed); return; }
    /* The pressed post carries an older, part-washed Whoops! (saved as its author, who is signed in only for it): the spin's moment draws it around the glitter, so the box has a second strip of marks beside the character's, for the post's own card. */
    const older = fake.seed.card(caster, pressed, cardOf(instance.cards, 'whoops').key, whoops());
    spun((async () => {
      fake.clock.advance(MINUTE);
      fake.signInAs(kooper);
      const saved = await fake.saveEffect(older, author, { strokes: PARTLY });
      fake.signInAs(player);
      if (!saved.ok) throw new Error(`the wash was refused: ${saved.error}`);
      return play;
    })(), pressed);
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
  if (shown === 'chair-landed') {
    /* The thread is spun from the play, so the box shows the chair's moment, "as it landed" (the case of issue #768). */
    const play = fake.seed.card(caster, post, cardOf(instance.cards, 'steel-chair').key, { layer: 1, live: true, config: {}, message: 'Steel Chair', id: CHAIR_PLAY });
    spun(play);
    return;
  }
  if (shown === 'hotbox-landed') {
    /* The thread is spun from the smoke's play, so the box shows its moment: the smoke as thick as it was when it landed, on a page that has since run for minutes. */
    const play = fake.seed.card(caster, post, cardOf(instance.cards, 'hot-box').key, { layer: 1, live: true, config: { color: PINK }, message: 'Smoke out', at: now, ends: new Date(now + 3 * DAY).toISOString() });
    spun(play);
    return;
  }
  if (shown === 'chair-whoops') {
    /* A Whoops! that landed first and was part washed by the post's author, then a Steel Chair on top of it, and the thread spun from the chair: the box shows the chair's moment with both cards drawn, so it has two marks (the design's section 6). */
    const older = fake.seed.card(caster, post, cardOf(instance.cards, 'whoops').key, whoops());
    spun((async () => {
      fake.clock.advance(MINUTE);
      /* Saved as the post's author, who is signed in only for it: the story's reader is the player. */
      fake.signInAs(kooper);
      const saved = await fake.saveEffect(older, author, { strokes: PARTLY });
      fake.signInAs(player);
      if (!saved.ok) throw new Error(`the wash was refused: ${saved.error}`);
      fake.clock.advance(MINUTE);
      return fake.seed.card(caster, post, cardOf(instance.cards, 'steel-chair').key, { layer: 2, live: true, config: {}, message: 'Steel Chair', id: CHAIR_PLAY });
    })());
    return;
  }
  if (shown === 'chair' || shown === 'chair-short' || shown === 'can') fake.seed.card(caster, post, cardOf(instance.cards, 'steel-chair').key, { layer: 1, live: true, config: {}, message: 'Steel Chair', id: shown === 'can' ? CAN_PLAY : CHAIR_PLAY });
  spun(post);
};

/** The thread with the spun title, once the world's spin has made it. */
function useSpun(): ThreadSummary | null {
  const { api, instance } = useKayfa();
  const [found, setFound] = useState<ThreadSummary | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await seeded;
      if (quiet) for (const c of instance.cards) await api.meetCard(c.key);
      for (let attempt = 0; attempt < 40 && live; attempt++) {
        for (const board of await api.boards()) {
          const hit = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === SPUN);
          if (hit) { if (live) setFound(hit); return; }
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
    return () => { live = false; };
  }, [api, instance]);
  return found;
}

interface Args { readonly shown: Case; readonly mode?: 'light' | 'dark'; readonly bright?: boolean }

function Spun({ mode = 'light', bright = false }: Args) {
  const spun = useSpun();
  const { api } = useKayfa();
  useEffect(() => {
    /* The backend is the in-page fake, so a save is never a network request: it is counted where the fake takes it. */
    let saves = 0;
    const { saveEffect, releaseEffect } = api;
    api.saveEffect = (...a) => { saves++; return saveEffect.apply(api, a); };
    api.releaseEffect = (...a) => { saves++; return releaseEffect.apply(api, a); };
    window.__kbOriginSaves = () => saves;
    return () => { api.saveEffect = saveEffect; api.releaseEffect = releaseEffect; delete window.__kbOriginSaves; };
  }, [api]);
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
/** Feelin' Fab under Brighter effects, a quote in the box, and Feelin' Fab on the spin's opening post too: a play seeded on the spin's own Act. */
export const FabBright: Story = of('bright', { bright: true });
/** Glitter Bomb on a character, spun from a post of theirs: the box shows it as it was spun. */
export const GlitterSpun: Story = of('glitter');
/** Glitter Bomb on a character, spun from a post of theirs that carries an older, part-washed Whoops!: the box shows the post as it was spun with both drawn, the character's mark and a second one for the post's Whoops!. */
export const GlitterOverWhoops: Story = of('glitter-whoops');
/** The same at the phone's width. */
export const GlitterOverWhoopsPhone: Story = { ...of('glitter-whoops'), globals: phone };
/** Hot Box on a three-line post, live. */
export const HotBox: Story = of('hotbox');
/** Steel Chair on a three-line post, live. */
export const Chair: Story = of('chair');
/** Steel Chair rolling a trash can on a three-line post, live: its lid comes off at the hit and leaves the box. */
export const Can: Story = of('can');
/** Steel Chair on one short line, live. */
export const ChairShort: Story = of('chair-short');
/** Steel Chair on a post that reads `!`, the thread spun from the play: the box shows the play's moment, with the cards met so no tip covers it (issue #768). */
export const ChairLanded: Story = of('chair-landed');
/** The same at the phone's width. */
export const ChairLandedPhone: Story = { ...of('chair-landed'), globals: phone };
/** A plain post in the box, under Whoops! and Hot Box on the opening post around it, plays seeded on the spin's own Act: the box stands over the effects on its opening post, and takes none of its presses. */
export const Under: Story = of('under');
/**
 * Glitter Bomb on the character who spun the thread, who also has a post on the thread's first page (the server delivers a character's plays only when that
 * character has a `post` Act on the page): the opening post is really glittered, and the box shows a plain post by another character, live, over it.
 */
export const GlitterOver: Story = of('over');
/** Whoops! at the phone's width. */
export const WhoopsPhone: Story = { ...of('whoops'), globals: phone };
/** Hot Box on a three-line post, the thread spun from the play: the box shows its moment, a smoke to clear by hand, and Reset in its head. */
export const HotBoxLanded: Story = of('hotbox-landed');
/** The same at the phone's width. */
export const HotBoxLandedPhone: Story = { ...of('hotbox-landed'), globals: phone };
/** A Steel Chair spun on a post that already has an older, part-washed Whoops!: the box shows the chair's moment with both drawn, and two marks. */
export const ChairOverWhoops: Story = of('chair-whoops');
/** The same at the phone's width. */
export const ChairOverWhoopsPhone: Story = { ...of('chair-whoops'), globals: phone };
