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
 * An effect's words and controls are not the post's (the owner's notes on #80: "game state data should not be in
 * the 2003 chrome"). An effect is given a `slot`, a place under the post's chrome, and fills it with an
 * `EffectStrip`, one chamfered glass plate attached to the post; the post's own body holds the effect and nothing a
 * player presses. The thread's post draws the slot itself (thread/Post.tsx), under its words; where a post is
 * drawn without one `PostEffects` draws its own right after the effect. The ORIGIN box draws its slot after the box (spin/Origin.tsx), outside the 2003 chrome.
 *
 * An effect (`CardUi.Effect`) wraps the post's words wherever they are drawn (the thread, and the
 * ORIGIN box of a thread spun from the post). Each played card's wraps the cards played before it,
 * in play order, so the latest is outermost. A post with no plays, or whose plays' cards draw no
 * effect, is drawn untouched.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
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
export function PostEffects({ plays, post, place, slot, children }: { readonly plays: Plays; readonly post: Act; readonly place: EffectPlace; readonly slot?: RefObject<HTMLElement | null>; readonly children: ReactNode }) {
  const [own, setOwn] = useState<HTMLElement | null>(null);
  const hosted = slot !== undefined;
  /* The slot the thread's post draws is read once it is mounted, here, so only the effect is drawn again and not the post's words. */
  const [placed, setPlaced] = useState<HTMLElement | null>(null);
  useEffect(() => { if (slot) setPlaced(slot.current); }, [slot]);
  const { api, ui } = useKayfa();
  const { actingCharacters, writingCharacters } = usePlayer();
  const here = usePlays(plays, post.id);
  /*
   * The character of the reader's that wrote the post, if any: the only one a state is saved as. Retired or not, since the
   * post's player answers for what is on it (#85); casting and releasing stay with the masks that can act.
   */
  const author = writingCharacters.find((c) => c.id === post.character) ?? null;
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
        key={key} post={post} plays={mine} states={here.states} released={here.released} place={place} slot={hosted ? placed : own} save={save} release={release}
        reader={{ author: author !== null, caster: mine.some((p) => actingCharacters.some((c) => c.id === p.caster)) }}
      >
        {wrapped}
      </Effect>
    );
  }
  return <>{wrapped}{!hosted && <div className="kb-act-slot" ref={setOwn} />}</>;
}

/**
 * Where a post's armed card is played from, when its effect has drawn a plate: the plate's own place for it. The post
 * (thread/Post.tsx) wraps itself in a `PlateProvider`; a plate puts its host in here, and the post's play control
 * (PlayActions.tsx `PlayHere`) stands in the plate when there is one, and as a tile of its own under the post when
 * there is not. It is state in a provider of its own so that a plate appearing draws the control again and not the
 * post's words.
 */
interface PlateHost { readonly here: HTMLElement | null; readonly add: (el: HTMLElement) => void; readonly remove: (el: HTMLElement) => void }
const PlateContext = createContext<PlateHost | null>(null);

export function PlateProvider({ children }: { readonly children: ReactNode }) {
  /* Every plate on the post, in the order each was drawn: two effects can each draw one, and the tile stands in the first that remains. */
  const [plates, setPlates] = useState<readonly HTMLElement[]>([]);
  const add = useCallback((el: HTMLElement) => setPlates((all) => (all.includes(el) ? all : [...all, el])), []);
  const remove = useCallback((el: HTMLElement) => setPlates((all) => (all.includes(el) ? all.filter((o) => o !== el) : all)), []);
  const here = plates[0] ?? null;
  const host = useMemo(() => ({ here, add, remove }), [here, add, remove]);
  return <PlateContext.Provider value={host}>{children}</PlateContext.Provider>;
}

/** The plate's place for the play control, if the post has drawn a plate. */
export const usePlateHere = (): HTMLElement | null => useContext(PlateContext)?.here ?? null;

/**
 * One deliberate piece of glass an effect draws into its `slot`: a chamfered plate attached to the post, outside its
 * 2003 chrome, on the `effect` smoke in the card's alignment's border and glow (the owner on #80's shots: "less
 * focused and intentional than it could be"; board 06's How loud row is the idiom, and section 5's chamfer is the
 * shape). Its head is a readout, the card's name and `readout`, the state the card has to say; the rest is the
 * card's words and its controls, which it draws as `kb-plate-tile`s (cards.css), and the post's play control stands
 * among them while a card is armed. Nothing is drawn until the slot is there. What it holds is the card's: the
 * engine fixes only where it stands and the shape it is.
 */
export function EffectStrip({ slot, card, readout, children }: { readonly slot: HTMLElement | null; readonly card: string; readonly readout?: ReactNode; readonly children: ReactNode }) {
  const { instance } = useKayfa();
  const calm = useSurfaceStyle('effect');
  const host = useContext(PlateContext);
  const add = host?.add;
  const remove = host?.remove;
  /* The plate's place for the play control is the post's while the plate is drawn, and no longer. A ref's null does not say which element left, so each plate remembers its own. */
  const mine = useRef<HTMLElement | null>(null);
  const place = useCallback((el: HTMLElement | null) => {
    if (el) { mine.current = el; add?.(el); } else if (mine.current) { remove?.(mine.current); mine.current = null; }
  }, [add, remove]);
  if (!slot) return null;
  const rules = instance.cards.find((c) => c.key === card);
  return createPortal(
    <div className="kb-glass kb-effect-strip" data-kb-card={card} data-kb-alignment={rules?.alignment} style={calm}>
      <div className="kb-effect-plate kb-glass-cut-dialog">
        <Smoke surface="effect" />
        <div className="kb-effect-plate-in kb-calm">
          <p className="kb-plate-head">
            <span className="kb-plate-name kb-glass-display">{rules?.name ?? card}</span>
            {readout}
          </p>
          {children}
          <div className="kb-plate-here" ref={place} />
        </div>
      </div>
    </div>,
    slot,
  );
}

/** One play's tag: the card, who played it with their words, and when. */
export function PlayTag({ play, caster, to, tint }: { readonly play: CardPlay; readonly caster: string; readonly to: string | null; readonly tint?: ReturnType<NonNullable<CardUi['tag']>> }) {
  const { instance } = useKayfa();
  const rules = instance.cards.find((c) => c.key === play.card);
  const card = rules?.name ?? play.card;
  const calm = useSurfaceStyle('effect');
  const said = play.message ? `“${play.message}”` : '';
  /* One sentence to read; the drawn pieces (the card's name, its caster, and the caster's words on a line of their own) are for the eye, so a screen reader hears it once. */
  const sentence = `${caster} played ${card} on this post${said ? `: ${said}` : ''}`;
  /*
   * The link's box is `display: contents` (cards.css), so the caster and the message are grid items of the tag itself and the
   * message can take the line under the first, while the whole tag is still one link to the post.
   */
  const words = (
    <>
      <span className="kb-visually-hidden">{sentence}</span>
      <span className="kb-play-tag-who" aria-hidden="true">{caster}</span>
      {said && <span className="kb-play-tag-message" aria-hidden="true">{said}</span>}
    </>
  );
  /* A card that chooses its tag's ink gives the glass that ink for its border and glow, as the Main board draws the tag over #41; the smoke and the glass's own text stay. */
  const style = tint ? { ...calm, '--kb-tag': tint } as CSSProperties : calm;
  return (
    <li className="kb-glass kb-play-tag" data-kb-card={play.card} data-kb-alignment={rules?.alignment} data-kb-tinted={tint ? 'true' : undefined} data-kb-play={play.id} style={style}>
      <Smoke surface="effect" />
      <div className="kb-play-tag-in kb-calm">
        <span className="kb-play-tag-card" aria-hidden="true">{card}</span>
        {to ? <Link className="kb-play-tag-words" to={to}>{words}</Link> : <span className="kb-play-tag-words">{words}</span>}
        <time className="kb-play-tag-when" dateTime={play.playedAt}>{when(play.playedAt)}</time>
      </div>
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
