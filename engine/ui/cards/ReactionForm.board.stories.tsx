/**
 * The play form of a card that adds a reaction to one post (card notes Part 3, Task 12), on the boards fixture's player, opened as a player opens it:
 * the card is armed and the ghost on Pipewrench's own post #43 is pressed. `Form` is at the Main board's size and `FormPhone` its twin at 390 by 844.
 * The card is found by its rules (`reaction`), naming no card and no instance, and its form is the instance's own: whatever it draws in the form's place.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { usePlayer } from '../player.tsx';
import { useLocation } from '../router.tsx';
import { usePlay } from './play.tsx';

/** Does what a player does once the card is in her hand: arms it, then presses the ghost on #43 to open its play form (inside the frame, where the play controls are). */
function Act() {
  const { instance } = useKayfa();
  const play = usePlay();
  const player = usePlayer();
  const account = player.session.account;
  const key = instance.cards.find((c) => c.reaction === true)?.key;
  useEffect(() => {
    if (!play || account === null || !key || !player.cards.some((c) => c.card === key && c.held > 0)) return;
    /* Armed once (a second press of the armed card puts it back); the ghost is found in the page, as its own player finds it. */
    if (play.armed !== key) play.arm(key);
    const timer = setInterval(() => {
      const ghost = document.querySelector<HTMLButtonElement>('#post-43 .kb-ghost-mark');
      if (ghost) { clearInterval(timer); ghost.click(); }
    }, 150);
    return () => clearInterval(timer);
    // Once the hand holds the card, for each account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, player.cards]);
  return null;
}

function Scene() {
  const { api, instance } = useKayfa();
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const player = usePlayer();
  const account = player.session.account;
  const [ready, setReady] = useState(false);
  const key = instance.cards.find((c) => c.reaction === true)?.key;
  /* The hand holds one of the card, and the player has met it, as a player who has bought it has; her rows are read again to say so. */
  useEffect(() => {
    if (thread === null || account === null || !key) return;
    void (async () => {
      await Promise.all(instance.cards.map((c) => api.meetCard(c.key)));
      (api as Fake).seed.cards(account, { [key]: 1 });
      await player.refresh();
      setReady(true);
    })();
    // The player's own rows are read once, for the account that is signed in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, instance, thread, account, key]);
  return <Frame><Act />{thread && ready ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Scene> = { title: 'Boards/01 Reaction card form', component: Scene, parameters: { moment: '01-main', layout: 'fullscreen' } };
export default meta;
type S = StoryObj<typeof Scene>;

/** The reaction card's play form: an emoji field and the four quadrants it can score as, nothing chosen until the player chooses. */
export const Form: S = {};
export const FormPhone: S = { parameters: { moment: '02-phone' } };
