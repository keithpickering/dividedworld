/**
 * A card armed on the Phone board's layout, drawn as a story for the owner because no board draws
 * it (the glass plan, section 8: what no board draws is a story first; board 02 is the thread with
 * the HUD and nothing armed, board 01 is the Main board with the fan open and Whoops! armed). It is
 * the thread itself in the Frame, at the boards fixture's `02-phone` moment, with Whoops! armed the
 * way pressing its card in the hand arms it. Open the story at 390 by 844.
 *
 * Two states. `Armed`: the hand's sheet is put away, because it covers the posts to pick; each post
 * the card can land on carries its ghost mark, "Play Whoops! on post N". `HandReopened`: the hand is opened again, and the
 * armed card is shown pressed. Armed, the HUD's hand button reads "Armed · Whoops!" and one press puts
 * the card back, which is how a phone, with no Esc, does (the owner's answer on #80).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { Frame } from '../frame/Frame.tsx';
import { useKayfa } from '../context.tsx';
import { useLocation } from '../router.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { usePlay } from './play.tsx';

/** The card the board arms: the instance's Whoops!, by its key (the story names no instance, so it is the card whose name is Whoops!). */
function Arm({ reopen }: { readonly reopen: boolean }) {
  const { instance } = useKayfa();
  const play = usePlay();
  const key = instance.cards.find((c) => c.name === 'Whoops!')?.key ?? null;
  useEffect(() => {
    if (!play || key === null) return;
    play.arm(key);
    if (reopen) play.setHandOpen(true);
    // Armed once, as the player's press does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function ArmedThread({ reopen }: { readonly reopen: boolean }) {
  /* The thread the moment opens on (`/t/<thread>`). */
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  return (
    <Frame>
      <Arm reopen={reopen} />
      {thread ? <ThreadScreen thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof ArmedThread> = {
  title: 'Boards/02 Armed Phone',
  component: ArmedThread,
  parameters: { moment: '02-phone', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof ArmedThread>;

/** Whoops! armed, the sheet put away: the posts it can land on offer their ghost marks, "Play Whoops! on post N". */
export const Armed: Story = { args: { reopen: false } };
/** The hand opened again with the armed card pressed. */
export const HandReopened: Story = { args: { reopen: true } };
