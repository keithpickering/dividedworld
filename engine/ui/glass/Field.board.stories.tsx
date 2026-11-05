/**
 * The glass's one field of clouds, for the owner's review and for the frame-time measurement the
 * glass polish design (section 6) asks of the build. The page's smoke is the field; under the
 * heading stand windows of other surfaces (a log's, a character page's, the settings', the hand's),
 * each a box of its own smoke at its own place. The clouds run on through every window where the
 * page's are, in the window's own colors, so the windows line up. The button crosses the page to
 * its next surface: the clouds stay where they are and the colors fade (over the motion feel's
 * screen duration, and at once under Off). Narrow the canvas below 600px to see the field's narrow
 * layers, and turn Settings > Accessibility > Smoke to Low or Off to see the layers thin and go.
 *
 * The windows are decoration and say nothing to a screen reader; the heading, the lead and the
 * button are the page's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { playerWorld } from '../story.tsx';
import type { GlassSurface } from '../types.ts';
import { GlassButton } from './Button.tsx';
import { Page } from './Page.tsx';
import { PageHead } from './PageHead.tsx';
import { Smoke } from './Smoke.tsx';

/** The surfaces the page crosses through, and the windows beneath it. */
const SURFACES: readonly GlassSurface[] = ['vending', 'log', 'characters', 'settings', 'rankings'];
const WINDOWS: readonly GlassSurface[] = ['log', 'characters', 'settings', 'hand'];

function Field() {
  const [at, setAt] = useState(0);
  return (
    <Page surface={SURFACES[at]!}>
      <PageHead
        title="One field of clouds"
        eyebrow="Glass polish"
        lead="Every surface is a window onto the same clouds. Cross to the next surface and the clouds stay where they are while their colors change."
        actions={<GlassButton kind="primary" onClick={() => setAt((at + 1) % SURFACES.length)}>Cross to the next surface</GlassButton>}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 32 }} aria-hidden="true">
        {WINDOWS.map((surface) => (
          <div key={surface} className="kb-glass" style={{ position: 'relative', isolation: 'isolate', width: 260, height: 160, overflow: 'hidden', border: '1px solid var(--kb-glass-pale)' }}>
            <Smoke surface={surface} />
          </div>
        ))}
      </div>
    </Page>
  );
}

const meta: Meta<typeof Field> = {
  title: 'Boards/Glass field',
  component: Field,
  parameters: { world: playerWorld, path: '/settings', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Field>;

/** The Main layout, with the drift running (Off in Settings stops it). */
export const Main: Story = {};
/** The Phone layout, 390 wide: the field's narrow layers. */
export const Phone390: Story = {
  name: 'Phone, 390 × 844',
  globals: { viewport: { value: 'glassPhone390', isRotated: false } },
};
