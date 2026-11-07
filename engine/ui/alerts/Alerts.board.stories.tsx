/**
 * Alerts, drawn as a story against the board `docs/research/2026-11-02-alerts/02-alerts.html` (the alerts plan, Task 9): the player's alerts in the
 * pause menu, newest first, with the divider "new since you last looked" at the account's mark and Earlier under it, and the filters by character.
 * The page is the screen itself (`LoadedAlerts`, the screen under its route's loader) in the glass's page shell, as the route /alerts puts it (web/src/App.tsx), signed in as a player
 * with three characters. The rows are the board's kinds, read from a world on the fake backend, so their words are the engine's own words:
 * a quote, a followed thread, a card on a post, a hint and a ruling after the mark; a settlement, an update, and the Boss's arrival before it.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { LoadedAlerts } from '../loaded.tsx';

const utc = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour, minute);

const alerts: World = (fake, instance) => {
  const { seed } = fake;
  const cls = instance.classes[0]!.key;
  const other = instance.classes[1]?.key ?? cls;
  const me = seed.account('player');
  const friend = seed.account('friend');
  const bo = seed.account('caster');
  const pipewrench = seed.character(me, 'Pipewrench', cls);
  const hooligan = seed.character(me, 'Mrs. Hooligan', other);
  const spritey = seed.character(me, 'Spritey', cls);
  const gloomba = seed.character(friend, 'Gloomba', other);
  const quoter = seed.character(bo, 'Thwomp', cls);
  const card = instance.cards[0]!.key;
  seed.settle({ at: utc(2, 8, 17) - 60_000, ledger: [{ character: pipewrench, reason: `${cls}.story`, amount: 42 }, { character: hooligan, reason: `${other}.story`, amount: 10 }] });
  const splat = seed.thread('general', pipewrench, 'who keeps splatting my posts', 'Somebody is doing it again.', { at: utc(1, 20) });
  const ink = seed.thread('general', spritey, 'best ink color, final answer', 'Defend your answer.', { at: utc(2, 8, 40) });
  seed.update({ title: 'Traps now bite board cards', body: 'Two balance changes and a fix for the log naming the wrong post.', at: utc(2, 8) });
  seed.staff('boss', 'The Boss', 'boss');
  seed.handover({ boss: 'boss', at: utc(1, 8, 17) });
  seed.post(splat.thread, quoter, 'You know exactly who.', { quote: splat.act, at: utc(2, 9, 36) });
  for (let i = 0; i < 4; i++) seed.post(ink.thread, gloomba, `Defending it, round ${i + 1}.`, { at: utc(2, 9, 20 + i) });
  seed.card(quoter, ink.act, card, { at: utc(2, 9, 38) });
  seed.alert(me, { kind: 'hint', act: ink.act, character: spritey, sub: 'leading:excitedNegative', at: utc(2, 9, 41) });
  seed.alert(me, { kind: 'ruling', act: splat.act, character: pipewrench, sub: 'warning', at: utc(2, 9, 20) });
  fake.signInAs(me);
  void fake.seeAlerts(new Date(utc(2, 8, 52)).toISOString());
};

/** The screen at /alerts, in its page shell. */
function AlertsStory() {
  return <Page surface="settings"><LoadedAlerts /></Page>;
}

const meta: Meta<typeof AlertsStory> = {
  title: 'Boards/02 Alerts',
  component: AlertsStory,
  parameters: { world: alerts, path: '/alerts', layout: 'fullscreen' },
};
export default meta;
export const Open: StoryObj<typeof AlertsStory> = {};
