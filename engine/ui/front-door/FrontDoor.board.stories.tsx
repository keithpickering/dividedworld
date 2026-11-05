/**
 * The front door, drawn as stories against the sketch the owner chose (`.impeccable/mocks/decision/the-thread.html`, 1440 wide) and on the
 * Phone board's layout (390 by 844): the Index signed out in the board's frame, as the route / puts it (web/src/App.tsx), with the HUD's
 * signed-out plate under it. The thread, its cast, its card play, the persona's note and the HUD's prompt are the instance's own (the
 * preview builds the words from the instance); the frame, the mode's words and the layout are the engine's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Frame } from '../frame/Frame.tsx';
import { IndexScreen } from '../index/Index.tsx';
import type { World } from '../story.tsx';

/** No one signed in: who the front door is for. */
const visitor: World = () => {};

function FrontDoorStory() {
  return <Frame><IndexScreen /></Frame>;
}

const meta: Meta<typeof FrontDoorStory> = {
  title: 'Boards/00 Front door',
  component: FrontDoorStory,
  parameters: { world: visitor, path: '/', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof FrontDoorStory>;

/** The front door on the Main board's layout, at 1440 wide. */
export const FrontDoor: Story = {};
/** The same page on the Phone board's layout, at 390 by 844. */
export const FrontDoorPhone: Story = {
  name: 'Front door, phone 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
