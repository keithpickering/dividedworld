import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Character, ShownTrophy } from '../data/api.ts';
import { Postbit, type PostbitPerson } from './Postbit.tsx';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';
import type { Piece } from '../../rules/cosmetics.ts';
import { useKayfa } from '../context.tsx';

const meta: Meta<typeof Postbit> = {
  title: 'Postbit/Postbit',
  component: Postbit,
  parameters: { world: () => {} },
};
export default meta;

type Story = StoryObj<typeof Postbit>;

/* Plain pictures drawn here, so a story needs no file: a tall one and a square one. */
const picture = (w: number, h: number) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/><circle cx="${w / 2}" cy="${h / 4}" r="${w / 4}"/></svg>`;

const character = (over: Partial<Character> = {}): Character => ({
  id: 'story-character', name: 'Pipewrench', title: 'Professional Wrench', signature: '', avatarSquare: picture(100, 100), avatarPortrait: picture(100, 200),
  squareFrame: null, portraitFrame: null, portraitTallness: null, outfit: [], trophies: [], pipStyle: 'default', pronouns: ENGINE_DEFAULT_PRONOUNS, joined: '2026-10-01', group: 'members', ...over,
});
const person = (over: Partial<PostbitPerson> = {}, c: Partial<Character> = {}): PostbitPerson => ({
  character: character(c), posts: 212, standing: 650, revealed: null, turnedAt: null, ...over,
});

export const SideBySide: Story = { args: { person: person(), layout: 'side' } };
export const Stacked: Story = { args: { person: person(), layout: 'stacked' } };
export const SquareInTheTallSlot: Story = { args: { person: person({}, { avatarPortrait: null }), layout: 'side' } };
export const NoAvatar: Story = { args: { person: person({}, { avatarSquare: null, avatarPortrait: null }), layout: 'side' } };
export const ClassRevealed: Story = { args: { person: person({ revealed: { class: 'heel', at: '2026-10-03T12:00:00Z' } }), layout: 'side' } };
export const ClassRevealedThenTurned: Story = {
  args: { person: person({ revealed: { class: 'heel', at: '2026-10-03T12:00:00Z' }, turnedAt: '2026-10-20T12:00:00Z' }), layout: 'stacked' },
};

/* A staff character at each of the three offices a postbit shows: the staff rung's bar at every office, the office's title beside it for the Boss and a mod. */
const staffPerson = (c: Partial<Character>): PostbitPerson => person({ standing: null }, { avatarPortrait: null, ...c });
export const StaffBoss: Story = { args: { person: staffPerson({ name: 'The Clerk', title: 'Head of Board Operations', staff: 'the-clerk', office: 'boss', group: 'personalityCores' }), layout: 'side' } };
export const StaffMod: Story = { args: { person: staffPerson({ name: 'Hall Monitor', title: 'Hall monitor', staff: 'hall-monitor', office: 'mod', group: 'personalityCores' }), layout: 'side' } };
export const StaffMember: Story = { args: { person: staffPerson({ name: 'Retired Clerk', title: 'Emeritus', staff: 'retired-clerk', office: 'member', group: 'personalityCores' }), layout: 'stacked' } };

/* The warn meter (6 of 10, the mock's) and BANNED on the title line while a ban holds. */
export const WarnMeter: Story = { args: { person: person({}, { warnPoints: 6 }), layout: 'side' } };
export const WarnMeterStacked: Story = { args: { person: person({}, { warnPoints: 6 }), layout: 'stacked' } };
export const FullBar: Story = { args: { person: person({}, { warnPoints: 10 }), layout: 'side' } };
export const Banned: Story = { args: { person: person({}, { bannedUntil: '2099-01-01T00:00:00Z' }), layout: 'side' } };

/* The group bar under the name, for a member, a Trial Member (striped) and a staff character (the staff rung's bar with the office title beside it). */
export const Member: Story = { args: { person: person({}, { group: 'members' }), layout: 'side' } };
export const TrialMember: Story = { args: { person: person({}, { group: 'trialMembers', warnPoints: 6 }), layout: 'side' } };
export const Staff: Story = { args: { person: staffPerson({ name: 'The Clerk', title: 'Head of Board Operations', staff: 'the-clerk', office: 'boss', group: 'personalityCores' }), layout: 'side' } };

/*
 * A mask wearing gear: the first pieces the instance's own gear table offers (the engine names none), one reaching above the slot, one on the
 * face, one turned. The portrait is 1:1.4 (its tallness), the square the portrait's top 1:1.4 (its frame), so the stacked band shows the same
 * pieces cut through it. The name, title and rank stay on the board's ground over a piece that reaches behind them.
 */
function Wearing({ layout }: { readonly layout: 'side' | 'stacked' }) {
  const { ui } = useKayfa();
  const keys = Object.keys(ui.gear);
  const spots = [{ x: 0.5, y: 0, w: 0.7, turn: -8 }, { x: 0.5, y: 0.3, w: 0.5, turn: 0 }, { x: 0.7, y: 0.62, w: 0.3, turn: 14 }];
  const outfit: Piece[] = keys.slice(0, 3).map((gear, i) => ({ gear, layer: i, ...spots[i]! }));
  return <Postbit person={person({}, { outfit, portraitTallness: 1.4, squareFrame: { x: 0, y: 0, w: 1, h: 1 / 1.4 } })} layout={layout} />;
}
export const WearingGear: Story = { render: () => <Wearing layout="side" /> };
export const WearingGearStacked: Story = { render: () => <Wearing layout="stacked" /> };

/* Trophies drawn here as plain badges, so a story needs no file: three chosen and a held belt (the fourth chosen is past `shownMost` and is not drawn). */
const badge = (fill: string, w = 24) => `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 24"><rect width="${w}" height="24" rx="4" fill="${fill}"/></svg>`;
const trophy = (n: number, name: string, fill: string, belt = false): ShownTrophy => ({ award: `story-award-${n}`, trophy: `story-${n}`, name, art: badge(fill, belt ? 48 : 24), belt, held: belt });
const shelf = [trophy(1, 'First Place', 'goldenrod'), trophy(2, 'Second Place', 'silver'), trophy(3, 'Third Place', 'peru'), trophy(4, 'Fourth Place', 'steelblue'), trophy(5, 'Story Belt', 'maroon', true)];
export const WithTrophiesAndABelt: Story = { args: { person: person({}, { trophies: shelf }), layout: 'side' } };
export const StackedHeldBeltOnly: Story = { args: { person: person({}, { trophies: shelf }), layout: 'stacked' } };
