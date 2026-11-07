/**
 * The warn meter in a postbit (the Mod Bots design, section 9; docs/research/2026-11-06-mod-bots/02-filed-author.png): "Warnings: 6/10" over a small thermometer in the board's world,
 * a white tube with a black outline and a red bulb, the red filling from the bulb to N of the bar's size. The text is the meter's accessible name, so the picture says nothing the
 * words do not. A character with no points shows none (the postbit draws nothing for 0). The red is `--kb-warn-fill`, which the instance may set; the tube and its outline are `--kb-warn-tube` and
 * `--kb-warn-outline`, a white and a black in either mode.
 *
 * It is public: a character's warn bar is the sum of public infractions, the same for anyone who reads the page.
 */
import { memo } from 'react';

const W = 84;
const H = 16;
const BULB = 7;
/* The tube runs from the bulb's middle to the right edge, 8 tall; the red inside it is 2 inside the outline top and bottom. */
const TUBE_X = BULB;
const TUBE_END = W - 1.5;

export const WarnMeter = memo(function WarnMeter({ points, size }: { readonly points: number; readonly size: number }) {
  const text = `Warnings: ${points}/${size}`;
  const filled = size > 0 ? Math.min(1, Math.max(0, points / size)) : 0;
  const reach = TUBE_X + (TUBE_END - 1 - TUBE_X) * filled;
  const red = { fill: 'var(--kb-warn-fill)' } as const;
  const tube = { fill: 'var(--kb-warn-tube)', stroke: 'var(--kb-warn-outline)' } as const;
  const outline = { stroke: 'var(--kb-warn-outline)' } as const;
  return (
    <span className="kb-postbit-warn kb-small" role="img" aria-label={text}>
      <span className="kb-postbit-warn-text" aria-hidden="true">{text}</span>
      <svg className="kb-postbit-thermo" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
        <rect x={TUBE_X} y="4.5" width={TUBE_END - TUBE_X} height="7" rx="3.5" style={tube} strokeWidth="1" />
        <rect x={TUBE_X} y="6" width={Math.max(0, reach - TUBE_X)} height="4" style={red} />
        <circle cx={BULB + 0.5} cy={H / 2} r="6.5" style={{ ...red, ...outline }} strokeWidth="1" />
      </svg>
    </span>
  );
});
