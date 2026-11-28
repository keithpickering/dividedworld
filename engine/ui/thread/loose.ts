/**
 * Whether the reactions of a post are loose in it: a live play of a card that draws the reactions (`CardUi.drawsReactions`) is on the post's own reach. The post's row then draws one
 * line instead of tiles and its card's effect is given the row's logic (`EffectProps.reactions`; reactions/Reactions.tsx, `ReactionRowScope`). A play that has ended, been reversed or
 * caught, or is face down gives the row back, as `useRowFilling` counts the plays it draws.
 */
import { livePlays, useAt, usePlays, type Plays } from '../cards/plays.ts';
import type { CardUi } from '../cards/types.ts';

export function useLooseReactions({ plays, actId, eligible, cards }: {
  readonly plays: Plays; readonly actId: string; readonly eligible: boolean; readonly cards: readonly CardUi[];
}): boolean {
  const own = usePlays(plays, actId).plays;
  const drawing = eligible ? own.filter((p) => !p.reach && cards.find((c) => c.key === p.card)?.drawsReactions === true) : [];
  /* A play that ends while the post is on screen gives the row back at its end. */
  const now = useAt(drawing.filter((p) => p.ends !== undefined).map((p) => Date.parse(p.ends!)));
  return livePlays(drawing, now).some((p) => !p.caught && !p.untaken && !p.faceDown);
}
