/**
 * Rankings, drawn first as a story for the owner (the glass plan, section 8), because no board
 * draws it. Once the owner approves it, the board is drawn from it as
 * docs/research/2026-10-29-two-worlds/13-rankings.html and held by e2e/boards/13-rankings.ts.
 *
 * The season is the boards' as it stands after the Oct 30 settlement (the boards fixture's
 * standings): the player's own Pipewrench, Mrs. Hooligan and Spritey, the rival's Gloomba, the
 * reader's Thwompson and the crowd's four, seeded onto the fake through `fake.seed`. Two other
 * characters have said their class in public, so both ways a stranger's class shows are on the
 * page: Gloomba revealed on Oct 12, and Thwompson revealed on Oct 8 and Turned, announced, on
 * Oct 20. The page is the screen itself (`RankingsScreen`) in the glass's page shell, as the
 * route /rankings puts it (web/src/App.tsx), signed in as the player. The classes are the instance's, by their place in its list, so the story names
 * none: the first is the player's two Faces' and the second Gloomba's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { RankingsScreen } from './Rankings.tsx';

const utc = (day: number, hour = 12, minute = 0) => Date.UTC(2026, 9, day, hour, minute);
const SETTLED = utc(30, 8, 17);

/** The season after the Oct 30 settlement, signed in as the player. */
const season: World = (fake, instance) => {
  const cls = (i: number) => (instance.classes[i] ?? instance.classes[0]!).key;
  const { seed } = fake;
  seed.season({ number: 1, startsAt: new Date(utc(1, 0)).toISOString() });
  const player = seed.account('player');
  const rival = seed.account('rival');
  const reader = seed.account('reader');
  const pipewrench = seed.character(player, 'Pipewrench', cls(0), { at: utc(1) });
  const hooligan = seed.character(player, 'Mrs. Hooligan', cls(0), { at: utc(2) });
  const spritey = seed.character(player, 'Spritey', cls(3), { at: utc(3) });
  const gloomba = seed.character(rival, 'Gloomba', cls(1), { at: utc(4) });
  const thwompson = seed.character(reader, 'Thwompson', cls(2), { at: utc(5) });
  for (let n = 1; n <= 4; n++) seed.character(seed.account(`ringside-${n}`), `Ringside ${n}`, cls(2), { at: utc(6, 12, n) });

  const board = instance.boards.find((b) => !b.system) ?? instance.boards[0]!;
  const system = instance.boards.find((b) => b.system) ?? board;
  const turns = seed.thread(system.slug, null, 'Season 1: Who Turned', 'Every Turn, as it was announced.', { at: utc(1) });
  seed.season({ number: 1, turnsThread: turns.thread });
  const said = seed.thread(board.slug, gloomba, 'cards on the table', 'Fine. You want to know? Here it is.', { at: utc(12, 19, 4) });
  seed.reveal(gloomba, said.thread, { at: utc(12, 19, 5) });
  const lurking = seed.thread(board.slug, thwompson, 'i read everything', 'Someone has to.', { at: utc(8, 9, 30) });
  seed.reveal(thwompson, lurking.thread, { at: utc(8, 9, 31) });
  seed.announceTurn(thwompson, turns.thread, { at: utc(20, 8, 17) });

  seed.settle({
    at: SETTLED, debut: false, turns: false,
    standings: { [spritey]: 650, [hooligan]: 420, [pipewrench]: 330, [gloomba]: 180, [thwompson]: 40 },
  });
  fake.signInAs(player);
};

/** A season nothing has settled in yet: no character has debuted, and the player has none. */
const empty: World = (fake) => {
  fake.seed.season({ number: 1, startsAt: new Date(utc(1, 0)).toISOString() });
  fake.signInAs(fake.seed.account('player'));
};

/**
 * Season 1 as it ended on Oct 31, with Season 2 open: the frozen table (`season_results`, 0099), the player's own three among it, and what
 * its players made public of a class that season (a reveal; a reveal and a Turn after it; none). Opened on the player's Mrs. Hooligan, as
 * a link from her record or a podium name opens it.
 */
const finished: World = (fake, instance) => {
  const cls = (i: number) => (instance.classes[i] ?? instance.classes[0]!).key;
  const { seed } = fake;
  const board = instance.boards.find((b) => !b.system) ?? instance.boards[0]!;
  seed.season({ number: 1, startsAt: new Date(utc(1, 0)).toISOString(), endsAt: new Date(utc(31, 0)).toISOString() });
  seed.season({ number: 2, startsAt: new Date(utc(31, 0)).toISOString() });
  const player = seed.account('player');
  const rival = seed.account('rival');
  const spritey = seed.character(player, 'Spritey', cls(3), { at: utc(1) });
  const hooligan = seed.character(player, 'Mrs. Hooligan', cls(0), { at: utc(2) });
  const pipewrench = seed.character(player, 'Pipewrench', cls(0), { at: utc(3) });
  const gloomba = seed.character(rival, 'Gloomba', cls(1), { at: utc(4) });
  const thwompson = seed.character(seed.account('reader'), 'Thwompson', cls(2), { at: utc(5) });
  const rows = [spritey, hooligan, pipewrench, gloomba, thwompson];
  for (let n = 1; n <= 4; n++) rows.push(seed.character(seed.account(`ringside-${n}`), `Ringside ${n}`, cls(2), { at: utc(6, 12, n) }));
  const said = seed.thread(board.slug, gloomba, 'cards on the table', 'Fine. You want to know? Here it is.', { at: utc(12, 19, 4) });
  const revealed = seed.reveal(gloomba, said.thread, { at: utc(12, 19, 5) });
  const turned = seed.announce(thwompson, 'turn', { at: utc(20, 8, 17), was: cls(2), class: cls(0) });
  const lurking = seed.thread(board.slug, thwompson, 'i read everything', 'Someone has to.', { at: utc(8, 9, 30) });
  const lurked = seed.reveal(thwompson, lurking.thread, { at: utc(8, 9, 31) });
  seed.seasonResults(1, rows.map((character, i) => ({
    character, place: i < 6 ? i + 1 : 6, standing: [985, 840, 795, 410, 120, 0, 0, 0, 0][i]!,
    shown: character === gloomba ? [{ kind: 'reveal' as const, act: revealed, at: new Date(utc(12, 19, 5)).toISOString(), class: cls(1), was: null }]
      : character === thwompson ? [
        { kind: 'reveal' as const, act: lurked, at: new Date(utc(8, 9, 31)).toISOString(), class: cls(2), was: null },
        { kind: 'turn' as const, act: turned, at: new Date(utc(20, 8, 17)).toISOString(), class: null, was: cls(2) },
      ] : [],
  })), { at: utc(31, 8, 17) });
  fake.signInAs(player);
};

/** Season 1's final table, opened on the player's Mrs. Hooligan: the row is found by its name, as the story cannot know the id its world gives it. */
function FinishedStory() {
  const { api } = useKayfa();
  const [character, setCharacter] = useState<Id | null | 'missing'>(null);
  useEffect(() => {
    void api.resultsPage(1, 1).then((rows) => setCharacter(rows.find((r) => r.name === 'Mrs. Hooligan')?.character ?? 'missing'));
  }, [api]);
  // A world whose first page holds no Mrs. Hooligan says so, never a table quietly drawn with no row highlighted.
  if (character === 'missing') return <Page surface="rankings"><p role="alert">Season 1's first page of final standings has no Mrs. Hooligan.</p></Page>;
  return <Page surface="rankings">{character ? <RankingsScreen season={1} character={character} /> : <div aria-busy="true" />}</Page>;
}

/** The screen at /rankings, in its page shell. */
function RankingsStory() {
  return <Page surface="rankings"><RankingsScreen /></Page>;
}

const meta: Meta<typeof RankingsStory> = {
  title: 'Boards/13 Rankings',
  component: RankingsStory,
  parameters: { world: season, path: '/rankings', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof RankingsStory>;

/** The season on the Main board's layout, at 1440 wide. */
export const Season: Story = {};
/** The same season on the Phone board's layout, at 390 by 844. */
export const SeasonPhone: Story = {
  name: 'Season, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
/** Season 1 after it ended, at 1440 wide, with Mrs. Hooligan's row marked. */
export const FinishedSeason: StoryObj<typeof FinishedStory> = { render: () => <FinishedStory />, parameters: { world: finished, path: '/season?tab=rankings&season=1' } };
/** The same final table on the Phone board's layout, at 390 by 844. */
export const FinishedSeasonPhone: StoryObj<typeof FinishedStory> = {
  name: 'Finished season, phone 390 × 844',
  render: () => <FinishedStory />,
  parameters: { world: finished, path: '/season?tab=rankings&season=1' },
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
/** Before the first settlement: nobody is ranked yet. */
export const EmptySeason: Story = { parameters: { world: empty } };
