/**
 * Whether the reactions of a post are loose in it: a live play of a card that draws the reactions (`CardUi.drawsReactions`) is on the post's own reach. The post's row then draws one
 * line instead of tiles and its card's effect is given the row's logic (`EffectProps.reactions`; reactions/Reactions.tsx, `ReactionRowScope`). A play that has ended, been reversed or
 * caught, or is face down gives the row back, as `useRowFilling` counts the plays it draws.
 */
import { useLensStore } from '../cards/Lens.tsx';
import { useShownMoment, useShownPresent } from '../cards/Moment.tsx';
import { actsOnPost, hiddenByRewind, livePlays, useAt, useRewound, usePlays, type Plays } from '../cards/plays.ts';
import type { CardUi } from '../cards/types.ts';

/**
 * `eligible` is whether the post draws its effects at all: a post being edited, a hidden one and one whose quotes are being concealed draw its words without them (`PostEffects` is not mounted),
 * and a play a live rewind hides is not drawn either (`hiddenByRewind`, as `PostEffects` and the row's fills leave it out). The row is loose only where the card is drawn.
 */
export function useLooseReactions({ plays, actId, eligible, cards }: {
  readonly plays: Plays; readonly actId: string; readonly eligible: boolean; readonly cards: readonly CardUi[];
}): boolean {
  const own = usePlays(plays, actId).plays;
  const rewound = useRewound(plays, actId);
  const lens = useLensStore();
  const shownPresent = useShownPresent(lens);
  const moment = useShownMoment(lens);
  const hidden = hiddenByRewind(rewound, rewound !== null && shownPresent === rewound.rewind.play);
  /* A shown moment replaces the effects (`PostEffects`): the post's own plays are not drawn live, so the row gives its tiles back. */
  const replaced = moment !== null && own.some((p) => p.id === moment);
  const drawing = eligible && !replaced ? own.filter((p) => !hidden.has(p.id) && cards.find((c) => c.key === p.card)?.drawsReactions === true) : [];
  /* A play that ends while the post is on screen gives the row back at its end. */
  const now = useAt(drawing.filter((p) => p.ends !== undefined).map((p) => Date.parse(p.ends!)));
  return livePlays(drawing, now).some(actsOnPost);
}
