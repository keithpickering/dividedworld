/**
 * The six orbs in the HUD, the player's wallet, in the glass's look (the glass plan, section 7,
 * board 01): a glass ball each in the instance's gradient for its place in the row
 * (`--kb-glass-orb-<n>-*`, set by applyGlass), the settled fill a liquid risen from the bottom, the
 * estimate's gain a hatched ghost above it, a loss a pale band over the liquid it would take, a
 * gloss over all, and the figures beside them: the wallet over its cap, and the estimate. At a settlement the
 * fill plays the TTYD cascade from the last wallet the player saw, one orb a second, a flash and a
 * shine on each orb that fills; under reduced motion the new wallet shows at once.
 *
 * `Orb` is one orb on its own, for a page that shows the orbs apart from a wallet: the Orbs board's
 * anatomy and the cascade's frames, held still.
 *
 * A wallet past its cap marks its last orb (`kb-orb-over`), which only the Phone board's layout draws: there
 * the words "past the cap" would cost the docked HUD a line, so they are left to the name below (issue 48).
 *
 * A screen reader hears the wallet's name (fill.ts's walletName), always the wallet as it now is,
 * never a frame of the animation; a page that previews a spend names the row itself (`label`).
 */
import { useLayoutEffect, useState, type CSSProperties } from 'react';
import { motionReduced } from '../appearance.ts';
import { cascade, clamp, orbFills, walletName, type OrbFill } from './fill.ts';
import './orbs.css';

const figure = (h: number) => (h / 100).toFixed(2);

export interface OrbsProps {
  /** The settled wallet, in hundredths. */
  readonly settled: number;
  /** The live estimate, signed hundredths. */
  readonly pending: number;
  readonly cap: number;
  /** The wallet the player last saw, when a settlement has moved it since: the cascade runs from it. */
  readonly cascadeFrom?: number | null;
  /** `false` where the page around the row says the figures itself (the Orbs board's states). */
  readonly figures?: boolean;
  /** The row's name where the page says more than the wallet as it stands (the Vending Machine's "buying Whoops! leaves 3.62"); the wallet's own name by default. */
  readonly label?: string;
}

/** One orb: its fill, its place in the row (0 to 5, for its gradient), and a still frame of the cascade's beat. */
export interface OrbProps {
  readonly fill: OrbFill;
  readonly place: number;
  /** A still of the beat as the Orbs board draws it: the flash as the orb fills, the shine after it. */
  readonly beat?: 'flash' | 'shine';
}

/** The orb as the row draws it. */
function orbStyle(fill: OrbFill, place: number): CSSProperties {
  return {
    '--kb-orb-color': `var(--kb-glass-orb-${place + 1}-color)`,
    '--kb-orb-highlight': `var(--kb-glass-orb-${place + 1}-highlight)`,
    '--kb-orb-shade': `var(--kb-glass-orb-${place + 1}-shade)`,
    '--kb-solid': String(fill.solid),
    '--kb-gain-from': String(fill.gainFrom),
    '--kb-gain-to': String(fill.gainTo),
    '--kb-loss-from': String(fill.lossFrom),
    '--kb-loss-to': String(fill.lossTo),
  } as CSSProperties;
}

const orbParts = (
  <>
    <span className="kb-orb-liquid" />
    <span className="kb-orb-ghost" />
    <span className="kb-orb-pale" />
    <span className="kb-orb-gloss" />
  </>
);

/**
 * One orb on its own, out of the reading order: the parts of a row a page shows apart from the
 * wallet (the Orbs board's anatomy and the cascade's frames), each said in the page's own words.
 */
export function Orb({ fill, place, beat }: OrbProps) {
  return (
    <span className={`kb-orb${fill.solid === 1 ? ' kb-orb--full' : ''}`} style={orbStyle(fill, place)} data-kb-beat={beat} aria-hidden="true">
      {orbParts}
    </span>
  );
}

export function Orbs({ settled, pending, cap, cascadeFrom = null, figures = true, label }: OrbsProps) {
  /* The first frame of a cascade is the wallet it starts from, set before paint, so the end never flashes first. */
  const [shown, setShown] = useState(() => (cascadeFrom !== null && !motionReduced() ? cascadeFrom : settled));
  const [flash, setFlash] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (cascadeFrom === null || cascadeFrom === settled || motionReduced()) {
      setShown(settled);
      setFlash(null);
      return;
    }
    setShown(cascadeFrom);
    const up = settled > cascadeFrom;
    const timers = cascade(cascadeFrom, settled, cap).map((step) => setTimeout(() => {
      setShown(up ? Math.min(settled, (step.orb + 1) * 100) : Math.max(settled, step.orb * 100));
      setFlash(step.fills ? step.orb : null);
    }, step.at));
    return () => timers.forEach(clearTimeout);
  }, [settled, cascadeFrom, cap]);

  const { orbs, overflow } = orbFills(shown, pending, cap);
  return (
    <span className="kb-orbs">
      <span className="kb-orbs-row" role="img" aria-label={label ?? walletName(settled, pending, cap)}>
        {orbs.map((o, i) => (
          <span key={i} className={`kb-orb${o.solid === 1 ? ' kb-orb--full' : ''}${flash === i ? ' kb-orb--flash' : ''}`} style={orbStyle(o, i)}>
            {orbParts}
            {overflow > 0 && i === orbs.length - 1 && <span className="kb-orb-over" aria-hidden="true" />}
          </span>
        ))}
      </span>
      {figures && (
        <>
          <span className="kb-orbs-figures" aria-hidden="true">
            <span className="kb-orbs-figure kb-num">{figure(clamp(settled, 0, cap))}</span>
            <span className="kb-orbs-cap kb-num">/ {figure(cap)}</span>
          </span>
          {pending !== 0 && (
            <span className="kb-orbs-pending kb-num" aria-hidden="true">
              {pending > 0 ? `+${figure(pending)}` : `−${figure(-pending)}`} est.
            </span>
          )}
          {overflow > 0 && <span className="kb-orbs-over kb-num" aria-hidden="true">+{figure(overflow)} past the cap</span>}
        </>
      )}
    </span>
  );
}
