/**
 * What a post offers for playing a card: the ghost mark, and nothing in the post's 2003 footer bar (the owner on #80's
 * shots: the play control is glass; then: "why do we have "Play card" in this row at all anymore? It's a game act so it
 * should be Glass". The hand is the HUD's, a card is armed there, and the post offers the card itself).
 *
 * While a card is armed, a post it can land on ends its strip of marks (cards/Marks.tsx) in a dashed mark in the card's
 * color with a "+", named "Play Whoops! on post 41", a real button that opens the play form on the post. Arming a card
 * never moves a post: the strip is positioned over it, as the marks are. A post the armed card cannot land on (it already
 * carries all the card takes) shows nothing, so what is offered is always something the server will take, though it
 * decides again. It is the reader's own screen alone: nothing here is sent anywhere, and a reader with no character to
 * play as is offered none.
 */
import type { CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { faceOf, withCardEconomy } from './faces.ts';
import { landing } from './land.ts';
import { usePlay, type PlayTarget } from './play.tsx';
import { usePlays } from './plays.ts';

/** The post a play lands on, as the hand and the form name it. */
function useTarget(act: Act): PlayTarget | null {
  const { thread, perPage, summary, plays, nameOf, know } = useThread();
  if (act.kind !== 'post' || act.seq === null) return null;
  return { post: act, title: summary.title, author: nameOf(act.character), to: threadHref(thread, pageOf(act.seq, perPage), act.seq), plays, know: know ?? (async () => {}) };
}

/** The armed card's play control for a post: the dashed "+" mark that ends its strip. */
export function GhostMark({ act }: { readonly act: Act }) {
  const play = usePlay();
  const { hudCharacter } = usePlayer();
  const { instance, settings, ui } = useKayfa();
  const { plays } = useThread();
  const here = usePlays(plays, act.id);
  const target = useTarget(act);
  const rules = play?.armed == null ? undefined : instance.cards.find((c) => c.key === play.armed);
  if (!play || !hudCharacter || !target || act.seq === null || !rules) return null;
  if (!landing(rules, act, here.plays).ok) return null;
  const face = faceOf(rules, ui.cards.find((c) => c.key === rules.key), withCardEconomy(instance.settings, settings.cardEconomy));
  return (
    <button
      type="button" className="kb-mark kb-ghost-mark" aria-label={`Play ${rules.name} on post ${act.seq}`} data-kb-card={rules.key} data-kb-alignment={rules.alignment}
      style={{ '--kb-mark-color': face.art.color } as CSSProperties}
      onClick={() => play.openForm(rules.key, target)}
    >
      <span className="kb-mark-in" aria-hidden="true"><span className="kb-mark-plus">+</span></span>
    </button>
  );
}
