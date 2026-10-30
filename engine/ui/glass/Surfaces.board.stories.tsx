/**
 * A glass surface no screen draws yet, as a story, so the rendered measurement
 * (e2e/glass-text.spec.ts) can hold what its recipe asks before the screen exists. No board is
 * compared with it.
 *
 * The settlement's surface: its recipe is `calmAll` (the glass plan, section 6: at its worst
 * pixel even the palest large text falls under 3:1), so every line on it stands in a calm, the
 * heading too. Its screen is the log's (web Task 8), built in the glass build's Part 4; until then
 * this stand-in draws the surface with a heading and a line, each in its calm, in the page shell
 * the screen will take. The measurement reads it clean, and its poison moves the heading out of its
 * calm. When the settlement screen lands, its own story or route takes this one's place.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { World } from '../story.tsx';
import { Page } from './Page.tsx';
import './surfaces-story.css';

const signedIn: World = (fake) => {
  fake.seed.season({ number: 1, startsAt: new Date(Date.UTC(2026, 9, 1)).toISOString() });
  fake.signInAs(fake.seed.account('player'));
};

function SettlementSurface() {
  return (
    <Page surface="settlement">
      <div className="kb-surfaces-story">
        <h1 className="kb-surfaces-story-head kb-glass-display kb-calm">Settled</h1>
        <p className="kb-surfaces-story-line kb-calm">The settlement ran at 08:17 UTC. Your wallet went from 4.62 to 5.02.</p>
      </div>
    </Page>
  );
}

const meta: Meta<typeof SettlementSurface> = {
  title: 'Boards/Glass surfaces',
  component: SettlementSurface,
  parameters: { world: signedIn, path: '/log/settlement', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof SettlementSurface>;

/** The settlement's surface: a heading and a line on the `calmAll` recipe, each in its calm. */
export const Settlement: Story = {};
