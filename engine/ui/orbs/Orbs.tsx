/**
 * The six orbs in the HUD, the player's wallet: a ring each in the instance's orb colors, the
 * settled fill solid, the estimate's gain hatched after it, a loss a pale band over the fill it
 * would take, and the figures beside them (the screens' design, section 3). At a settlement the
 * fill plays the TTYD cascade from the last wallet the player saw, one orb a second, a flash and a
 * shine on each orb that fills; under reduced motion the new wallet shows at once.
 *
 * A screen reader hears the wallet's name (fill.ts's walletName), always the wallet as it now is,
 * never a frame of the animation.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { motionReduced } from '../appearance.ts';
import { cascade, orbFills, walletName } from './fill.ts';
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
}

export function Orbs({ settled, pending, cap, cascadeFrom = null }: OrbsProps) {
  const [shown, setShown] = useState(settled);
  const [flash, setFlash] = useState<number | null>(null);

  useEffect(() => {
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
      <span className="kb-orbs-row" role="img" aria-label={walletName(settled, pending, cap)}>
        {orbs.map((o, i) => (
          <span
            key={i}
            className={`kb-orb${o.solid === 1 ? ' kb-orb--full' : ''}${flash === i ? ' kb-orb--flash' : ''}`}
            style={{
              '--kb-orb-color': `var(--kb-orb-${i + 1})`,
              '--kb-solid': String(o.solid),
              '--kb-gain-from': String(o.gainFrom),
              '--kb-gain-to': String(o.gainTo),
              '--kb-loss-from': String(o.lossFrom),
              '--kb-loss-to': String(o.lossTo),
            } as CSSProperties}
          />
        ))}
      </span>
      <span className="kb-orbs-figure kb-mono kb-num" aria-hidden="true">{figure(Math.min(settled, cap))}</span>
      {pending !== 0 && (
        <span className="kb-orbs-pending kb-mono kb-num" aria-hidden="true">
          {pending > 0 ? `+${figure(pending)}` : `−${figure(-pending)}`} pending
        </span>
      )}
      {overflow > 0 && <span className="kb-orbs-over kb-mono kb-num" aria-hidden="true">+{figure(overflow)} past the cap</span>}
    </span>
  );
}
