/**
 * What a post offers for playing a card, in its row of actions (the Main board draws it so,
 * docs/research/2026-10-29-two-worlds/01-main.html): "Play card" opens the hand with only the cards
 * that can land on this post; and while a card is armed, a post it can land on shows "Play Whoops!
 * here" in its place, a real button in the card's color that opens the play form on the post. The
 * post itself stays the board's. A post the armed card cannot land on (it already carries all the
 * card takes) shows nothing, so what is offered is always something the server will take, though it
 * decides again.
 *
 * Both are the reader's own screen alone: nothing here is sent anywhere, and a reader with no
 * character to play as is offered neither.
 */
import type { CSSProperties } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { faceOf } from './faces.ts';
import { landing } from './land.ts';
import { usePlay, type PlayTarget } from './play.tsx';
import { usePlays } from './plays.ts';

export function PlayActions({ act }: { readonly act: Act }) {
  const play = usePlay();
  const { hudCharacter } = usePlayer();
  const { instance, ui } = useKayfa();
  const { thread, perPage, summary, plays, nameOf, know } = useThread();
  const here = usePlays(plays, act.id);
  if (!play || !hudCharacter || act.kind !== 'post' || act.seq === null) return null;

  const target: PlayTarget = { post: act, title: summary.title, author: nameOf(act.character), to: threadHref(thread, pageOf(act.seq, perPage), act.seq), plays, know: know ?? (async () => {}) };
  const describedBy = `post-${act.seq}-title`;
  const rules = play.armed === null ? undefined : instance.cards.find((c) => c.key === play.armed);

  if (rules) {
    if (!landing(rules, act, here.plays).ok) return null;
    const face = faceOf(rules, ui.cards.find((c) => c.key === rules.key), instance.settings);
    return (
      <button
        type="button" className="kb-play-here" aria-describedby={describedBy} data-kb-card={rules.key}
        style={{ '--kb-card-color': face.art.color } as CSSProperties}
        onClick={() => play.openForm(rules.key, target)}
      >
        <span className="kb-play-here-swatch" aria-hidden="true" />
        Play {rules.name} here
      </button>
    );
  }
  if (play.armed !== null) return null;
  return (
    <button type="button" className="kb-link-button" aria-describedby={describedBy} onClick={() => play.openHandFor(target)}>
      Play card
    </button>
  );
}
