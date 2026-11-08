/**
 * The play form on the reader's own post #43 (Pipewrench's) of the boards fixture (docs/plans/2026-11-07-face-down-moves-design.md, section 8), as stories
 * for the owner's word: a Move in `Play` mode (Play it now chosen), the same Move in `SetFaceDown` mode (the sentence, the card's own
 * settings, "Ends by itself in N days."), and a Gimmick with a cast trap (`Gimmick`: opens as Set with no choice, and its picker of the cards
 * cast on a post), and the Move set with its optional Only when group open (`Conditions`). Each has its `Phone` twin at 390 by 844; open the others at 1440 by 1120.
 *
 * The story names no instance: the Move is the instance's first cast card with a settings form, the Gimmick its first set card with one.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { playOf } from '../../rules/cards.ts';
import { useKayfa } from '../context.tsx';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { useLocation } from '../router.tsx';
import { usePlayer } from '../player.tsx';
import { usePlay } from './play.tsx';

type Scene = 'play' | 'set' | 'gimmick' | 'conditions';

/** Arms the card, presses its mark on #41 once the thread has drawn it, and (for Set) chooses Set face down. */
function Open({ scene }: { readonly scene: Scene }) {
  const { instance, ui } = useKayfa();
  const play = usePlay();
  const account = usePlayer().session.account;
  const withForm = (key: string) => ui.cards.some((c) => c.key === key && c.ConfigForm);
  const key = instance.cards.find((c) => playOf(c) === (scene === 'gimmick' ? 'set' : 'cast') && withForm(c.key) && (scene !== 'gimmick' || c.trap?.trigger.on === 'cast'))?.key ?? null;
  /* The conditions scene opens the Only when group once the form is up. */
  useEffect(() => {
    if (scene !== 'conditions') return;
    const timer = setInterval(() => {
      const toggle = [...document.querySelectorAll<HTMLButtonElement>('.kb-play-when-toggle')][0];
      if (!toggle) return;
      clearInterval(timer);
      toggle.click();
    }, 100);
    return () => clearInterval(timer);
  }, [scene]);
  useEffect(() => {
    if (!play || key === null || account === null) return;
    play.arm(key);
    if (scene === 'set' || scene === 'conditions') play.choose(true);
    const timer = setInterval(() => {
      const mark = document.querySelector<HTMLButtonElement>('#post-43 .kb-ghost-mark');
      if (!mark) return;
      clearInterval(timer);
      mark.click();
    }, 100);
    return () => clearInterval(timer);
    // Opened once for each account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, account]);
  return null;
}

function Scene({ scene }: { readonly scene: Scene }) {
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const { api, instance } = useKayfa();
  useEffect(() => { for (const c of instance.cards) void api.meetCard(c.key); }, [api, instance]);
  return (
    <Frame>
      <Open scene={scene} />
      {thread ? <LoadedThread thread={thread} /> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Scene> = {
  title: 'Cards/Play form',
  component: Scene,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Scene>;
const phone = { parameters: { moment: '02-phone' } } as const;

/** A Move on the reader's own post: Play it now is chosen, with its message and its price. */
export const Play: Story = { args: { scene: 'play' } };
/** The same Move set face down: one sentence for what it does, the card's own settings, and when it ends by itself. */
export const SetFaceDown: Story = { args: { scene: 'set' } };
/** A Gimmick: opens as Set with no choice, and the picker of the cards it can wait for. */
export const Gimmick: Story = { args: { scene: 'gimmick' } };
/** The same, with the optional Only when group open: They say…, They quote… with the post's words to select from, and Who. */
export const Conditions: Story = { args: { scene: 'conditions' } };
export const PlayPhone: Story = { args: { scene: 'play' }, ...phone };
export const SetFaceDownPhone: Story = { args: { scene: 'set' }, ...phone };
export const GimmickPhone: Story = { args: { scene: 'gimmick' }, ...phone };
export const ConditionsPhone: Story = { args: { scene: 'conditions' }, ...phone };
