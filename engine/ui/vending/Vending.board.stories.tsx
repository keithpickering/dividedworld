/**
 * The Vending Machine on the Phone board's layout, drawn as a story for the owner because no board
 * draws it (the glass plan, section 8: what no board draws is a story first). It is the page itself,
 * `Vending` in the glass's page shell, at the boards fixture's `07-vending` moment, so it reads the
 * wallet (5.62) and the hand (2) the Vending board does. The layout is the window's: open the story
 * at 390 by 844 (or below the Main board's switch width) to see the stack; wider, it is the board.
 *
 * What is chosen, for the owner to overturn: the machine is a stack in the order a player works it
 * (the sign, the slots in two columns, the price display, the buy button and its note, the tray);
 * the wallet and the hand come first and the plain list last; the machine's side art (the sheen, the
 * coil, the slot codes, Aura in) is dropped; the sealed slots keep their dashed outline and their
 * words ("Empty slot B1, waiting for a future postcard", "4 slots empty", "More postcards arrive in
 * later seasons").
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Page } from '../glass/Page.tsx';
import { Vending } from './Vending.tsx';

function VendingPage() {
  return <Page surface="vending"><Vending /></Page>;
}

const meta: Meta<typeof VendingPage> = {
  title: 'Boards/07 Vending Phone',
  component: VendingPage,
  parameters: { moment: '07-vending', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof VendingPage>;

/** The page as the window draws it; at the phone's width, the stack. */
export const Stack: Story = {};
