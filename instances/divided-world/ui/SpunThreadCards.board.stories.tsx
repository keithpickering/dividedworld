/**
 * Cards on a spun thread, as a browser lays them out (docs/plans/2026-11-16-cards-on-a-spun-thread-design.md, section 4; plan, Task 7). A thread spun from a
 * post of another character, whose opening post is the spinner's own `spin` Act, read at its first page: the ORIGIN box stands in the opening post's body,
 * over whatever effect the opening post wears. The player is the spinner and holds Whoops!, Good Vibes and Glitter Bomb, so the spec arms each and plays it
 * from the screens a player uses: the opening post's play mark, the thread's head, and the opening post's postbit. e2e/spun-thread-cards.spec.ts measures it.
 *
 * - `Cards`: the page at 1440 by 1120. The box's quoted post has a 4D Chess play (it draws nothing, so the box's band has a mark) and the opening post has one
 *   too (so its own strip of marks has a mark, which is never the band's).
 * - `CardsPhone`: the same at the phone's 390 by 844.
 *
 * Every card of the instance has been met, so no card's one-line tip hangs over the marks.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../engine/ui/context.tsx';
import type { ThreadSummary } from '../../../engine/ui/data/api.ts';
import { LoadedThread } from '../../../engine/ui/loaded.tsx';
import { cardOf, type World } from '../../../engine/ui/story.tsx';

/** The spun thread's title, which the page finds it by. */
const SPUN = 'Spun out of the box';
/** The world's spin, done: a story's world is made before it renders, and the thread's page is read once, so it is read after this. */
let seeded: Promise<void> = Promise.resolve();

const WORDS = [
  'The physics in the original engine were never the problem, and I will say so again.',
  'I played forty of the contest entries last weekend, and the ones that felt good all used the default settings.',
  'Anyway the new level editor is fine. Stop asking for slopes.',
].join('\n\n');

const world: World = (fake, instance) => {
  const [first, second] = instance.classes;
  const player = fake.seed.account('story-player', { seasoned: true });
  const mine = fake.seed.character(player, 'Pipewrench', first!.key);
  /* The fake's clock is brought to the page's, as the other ORIGIN stories bring it. */
  fake.clock.advance(Date.now() - fake.clock.now());
  const author = fake.seed.character(fake.seed.account('kooper'), 'Kooper Trooper', first!.key);
  const caster = fake.seed.character(fake.seed.account('spritey'), 'Spritey', (second ?? first)!.key);
  const board = instance.boards.find((b) => !b.system)!.slug;
  const made = fake.seed.thread(board, author, 'Ranking every Mario Kart', 'Ranking every Mario Kart, worst to best.');
  const post = fake.seed.post(made.thread, author, WORDS);
  const chess = cardOf(instance.cards, '4d-chess').key;
  fake.seed.card(caster, post, chess, { layer: 1, live: true, config: {}, message: 'Check.' });
  fake.seed.cards(player, { [cardOf(instance.cards, 'whoops').key]: 2, [cardOf(instance.cards, 'good-vibes').key]: 1, [cardOf(instance.cards, 'glitter-bomb').key]: 1 });
  fake.seed.wallet(player, 1000);
  fake.signInAs(player);
  seeded = fake.spin(post, mine, SPUN, 'Carrying on over here.').then((answer) => {
    if (!answer.ok) throw new Error(`the spin was refused: ${answer.error}`);
    /* A play on the spin's own Act, which the thread's page carries as it carries a post's. */
    fake.seed.card(caster, answer.value.act.id, chess, { layer: 1, live: true, config: {}, message: 'Check.' });
  });
};

/** The thread with the spun title, once the world's spin has made it, and every card met. */
function useSpun(): ThreadSummary | null {
  const { api, instance } = useKayfa();
  const [found, setFound] = useState<ThreadSummary | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      await seeded;
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
  }, [api, instance]);
  return found;
}

function Spun() {
  const spun = useSpun();
  return <Frame>{spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Spun> = {
  title: 'Boards/27 Cards on a spun thread',
  component: Spun,
  parameters: { layout: 'fullscreen', world },
};
export default meta;

type Story = StoryObj<typeof Spun>;

/** A thread spun from another character's post, read by its spinner, who holds Whoops!, Good Vibes and Glitter Bomb. */
export const Cards: Story = {};
/** The same at the phone's width. */
export const CardsPhone: Story = { globals: { viewport: { value: 'glassPhone390', isRotated: false } } };
