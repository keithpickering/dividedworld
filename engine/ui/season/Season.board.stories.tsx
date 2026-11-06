/**
 * The season page's News tab, drawn as a story against the board `docs/research/2026-11-02-alerts/04-season-news.html` (the alerts plan,
 * Task 8): Season 2 open, and, newest first, a debut, a Turn announced with its old class, the new Boss arriving with its first words,
 * Season 1's results (the top three, from the season's frozen rows, with their classes, two of them the player's own) and the old Boss leaving. The page is the screen itself
 * (`SeasonScreen`) in the glass's page shell, as the route /season puts it (web/src/App.tsx), signed in as the player, on the News tab.
 * The classes are the instance's, by their place in its list, so the story names none. The Rankings tab is two-worlds board 13 under the
 * same heading (`Rankings.board.stories.tsx`).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { SeasonScreen } from './Season.tsx';

const utc = (month: number, day: number, hour = 8, minute = 17) => Date.UTC(2026, month - 1, day, hour, minute);

/** Season 2, day 2, after Season 1's roll-over and a Turn and a debut at the next settlement. */
const news: World = (fake, instance) => {
  const cls = (i: number) => (instance.classes[i] ?? instance.classes[0]!).key;
  const { seed } = fake;
  const player = seed.account('player');
  const rival = seed.account('rival');
  const spritey = seed.character(player, 'Spritey', cls(0), { at: utc(10, 3) });
  const hooligan = seed.character(player, 'Mrs. Hooligan', cls(2), { at: utc(10, 3) });
  const pipewrench = seed.character(player, 'Pipewrench', cls(1), { at: utc(10, 3) });
  const gloomba = seed.character(rival, 'Gloomba', cls(1), { at: utc(10, 4) });
  const thwompson = seed.character(rival, 'Thwompson', cls(0), { at: utc(11, 2) });
  const lady = seed.staff('story-lady-ledger', 'Lady Ledger', 'boss', { at: utc(10, 1) });
  const mister = seed.staff('story-mister-spreadsheet', 'Mister Spreadsheet', 'boss', { at: utc(10, 1) });

  const board = instance.boards.find((b) => !b.system) ?? instance.boards[0]!;
  const system = instance.boards.find((b) => b.system) ?? board;
  const announcements = seed.thread(system.slug, null, 'Announcements', 'The System is open.', { at: utc(10, 1) });
  const said = seed.thread(board.slug, spritey, 'for the record', 'Here it is.', { at: utc(10, 12) });
  const revealed = seed.reveal(spritey, said.thread, { at: utc(10, 12, 9), class: cls(0) });
  const hooliganSaid = seed.thread(board.slug, hooligan, 'lurkers rule', 'Quiet.', { at: utc(10, 14) });
  const hooliganRevealed = seed.reveal(hooligan, hooliganSaid.thread, { at: utc(10, 14, 1), class: cls(2) });
  const shown = (act: string, at: number, cls_: string) => [{ kind: 'reveal' as const, act, at: new Date(at).toISOString(), class: cls_, was: null }];
  const turns = seed.thread(system.slug, null, 'Season 2: Promos', 'Every debut and Turn, as its player announced it.', { at: utc(11, 1) });
  seed.season({ number: 1, endsAt: new Date(utc(11, 1)).toISOString() });
  seed.season({ number: 2, startsAt: new Date(utc(11, 1)).toISOString(), turnsThread: turns.thread });
  seed.seasonResults(1, [
    { character: spritey, place: 1, standing: 985, shown: shown(revealed, utc(10, 12, 9), cls(0)) },
    { character: gloomba, place: 2, standing: 840 },
    { character: hooligan, place: 3, standing: 795, shown: shown(hooliganRevealed, utc(10, 14, 1), cls(2)) },
  ], { at: utc(11, 1) });
  seed.staffPost(lady, announcements.thread, 'The ledger is closed. Balance carried forward.', { at: utc(11, 1, 8, 20) });
  seed.staffPost(mister, announcements.thread, 'Efficiency is a virtue. So is fear. I have reviewed your posting cadence.', { at: utc(11, 1, 8, 21) });
  seed.handover({ outgoing: 'story-lady-ledger', boss: 'story-mister-spreadsheet', at: utc(11, 1) });
  seed.announce(thwompson, 'debut', { at: utc(11, 2) });
  seed.announce(pipewrench, 'turn', { at: utc(11, 2), was: cls(1) });
  fake.signInAs(player);
};

/** A season nothing has happened in yet. */
const empty: World = (fake) => {
  fake.signInAs(fake.seed.account('player'));
};

/** The screen at /season?tab=news, in its page shell. */
function SeasonStory() {
  return <Page surface="rankings"><SeasonScreen /></Page>;
}

const meta: Meta<typeof SeasonStory> = {
  title: 'Boards/04 Season news',
  component: SeasonStory,
  parameters: { world: news, path: '/season?tab=news', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof SeasonStory>;

/** The News tab on the Main board's layout, at 1440 wide. */
export const News: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const NewsPhone: Story = {
  name: 'News, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
/** Before anything has happened this season. */
export const Empty: Story = { parameters: { world: empty } };
