/**
 * The machine's admin page, drawn as stories against board 05 of the booster packs boards (`docs/research/2026-11-07-booster-packs/05-admin.html`, 1440 wide)
 * and the fourth screen of board 04 (`04-phone.html`, 390 by 844): the screen itself in the glass's page shell, as the route /admin/machine puts it
 * (web/src/App.tsx), signed in as an admin. The world is the instance's own machine, with the two Boss moves the board draws: a Pull of Whoops! (ending
 * Nov 9) and a markup of Stick Around to 1.5 times (ending Nov 8).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SlotMove } from '../data/api.ts';
import { Page } from '../glass/Page.tsx';
import type { World } from '../story.tsx';
import { MachineScreen } from './Machine.tsx';

const move = (kind: SlotMove['kind'], act: string, ends: string, was: number, percent: number | null): SlotMove => ({ kind, act, ends, demand: null, progress: null, was, percent, hours: null });

/** The instance's machine, signed in as an admin; the Boss's two moves are seeded as the machine shows them (the fake applies none). */
const machine: World = (fake) => {
  fake.signInAs(fake.seed.account('machine-admin', { admin: true }));
  fake.seed.slot({ card: 'whoops' }, { availability: 'soldOut', move: move('pullSlot', 'move-pull', '2026-11-09T12:00:00.000Z', 100, null) });
  fake.seed.slot({ card: 'stick-around' }, { price: 225, move: move('repriceSlot', 'move-markup', '2026-11-08T12:00:00.000Z', 150, 150) });
};

/** The machine with the first four slots retired: a pack out of print, then a card out of print, one renamed and one withdrawn (the page marks each and shows its availability as not in use). */
const retired: World = (fake, instance) => {
  machine(fake, instance);
  const real = fake.adminMachine.bind(fake);
  fake.adminMachine = async () => (await real()).map((s, i) => (
    i === 0 ? { ...s, retired: true }
      : i === 1 ? { ...s, retired: true }
        : i === 2 ? { ...s, retired: true, became: 'whoops' }
          : i === 3 ? { ...s, retired: true, withdrawn: true } : s));
};

function MachineStory() {
  return <Page surface="settings"><MachineScreen /></Page>;
}

const meta: Meta<typeof MachineStory> = {
  title: 'Boards/00 Admin machine',
  component: MachineStory,
  parameters: { world: machine, boardsMachine: true, path: '/admin/machine', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof MachineStory>;

/** The page on the Main board's layout, at 1440 wide. */
export const AdminMachine: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const AdminMachinePhone: Story = {
  name: 'Admin machine, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};

/** Retired slots: "Out of print" on a pack and a card, "Renamed to ..." and "Withdrawn" on cards, each with its availability control disabled. */
export const AdminMachineRetired: Story = { name: 'Admin machine, retired slots', parameters: { world: retired } };

/** Two live staff pins under the slots, each with its title, when it was pinned and an Unpin button. */
const pinned: World = (fake, instance) => {
  machine(fake, instance);
  const system = instance.boards.find((b) => b.system)!.slug;
  const first = fake.seed.thread(system, null, 'Improvement Initiative #1: World -1 (please read)', 'Per the board.', { at: Date.UTC(2026, 10, 20, 12) });
  const second = fake.seed.thread(system, null, 'Improvement Initiative #FINAL: Everything is World -1', 'Circling back.', { at: Date.UTC(2026, 10, 24, 12) });
  fake.seed.stickyPin(first.thread, { at: Date.UTC(2026, 10, 20, 13) });
  fake.seed.stickyPin(second.thread, { at: Date.UTC(2026, 10, 24, 13) });
};
export const AdminMachinePinned: Story = { name: 'Admin machine, pinned staff threads', parameters: { world: pinned } };
