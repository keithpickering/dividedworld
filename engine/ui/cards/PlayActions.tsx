/**
 * What a post offers for playing a card: `PlayHere`, a glass tile, and nothing in the post's 2003 footer bar (the owner on
 * #80's shots: the play control is glass; then: "why do we have "Play card" in this row at all anymore? It's a game act so
 * it should be Glass". The hand is the HUD's, a card is armed there, and the post offers the card itself).
 *
 * While a card is armed, a post it can land on shows "Play Whoops! here", a real button in the card's alignment that opens
 * the play form on the post. It stands in the plate the post's effect has drawn (cards/Effects.tsx `EffectStrip`) when the
 * post has one, and as a tile of its own attached under the post when it has not; it is drawn into the post's slot by a
 * portal, so it is outside the 2003 chrome and the splat's ink never lies over it. A post the armed card cannot land on (it
 * already carries all the card takes) shows nothing, so what is offered is always something the server will take, though it
 * decides again. It is the reader's own screen alone: nothing here is sent anywhere, and a reader with no character to play
 * as is offered none.
 */
import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useKayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { usePlateHere } from './Effects.tsx';
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

/** The armed card's play control for a post: a glass tile in the post's plate, or under the post in its slot. */
export function PlayHere({ act, slot }: { readonly act: Act; readonly slot: RefObject<HTMLElement | null> }) {
  const play = usePlay();
  const { hudCharacter } = usePlayer();
  const { instance, settings, ui } = useKayfa();
  const { plays } = useThread();
  const here = usePlays(plays, act.id);
  const target = useTarget(act);
  const plate = usePlateHere();
  /* The post's slot is read once it is mounted, so the tile is drawn again and not the post's words. */
  const [own, setOwn] = useState<HTMLElement | null>(null);
  useEffect(() => { setOwn(slot.current); }, [slot]);
  const rules = play?.armed == null ? undefined : instance.cards.find((c) => c.key === play.armed);
  const where = plate ?? own;
  if (!play || !hudCharacter || !target || act.seq === null || !rules || !where) return null;
  if (!landing(rules, act, here.plays).ok) return null;
  const face = faceOf(rules, ui.cards.find((c) => c.key === rules.key), withCardEconomy(instance.settings, settings.cardEconomy));
  return createPortal(
    <button
      type="button" className="kb-plate-tile kb-play-here" aria-describedby={`post-${act.seq}-title`} data-kb-card={rules.key} data-kb-alignment={rules.alignment}
      data-kb-where={plate ? 'plate' : 'post'}
      style={{ '--kb-card-color': face.art.color } as CSSProperties}
      onClick={() => play.openForm(rules.key, target)}
    >
      <span className="kb-play-here-swatch" aria-hidden="true" />
      <span className="kb-plate-tile-label">Play {rules.name} here</span>
    </button>,
    where,
  );
}
