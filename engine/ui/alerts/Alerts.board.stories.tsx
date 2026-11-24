/**
 * Alerts, drawn as a story against the board `docs/research/2026-11-02-alerts/02-alerts.html` (the alerts plan, Task 9): the player's alerts in the
 * pause menu, newest first, with the divider "new since you last looked" at the account's mark and Earlier under it, and the filters by character.
 * The page is the screen itself (`LoadedAlerts`, the screen under its route's loader) in the glass's page shell, as the route /alerts puts it (web/src/App.tsx), signed in as a player
 * with three characters. The rows are the board's kinds, read from a world on the fake backend, so their words are the engine's own words:
 * a quote, a followed thread, a card on a post, a hint and a ruling after the mark; a settlement, an update, and the Boss's arrival before it.
 * Every sub of a ruling, a card an admin ended or refunded, a drawing, a gift and each real moderation outcome is there too, each about an Act in the shape the server writes it
 * (an infraction with its Mod's key and the post it names, a move with its params, a donation with its hundredths, a draw on a wall), so the words are what a player reads.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import { cardOf, classOf, type World } from '../story.tsx';
import { LoadedAlerts } from '../loaded.tsx';
import type { Id } from '../data/api.ts';

/** The card played on the post. */
const PLAYED = '4d-chess';

const utc = (day: number, hour: number, minute = 0) => Date.UTC(2026, 10, day, hour, minute);

const alerts: World = (fake, instance) => {
  const { seed } = fake;
  const cls = classOf(instance.classes, 'face').key;
  const other = classOf(instance.classes, 'heel').key;
  const me = seed.account('player');
  const friend = seed.account('friend');
  const bo = seed.account('caster');
  const pipewrench = seed.character(me, 'Pipewrench', cls);
  const hooligan = seed.character(me, 'Mrs. Hooligan', other);
  const spritey = seed.character(me, 'Spritey', cls);
  const gloomba = seed.character(friend, 'Gloomba', other);
  const quoter = seed.character(bo, 'Thwomp', cls);
  /* The card played on the post, by key, so a card added later to the instance's list changes no row. */
  const card = cardOf(instance.cards, PLAYED).key;
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
  /* The new lines, each about an Act as the server writes it; the staff, cards and groups come from the instance by what they do, so a change to its lists changes no row. */
  const mod = seed.staff('hall-monitor', 'Hall Monitor', 'mod');
  const fall = instance.cards.find((c) => c.discipline?.kind === 'fall');
  const drive = instance.cards.find((c) => c.drive !== undefined);
  const wall = instance.cards.find((c) => c.surface !== undefined);
  const punishment = instance.groups.conferred.find((g) => g.tone === 'punishment');
  if (!fall || !drive || !wall || !punishment) throw new Error('the instance has no fall card, drive card, wall card or punishing group, which this story names');
  const at = (minute: number) => utc(2, 9, minute);
  const mine = (kind: 'ruling' | 'cardEnded' | 'cardOnYours' | 'gift' | 'conduct', sub: string | null, act: Id, character: Id, minute: number) => seed.alert(me, { kind, ...(sub === null ? {} : { sub }), act, character, at: at(minute) });
  const filed = seed.post(splat.thread, pipewrench, 'Posting again, and again.', { at: utc(2, 9, 0) });
  const warning = seed.infraction(seed.visit(mod, filed, { at: utc(2, 9, 1) }), { points: 3, at: utc(2, 9, 2) });
  mine('ruling', 'warning', warning, pipewrench, 20);
  mine('ruling', 'ban', seed.ban(pipewrench, utc(5, 9), { infraction: warning, days: 3, at: utc(2, 9, 3) }), pipewrench, 21);
  const shielded = seed.post(splat.thread, pipewrench, 'This one was spared.', { at: utc(2, 9, 4) });
  seed.card(quoter, shielded, fall.key, { at: utc(2, 9, 5) });
  mine('ruling', 'fallTaken', seed.infraction(seed.visit(mod, shielded, { at: utc(2, 9, 6) }), { at: utc(2, 9, 7) }), pipewrench, 22);
  const report = seed.report(pipewrench, seed.post(ink.thread, gloomba, 'Words that broke a rule.', { at: utc(2, 9, 8) }), 'This breaks the spirit of the board.', { at: utc(2, 9, 9) });
  mine('ruling', 'reportJudged', seed.verdict(report, mod, 'dismissed', { at: utc(2, 9, 10) }), pipewrench, 23);
  mine('ruling', 'reportRefunded', seed.report(pipewrench, filed, 'A report no Mod could hear.', { at: utc(2, 9, 11) }), pipewrench, 24);
  const appeal = seed.appeal(pipewrench, warning, 'I did nothing wrong.', { at: utc(2, 9, 12) });
  mine('ruling', 'appealAnswered', seed.ruling(appeal, mod, 'reduced', { at: utc(2, 9, 13) }), pipewrench, 25);
  mine('ruling', 'appealRefunded', seed.appeal(pipewrench, warning, 'Please hear this one.', { at: utc(2, 9, 14) }), pipewrench, 26);
  mine('ruling', 'grouped', seed.groupMove('boss', { character: hooligan, group: punishment.key, at: utc(2, 9, 15) }), hooligan, 27);
  seed.board('crafts', 'Crafts');
  mine('ruling', 'threadMoved', seed.move('boss', { board: 'general', name: 'Crafts', lasting: { kind: 'moveThread', params: { thread: ink.thread, board: 'crafts' } }, at: utc(2, 9, 16) }), spritey, 28);
  mine('ruling', 'trophyReversed', ink.act, hooligan, 29);
  mine('ruling', 'gearGiven', ink.act, hooligan, 30);
  const poll = seed.poll(ink.act, { question: 'Best ink color?', options: ['Blue', 'Black'], pick: 1, secret: false, lasts: '24 hours' }, { at: utc(2, 9, 17) });
  mine('ruling', 'pollClosed', seed.pollClose(poll, { at: utc(2, 9, 18) }), spritey, 31);
  const played = seed.card(pipewrench, ink.act, card, { at: utc(2, 9, 19) });
  mine('cardEnded', 'onYours', seed.cardEnd(seed.card(quoter, ink.act, card, { at: utc(2, 9, 32) }), { at: utc(2, 9, 33) }), spritey, 34);
  mine('cardEnded', 'refunded', played, pipewrench, 35);
  const wallPlay = seed.card(quoter, ink.act, wall.key, { at: utc(2, 9, 36) });
  mine('cardOnYours', 'drew', seed.draw(quoter, wallPlay, { at: utc(2, 9, 37) }), spritey, 38);
  mine('gift', null, seed.donation(gloomba, seed.card(quoter, ink.act, drive.key, { at: utc(2, 9, 39) }), 500, { arrives: 375, at: utc(2, 9, 40) }), spritey, 41);
  const hidden = seed.post(ink.thread, spritey, 'A post that needed a hand.', { at: utc(2, 9, 42) });
  mine('conduct', 'hide', hidden, spritey, 43);
  mine('conduct', 'hideUntilEdited', hidden, spritey, 44);
  mine('conduct', 'unhide', hidden, spritey, 45);
  mine('conduct', 'approve', seed.edit(hidden, spritey, 'A post that was fixed.', { at: utc(2, 9, 46) }), spritey, 47);
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
