/**
 * What a card play shows on its post: the tag that says it happened, and the card's effect around
 * the post's words.
 *
 * The tag is the whole of a play's own presence in a thread ("Mrs. Hooligan played Whoops! on this
 * post: “you dropped your ink”", and when): a card play takes no number and is never a line of its
 * own, and the post it lands on keeps its number and everyone's reactions. It is the glass reaching
 * into the board, drawn on the `effect` smoke in the card's alignment's tokens, and it links to the
 * post: a play is a layer on a post and is found there, which is the link every other place that
 * names a play (the ORIGIN box, later the log) gives it too. A card the instance gives no `CardUi`
 * is shown as its tag alone.
 *
 * An effect (`CardUi.Effect`) wraps the post's words wherever they are drawn (the thread, and the
 * ORIGIN box of a thread spun from the post). Each played card's wraps the cards played before it,
 * in play order, so the latest is outermost. A post with no plays, or whose plays' cards draw no
 * effect, is drawn untouched.
 */
import { useCallback, type CSSProperties, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { Smoke, useSurfaceStyle } from '../glass/Smoke.tsx';
import { when } from '../thread/lines.tsx';
import { usePlays, type Plays } from './plays.ts';
import type { CardPlay, CardUi, EffectPlace, EffectProps } from './types.ts';
import './cards.css';

const NOT_AUTHOR = 'only the post\'s author saves what is on it';

/** Wraps a post's words in the effect of each card played on it, in play order. */
export function PostEffects({ plays, post, place, children }: { readonly plays: Plays; readonly post: Act; readonly place: EffectPlace; readonly children: ReactNode }) {
  const { api, ui } = useKayfa();
  const { actingCharacters } = usePlayer();
  const here = usePlays(plays, post.id);
  /* The character of the reader's that wrote the post, if any: the only one a state is saved as. */
  const author = actingCharacters.find((c) => c.id === post.character) ?? null;
  const save = useCallback<EffectProps['save']>(async (play, state) => {
    if (!author) return { ok: false, error: NOT_AUTHOR };
    const saved = await api.saveEffect(play, author.id, state);
    if (saved.ok) plays.setStates({ [play]: { state, savedAt: saved.value.savedAt } });
    return saved;
  }, [api, author, plays]);
  const release = useCallback<EffectProps['release']>(async (play) => {
    const released = await api.releaseEffect(play);
    if (released.ok) plays.setReleased([play]);
    return released;
  }, [api, plays]);

  if (here.plays.length === 0) return <>{children}</>;
  /* The cards in the order each was first played: the first is innermost. */
  const keys = [...new Set(here.plays.map((p) => p.card))];
  let wrapped = children;
  for (const key of keys) {
    const card = ui.cards.find((c) => c.key === key);
    if (!card?.Effect) continue;
    const mine = here.plays.filter((p) => p.card === key);
    const Effect = card.Effect;
    wrapped = (
      <Effect
        key={key} post={post} plays={mine} states={here.states} released={here.released} place={place} save={save} release={release}
        reader={{ author: author !== null, caster: mine.some((p) => actingCharacters.some((c) => c.id === p.caster)) }}
      >
        {wrapped}
      </Effect>
    );
  }
  return <>{wrapped}</>;
}

/** One play's tag: the card, who played it with their words, and when. */
export function PlayTag({ play, caster, to, tint }: { readonly play: CardPlay; readonly caster: string; readonly to: string | null; readonly tint?: ReturnType<NonNullable<CardUi['tag']>> }) {
  const { instance } = useKayfa();
  const rules = instance.cards.find((c) => c.key === play.card);
  const card = rules?.name ?? play.card;
  const calm = useSurfaceStyle('effect');
  const said = play.message ? `: “${play.message}”` : '';
  /* One sentence to read; the drawn pieces (the card's name over its caster's words) are for the eye, so a screen reader hears it once. */
  const sentence = `${caster} played ${card} on this post${said}`;
  const words = <><span className="kb-visually-hidden">{sentence}</span><span aria-hidden="true">{caster}{said}</span></>;
  /* A card that chooses its tag's colors fills it solid with them, so its text stands on a fill it knows, with no smoke under it. */
  const style = tint ? { ...calm, '--kb-tag-fill': tint.fill, '--kb-tag-ink': tint.text } as CSSProperties : calm;
  return (
    <li className="kb-glass kb-play-tag" data-kb-card={play.card} data-kb-alignment={rules?.alignment} data-kb-tinted={tint ? 'true' : undefined} data-kb-play={play.id} style={style}>
      {!tint && <Smoke surface="effect" />}
      <span className="kb-play-tag-card kb-calm" aria-hidden="true">{card}</span>
      <span className="kb-play-tag-words kb-calm">{to ? <Link to={to}>{words}</Link> : words}</span>
      <time className="kb-play-tag-when kb-calm" dateTime={play.playedAt}>{when(play.playedAt)}</time>
    </li>
  );
}

/**
 * The tags of every play on a post, in play order; nothing at all where there are none. `to` is the
 * post's own address, which each tag links to; `nameOf` says the caster's name.
 */
export function PlayTags({ plays, post, to, nameOf }: { readonly plays: Plays; readonly post: Id; readonly to: string | null; readonly nameOf: (character: Id | null) => string }) {
  const { ui } = useKayfa();
  const here = usePlays(plays, post);
  if (here.plays.length === 0) return null;
  return (
    <ul className="kb-play-tags" aria-label="Cards played on this post">
      {here.plays.map((p) => <PlayTag key={p.id} play={p} caster={nameOf(p.caster)} to={to} tint={ui.cards.find((c) => c.key === p.card)?.tag?.(p, here.plays.filter((o) => o.card === p.card))} />)}
    </ul>
  );
}
