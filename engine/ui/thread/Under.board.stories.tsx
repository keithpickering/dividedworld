/**
 * A reply cut in under its post (docs/plans/2026-11-11-card-notes-part-2-plan.md, Task 9), drawn as a story for the owner: a thread of six posts with a
 * reply nested under its second post, with the rail down its left edge and its own heading, and its own number left out of the line, on the light board
 * and the dark. The card is the instance's first card that carries a reply (`CardRules.replies`), found by its flag and never by name; a world with none
 * says so on the page. The reply is written by the play itself, as the game writes it. The page is the thread screen itself, as the route /t/:thread
 * draws it, signed in as the player.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { LoadedThread } from '../loaded.tsx';
import type { World } from '../story.tsx';

const T0 = Date.UTC(2026, 9, 20, 12);
const MIN = 60_000;
const TITLE = 'Who is cutting the line?';

const under: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key, { at: T0 });
  const spritey = fake.seed.character(fake.seed.account('story-other'), 'Spritey', (instance.classes[1] ?? instance.classes[0]!).key, { at: T0 });
  fake.seed.settle({ at: T0, standings: { [mine]: 650, [spritey]: 120 } });
  const general = instance.boards.find((b) => !b.system)!.slug;
  const t = fake.seed.thread(general, spritey, TITLE, 'The line for the vending machine is out the door again.', { at: T0 + MIN });
  fake.seed.post(t.thread, spritey, 'It moves, though. Slowly, but it moves.', { at: T0 + 2 * MIN });
  fake.seed.post(t.thread, mine, 'Somebody walked straight to the front.', { at: T0 + 3 * MIN });
  fake.seed.post(t.thread, mine, 'Rude, and I respect it.', { at: T0 + 4 * MIN });
  fake.seed.post(t.thread, spritey, 'Fine. Back of the line for everyone.', { at: T0 + 5 * MIN });
  fake.signInAs(me);
};

interface Args { readonly mode: 'light' | 'dark' }

/** The thread once the reply is cut in: the play is made as the player makes it, so the page reads it as any page would. */
function Cut({ mode }: Args) {
  const { api, instance } = useKayfa();
  const [thread, setThread] = useState<string | null | 'missing'>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    return () => root.removeAttribute('data-kb-mode');
  }, [mode]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const card = instance.cards.find((c) => c.replies === true);
      if (!card) { if (live) setThread('missing'); return; }
      for (const board of await api.boards()) {
        const found = (await api.threads(board.id, { offset: 0, limit: 200 })).threads.find((x) => x.title === TITLE);
        if (!found) continue;
        const acts = await api.acts(found.id, 1, 6);
        const second = acts.find((a) => a.seq === 2);
        const caster = acts.find((a) => a.seq === 3)?.character;
        if (!second || !caster) continue;
        (api as Fake).seed.cards((await api.session()).account!, { [card.key]: 1 });
        await api.playCard(card.key, caster, second.id, {}, '', undefined, undefined, undefined, { body: 'Excuse me. I was here first. I was just standing somewhere else.' });
        if (live) setThread(found.id);
        return;
      }
      if (live) setThread('missing');
    })();
    return () => { live = false; };
  }, [api, instance]);
  if (thread === 'missing') return <p role="alert">The story's world has no card that carries a reply, or no thread titled for it.</p>;
  return thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />;
}

const meta: Meta<typeof Cut> = {
  title: 'Boards/22 Reply cut in',
  component: Cut,
  parameters: { world: under, path: '/t/x', layout: 'fullscreen' },
  args: { mode: 'light' },
};
export default meta;

type Story = StoryObj<typeof Cut>;

/** The reply under the thread's second post, on the light board. */
export const UnderLight: Story = { args: { mode: 'light' } };
/** The same, on the dark board. */
export const UnderDark: Story = { args: { mode: 'dark' } };
