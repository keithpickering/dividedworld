/**
 * The glass's shared parts, drawn for the owner before any screen uses them (the glass polish plan,
 * Task 2): each button kind and size, a row of three, a disabled control, and a page head whose long
 * lead goes under its title. Each is shown on the Main layout and, at 390 wide, on the Phone one;
 * narrow the canvas to watch the row break between controls and the lead drop under the title.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { playerWorld } from '../story.tsx';
import { ButtonRow, GlassButton } from './Button.tsx';
import { Page } from './Page.tsx';
import { PageHead } from './PageHead.tsx';

const KINDS = ['primary', 'secondary', 'quiet'] as const;
const SIZES = ['m', 's'] as const;

function Parts() {
  return (
    <Page surface="settings">
      <PageHead
        title="Your characters"
        count="(2 of 3)"
        eyebrow="Out of character"
        lead="This page is out of character and only you can see it. Classes are shown here and nowhere else unless you reveal them, and the lead is long enough to want its own line when the title is wide."
        actions={<><GlassButton kind="primary">Make a character</GlassButton><GlassButton>Edit profile</GlassButton></>}
      />
      {SIZES.map((size) => (
        <ButtonRow key={size}>
          {KINDS.map((kind) => <GlassButton key={kind} kind={kind} size={size}>{kind} {size}</GlassButton>)}
          <GlassButton kind="secondary" size={size} disabled>Disabled {size}</GlassButton>
          <GlassButton kind="quiet" size={size} to="/log">Link {size}</GlassButton>
        </ButtonRow>
      ))}
      {/* Busy: each kind and a link; the label gives way to the spinner at the control's own width. */}
      {SIZES.map((size) => (
        <ButtonRow key={`busy-${size}`}>
          {KINDS.map((kind) => <GlassButton key={kind} kind={kind} size={size} busy>{kind} {size} busy</GlassButton>)}
          <GlassButton kind="quiet" size={size} to="/log" busy>Link {size} busy</GlassButton>
        </ButtonRow>
      ))}
      <ButtonRow align="end">
        <GlassButton kind="quiet">Cancel</GlassButton>
        <GlassButton>Review it</GlassButton>
        <GlassButton kind="primary">Send it to the staff</GlassButton>
      </ButtonRow>
    </Page>
  );
}

const meta: Meta<typeof Parts> = {
  title: 'Boards/Glass parts',
  component: Parts,
  parameters: { world: playerWorld, path: '/settings', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Parts>;

/** The Main layout. */
export const Main: Story = {};
/** The Phone layout, 390 wide: controls at 40px and 32px, the row breaking between them. */
export const Phone390: Story = {
  name: 'Phone, 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
