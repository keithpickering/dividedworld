/**
 * The trophies and gear admin page, drawn as a story against board 05 of the cosmetics boards (`docs/research/2026-11-04-cosmetics/05-admin.html`, 1440 wide): the screen
 * itself in the glass's page shell, as the route /admin/trophies puts it (web/src/App.tsx), signed in as an admin. The world has two characters, three awards (a belt held, a
 * made trophy and a met demand's) and one award the machine could not give.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { TrophiesScreen } from './Trophies.tsx';

const admin: World = (fake, instance) => {
  fake.signInAs(fake.seed.account('trophies-admin', { admin: true }));
  const player = fake.seed.account('trophies-player');
  const pipe = fake.seed.character(player, 'Pipewrench', instance.classes[0]!.key);
  const bones = fake.seed.character(player, 'Dr. Bones', (instance.classes[1] ?? instance.classes[0]!).key);
  const belt = instance.trophies.kinds.find((k) => k.belt)?.key;
  const kinds = instance.trophies.kinds.filter((k) => k.key !== belt);
  if (belt) fake.seed.award(pipe, belt, { by: 'boss', at: Date.parse('2026-11-02T12:00:00Z') });
  fake.seed.award(pipe, kinds[0]!.key, { by: 'admin', at: Date.parse('2026-10-30T12:00:00Z'), line: 'Best walk cycle.' });
  fake.seed.award(bones, instance.trophies.demandMet, { by: 'demand', at: Date.parse('2026-10-14T12:00:00Z'), move: undefined });
  fake.seed.awardFailure({ move: 'move-1', season: null, at: '2026-11-03T00:00:00.000Z', error: 'a database error (23505)', trophy: instance.trophies.demandMet, characters: [{ id: bones, name: 'Dr. Bones' }] });
};

function TrophiesStory() {
  return <Page surface="settings"><TrophiesScreen /></Page>;
}

const meta: Meta<typeof TrophiesStory> = {
  title: 'Boards/00 Admin trophies',
  component: TrophiesStory,
  parameters: { world: admin, path: '/admin/trophies', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof TrophiesStory>;

/** The page on the Main board's layout, at 1440 wide. */
export const AdminTrophies: Story = {};
/** The same page on the phone's layout. */
export const AdminTrophiesPhone: Story = {
  name: 'Admin trophies, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
