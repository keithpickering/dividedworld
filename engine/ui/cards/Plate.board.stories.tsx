/**
 * A card's plate and its play control over a post, drawn as stories for the owner because no board draws them (the
 * glass plan, section 8: what no board draws is a story first; the owner on #80's shots asked for the effect's words,
 * state and controls to be one deliberate game piece, "Play Whoops! here" among them, glass). Each is the thread
 * itself in the Frame, at the boards fixture's `01-main` moment, scrolled to the post to look at; open each at 390 by
 * 844 and at 1440 by 1120.
 *
 * Three states. `Splatted`: post #41, splatted by Mrs. Hooligan, with its plate: the readout (the card, how many
 * layers hold ink and how much is washed on this screen), "Hold to scrub", and, for its author, the tools. `Armed`: Whoops! armed
 * the way pressing its card in the hand arms it, and post #42, which has no effect yet, carries "Play Whoops! here" as a
 * glass tile of its own under it. `SplattedAndArmed`: both at once, #41 again: the play tile stands in the plate.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Frame } from '../frame/Frame.tsx';
import { useKayfa } from '../context.tsx';
import { useLocation } from '../router.tsx';
import { usePlayer } from '../player.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { usePlay } from './play.tsx';

/** Arms the instance's Whoops! (the story names no instance: the card whose name is Whoops!), as the player's press in the hand does. */
function Arm() {
  const { instance } = useKayfa();
  const play = usePlay();
  const key = instance.cards.find((c) => c.name === 'Whoops!')?.key ?? null;
  /* A card is armed for an account and put back when the account changes (play.tsx), so it is armed once the account is known. */
  const account = usePlayer().session.account;
  useEffect(() => {
    if (!play || key === null || account === null) return;
    play.arm(key);
    // Armed once for each account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, account]);
  return null;
}

/** Scrolls the post to look at to the middle of the window once the thread has drawn it. */
function Look({ post }: { readonly post: number }) {
  useEffect(() => {
    const timer = setInterval(() => {
      const el = document.getElementById(`post-${post}`);
      if (!el) return;
      clearInterval(timer);
      /* jsdom, where the stories are swept for accessibility, has no scrollIntoView; a throw in this timer ends the whole test run. */
      el.scrollIntoView?.({ block: 'center' });
    }, 100);
    return () => clearInterval(timer);
  }, [post]);
  return null;
}

function PlateThread({ armed, post }: { readonly armed: boolean; readonly post: number }) {
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  return (
    <Frame>
      {armed && <Arm />}
      <Look post={post} />
      {thread ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof PlateThread> = {
  title: 'Boards/01 Plate',
  component: PlateThread,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof PlateThread>;

/** Post #41, splatted: its plate under it, nothing armed. */
export const Splatted: Story = { args: { armed: false, post: 41 } };
/** Whoops! armed: post #42, with no effect, carries "Play Whoops! here" as a tile of its own. */
export const Armed: Story = { args: { armed: true, post: 42 } };
/** Both: #41 is splatted and Whoops! is armed, so its plate holds the play tile. */
export const SplattedAndArmed: Story = { args: { armed: true, post: 41 } };
