/**
 * The Orbs board (docs/research/2026-10-29-two-worlds/04-orbs.html, 1440 by 900) as a story: the
 * engine's orbs in every state the board lays out, on the board's own canvas, so the board match
 * (e2e/boards/04-orbs.ts) reads it through the end-to-end build's story route
 * (`?fixture=boards&story=<id>`, web/src/data/fixtures/stories.tsx) beside the board.
 *
 * The anatomy's one big orb, the four states (settled, the ghost's gain, the drained band, past the
 * cap) and the settlement cascade's four frames, held still. Each state's row is the wallet's own
 * `Orbs`, named as the HUD names it (fill.ts's walletName), with its figures left to the words under
 * it; the anatomy and the frames are single `Orb`s out of the reading order, since the words beside
 * them say what they show. The words are the board's.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Smoke, useSurfaceStyle } from '../glass/Smoke.tsx';
import { GLASS_NAV } from '../glass/nav.ts';
import { Orb, Orbs } from './Orbs.tsx';
import type { OrbFill } from './fill.ts';
import './orbs-board.css';

const fill = (solid: number, gain: readonly [number, number] = [0, 0], loss: readonly [number, number] = [0, 0]): OrbFill => ({
  solid, gainFrom: gain[0], gainTo: gain[1], lossFrom: loss[0], lossTo: loss[1],
});
const FULL = fill(1);
const EMPTY = fill(0);

/** The anatomy's terms, top to bottom, as the leader lines reach them. */
const ANATOMY = [
  { term: 'Glass', says: 'Empty orb, room left.', tone: 'plain' },
  { term: 'Ghost', says: "Estimate. Can't be spent.", tone: 'ghost' },
  { term: 'Pale band', says: 'Drained by hostile reactions.', tone: 'plain' },
  { term: 'Solid', says: 'Settled. The only Aura you can spend.', tone: 'solid' },
] as const;

/** The four states: the wallet each shows (hundredths), and the board's words under it. */
const STATES = [
  { title: 'Settled', tone: 'settled', settled: 462, pending: 0, figure: '4.62', says: ' / 6.00. What you can spend at the Vending Machine right now.' },
  { title: 'Ghost', tone: 'ghost', settled: 462, pending: 30, figure: '+0.30', says: ' estimated. Each favored reaction shows as up to +0.10, before the shared vote and halving.' },
  { title: 'Drained', tone: 'drained', settled: 462, pending: -40, figure: '−0.40', says: ' estimated. Hostile reactions turn solid fill pale until the settlement decides.' },
  { title: 'Past the cap', tone: 'over', settled: 600, pending: 40, figure: '+0.40', says: " past the cap. Spend some before the settlement, or it won't fit." },
] as const;

/** The cascade's frames on the wallet's last three orbs: the fifth orb's ghost turning solid. */
const FRAMES = [
  { step: '1 · Ghost waits', tone: 'ghost', orbs: [FULL, fill(0.62, [0.62, 0.92]), EMPTY], beat: undefined },
  { step: '2 · Flash', tone: 'plain', orbs: [FULL, fill(0.92), EMPTY], beat: 'flash' },
  { step: '3 · Shine', tone: 'plain', orbs: [FULL, fill(0.92), EMPTY], beat: 'shine' },
] as const;

interface OrbsBoardProps {
  /** When the settlement runs, as the instance's settings say it. */
  readonly when: string;
}

function OrbsBoard({ when }: OrbsBoardProps) {
  const calm = useSurfaceStyle('log');
  return (
    <div className="kb-glass kb-orbs-board" style={calm}>
      <Smoke surface="log" />
      <header className="kb-orbs-board-head">
        <p className="kb-orbs-board-eyebrow">The wallet · live</p>
        <h1 className="kb-orbs-board-title kb-glass-display">Aura</h1>
      </header>

      <section className="kb-orbs-board-anatomy" aria-label="An orb, part by part">
        <span className="kb-orbs-board-hero">
          <Orb fill={fill(0.46, [0.46, 0.66], [0.36, 0.46])} place={3} />
        </span>
        <svg className="kb-orbs-board-leaders" aria-hidden="true" focusable="false" width="590" height="340">
          <polyline points="204,64 262,33 280,33" />
          <polyline points="226,100 262,110 280,110" />
          <polyline points="232,138 262,187 280,187" />
          <polyline points="200,204 262,264 280,264" />
          <circle cx="204" cy="64" r="3" /><circle cx="226" cy="100" r="3" /><circle cx="232" cy="138" r="3" /><circle cx="200" cy="204" r="3" />
        </svg>
        <dl className="kb-orbs-board-terms">
          {ANATOMY.map((a) => (
            <div key={a.term}>
              <dt data-kb-tone={a.tone}>{a.term}</dt>
              <dd>{a.says}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="kb-orbs-board-states">
        {STATES.map((s) => (
          <section key={s.title} className="kb-orbs-board-state" data-kb-tone={s.tone} aria-labelledby={`kb-orbs-state-${s.tone}`}>
            <h2 id={`kb-orbs-state-${s.tone}`} className="kb-glass-display">{s.title}</h2>
            <Orbs settled={s.settled} pending={s.pending} cap={600} figures={false} />
            <p><b className="kb-num">{s.figure}</b>{s.says}</p>
          </section>
        ))}
      </div>

      <section className="kb-orbs-board-cascade" aria-label="The settlement cascade">
        <div className="kb-orbs-board-cascade-head">
          <h2 className="kb-glass-display">The settlement</h2>
          <span>{when}. Orb by orb, the ghost turns solid: a flash, then a shine.</span>
        </div>
        <ol>
          {FRAMES.map((f) => (
            <li key={f.step}>
              <span className="kb-orbs-board-frame">
                {f.orbs.map((o, i) => <Orb key={i} fill={o} place={3 + i} beat={i === 1 ? f.beat : undefined} />)}
              </span>
              <span className="kb-orbs-board-step" data-kb-tone={f.tone}>{f.step}</span>
            </li>
          ))}
          <li className="kb-orbs-board-settled">
            <span className="kb-orbs-board-total">
              <span className="kb-orbs-board-total-figure kb-num">4.92</span>
              <span className="kb-orbs-board-total-gain kb-num">+0.30</span>
            </span>
            <span className="kb-orbs-board-step">4 · Settled</span>
            <a href={GLASS_NAV.log}>See what earned it in your log</a>
          </li>
        </ol>
      </section>
    </div>
  );
}

const meta: Meta<typeof OrbsBoard> = {
  title: 'Boards/04 Orbs',
  component: OrbsBoard,
  args: { when: 'Daily at 08:17 UTC' },
  /* No world of its own: an empty one, so the smoke has the instance's glass to read. */
  parameters: { world: () => {}, layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof OrbsBoard>;

/** The board at its own size: 1440 by 900. */
export const Board: Story = {};
