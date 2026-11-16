/**
 * One story for each effect on the tile layer, on a post of the longest length the instance allows (docs/plans/2026-11-16-effect-tiles-design.md,
 * section 6, guard 3), for e2e/effect-tiles.spec.ts, which scrolls each from top to bottom and measures the layer's own time in a frame and the
 * canvas pixels held in a real page. Post #43 of the boards fixture at the Main board's moment, as Hot Box's stories take it, edited by
 * `fake.seed.edit` to `postMaxLength` characters (read from the settings the page was given, never written here) in short paragraphs, so the post is
 * tall at both widths.
 *
 * `BUDGET` is the seeding of each effect, by the name of the effect's folder under instances/divided-world/ui/. tools/check-effect-canvas.mjs holds that
 * every instance file that imports the layer (engine/ui/cards/tiles.ts) is in a folder that is a key of `BUDGET`, so an effect cannot go on the layer and
 * skip the measuring. A key's story is the export named for it (`hot-box` is `HotBox`), and EffectBudget.test.tsx holds that none is missing, since a
 * module's exports cannot be made from a map.
 *
 * Telling the stories apart, for the spec: a budget story's id is `boards-25-effect-budget--<key>` and carries the tag `effect-budget` (and `effect-hides-words` where the effect covers the post's words, which the spec holds are never bare); a poison's id begins
 * `boards-25-effect-budget--poison-` and carries the tag `effect-poison`. The page hands the spec the tile loop's probe as `window.__kbTiles`
 * (engine/ui/cards/tileLoop.ts: `work`, `held`, `frames`, `running`, `reset`), as Shine.board.stories.tsx hands over the shine loop's; the application exposes
 * nothing.
 *
 * The two poisons are for the spec to see its checks go red (a guard never red is not known to work), each on the same post with no effect played on it.
 * `PoisonSlow` makes a layer of the story's own over the post whose painter spins for 25 ms, so the loop's own time in a frame is over its bound.
 * `PoisonWhole` lays one `<canvas>` the size of the whole post body into it, so the pixels held are far over the figure. The check does not read a story file, so
 * a canvas here is no fault of the build's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../engine/ui/context.tsx';
import type { Fake } from '../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../engine/ui/router.tsx';
import { LoadedThread } from '../../../engine/ui/loaded.tsx';
import { cardOf } from '../../../engine/ui/story.tsx';
import { bodyOf } from '../../../engine/ui/cards/body.ts';
import { makeTileLayer } from '../../../engine/ui/cards/tiles.ts';
import { probe } from '../../../engine/ui/cards/tileLoop.ts';

const DAY = 86_400_000;

declare global {
  interface Window {
    /** The tile loop's probe (engine/ui/cards/tileLoop.ts), for e2e/effect-tiles.spec.ts. */
    __kbTiles?: typeof probe;
  }
}

type SeedCard = Fake['seed']['card'];
/** Seeds one play of an effect on the post: who played it, on which Act, and the page's time. */
type Seeding = (fake: Fake, caster: Parameters<SeedCard>[0], target: Parameters<SeedCard>[1], now: number, cards: Parameters<typeof cardOf>[0]) => void;

/** One seeding for each effect on the tile layer, by the name of the effect's folder (tools/check-effect-canvas.mjs holds that none is missing). */
export const BUDGET = {
  'hot-box': (fake, caster, target, now, cards) => {
    fake.seed.card(caster, target, cardOf(cards, 'hot-box').key, {
      layer: 1, live: true, config: { color: '#ff69b4' }, message: 'Smoke out', at: now, ends: new Date(now + 3 * DAY).toISOString(),
    });
  },
} satisfies Record<string, Seeding>;

type Effect = keyof typeof BUDGET;

/** Exactly `length` characters of short paragraphs (about a hundred characters each), so that the post is tall at both widths. */
function wordsOf(length: number): string {
  const paragraph = (i: number) => `Paragraph ${i + 1} of the long post. It is a few lines, no more, so that a reader has a page to scroll and the effect has a post to cover.`;
  let text = '';
  for (let i = 0; text.length < length; i++) text += (i === 0 ? '' : '\n\n') + paragraph(i);
  text = text.slice(0, length);
  /* A post is saved trimmed, so a cut that leaves a space or a break at its end would be shorter than asked. */
  return /\s$/u.test(text) ? `${text.slice(0, -1)}.` : text;
}

interface Args {
  /** The effect played on the post, by the key of `BUDGET`; none for a poison. */
  readonly effect?: Effect;
  readonly poison?: 'slow' | 'whole';
}

/** The post's content area, once the thread has drawn it with its height. */
function usePostBody(thread: string | null, ready: boolean): HTMLElement | null {
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!ready || thread === null) return;
    let handle = 0;
    const look = () => {
      const el = document.getElementById('post-43')?.querySelector<HTMLElement>('[data-kb-content-area]') ?? null;
      if (el && el.clientHeight > 0) setBody(bodyOf(el)); else handle = requestAnimationFrame(look);
    };
    look();
    return () => { cancelAnimationFrame(handle); setBody(null); };
  }, [thread, ready]);
  return body;
}

function Budgeted({ effect, poison }: Args) {
  const { api, instance, settings } = useKayfa();
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  /* The thread is drawn once the play is seeded: its page is read once, so a play seeded after the read is never drawn. */
  const [seeded, setSeeded] = useState<string | null>(null);
  useEffect(() => {
    window.__kbTiles = probe;
    return () => { delete window.__kbTiles; };
  }, []);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    void (async () => {
      const [[target], [caster]] = await Promise.all([api.acts(thread, 43, 43), api.acts(thread, 42, 42)]);
      if (!target?.character || !caster?.character) return;
      const fake = api as Fake;
      fake.seed.edit(target.id, target.character, wordsOf(settings.postMaxLength));
      if (effect) BUDGET[effect](fake, caster.character, target.id, api.now(), instance.cards);
      if (live) setSeeded(thread);
    })();
    return () => { live = false; };
  }, [api, instance, settings, thread, effect]);
  const body = usePostBody(thread, seeded === thread);
  useEffect(() => {
    if (!body || !poison) return;
    if (poison === 'slow') {
      /* A layer of the story's own, on the same post: every frame its painter spins for 25 ms. */
      const layer = makeTileLayer(body, {
        place: 'thread',
        paint: () => { for (const until = performance.now() + 25; performance.now() < until;) { /* busy */ } },
      });
      layer.loop(true);
      return () => layer.stop();
    }
    /* One canvas the size of the whole post body, which is what the layer exists to prevent. */
    const whole = document.createElement('canvas');
    whole.setAttribute('aria-hidden', 'true');
    whole.setAttribute('data-kb-effect-ink', '');
    whole.width = body.clientWidth;
    whole.height = body.clientHeight;
    Object.assign(whole.style, { position: 'absolute', left: '0', top: '0', width: `${body.clientWidth}px`, height: `${body.clientHeight}px`, pointerEvents: 'none' });
    body.appendChild(whole);
    return () => { whole.width = 0; whole.height = 0; whole.remove(); };
  }, [body, poison]);
  return <Frame>{thread && seeded === thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Budgeted> = {
  title: 'Boards/25 Effect budget',
  component: Budgeted,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  /* `BUDGET` is the story file's data, not a story. */
  excludeStories: ['BUDGET'],
};
export default meta;

type Story = StoryObj<typeof Budgeted>;

/* A budget story for each key of `BUDGET`, named for it: a key with no story here is held by EffectBudget.test.tsx. */
/* `effect-hides-words`: the effect covers the post's words, so the spec holds that no band of the post is ever bare (e2e/effect-tiles.spec.ts). */
export const HotBox: Story = { args: { effect: 'hot-box' }, tags: ['effect-budget', 'effect-hides-words'] };

export const PoisonSlow: Story = { args: { poison: 'slow' }, tags: ['effect-poison'] };
export const PoisonWhole: Story = { args: { poison: 'whole' }, tags: ['effect-poison'] };
