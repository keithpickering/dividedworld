/**
 * The front door: what a signed-out visitor meets at every board address in place of the board, which stays hidden
 * (docs/plans/2026-11-05-front-door-design.md, sections 2.1 and 2.2). It is a board page, in the board's frame: a made-up thread, "Sample
 * thread", drawn with the thread's own markup and the real postbit, then the developer persona's closing note on the glass.
 *
 * Every word is the instance's (`InstanceUi.frontDoor`), committed and approved by the owner; nothing here is read from the server or differs
 * between visitors, so the screen calls no API method and nothing on it proves a private fact ("A response never proves a private fact").
 * Nothing on it can be pressed but a card's own controls: the postbits are not links, the reactions are counts, and there is no Quote, Spin,
 * Edit, React or permalink.
 *
 * The splat is real. A post's play is drawn by the card's own `CardUi.Effect`, given a play made here with a fixed seed. The visitor is a
 * reader, never the author, so their strokes stay on their screen: `save` and `release` refuse without a request, and a reload brings the
 * ink back. The card's keyboard path (its view's `controls`, drawn by `Kit`) stands under the post as it does in the Lens, so the obstacle
 * costs the same either way ("An accessible path costs what the obstacle costs").
 */
import { Suspense, useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_DEVELOPER } from '../../rules/instance.ts';
import { rankFloor } from '../../rules/ranks.ts';
import { BbCode } from '../bbcode/render.tsx';
import { Kit } from '../cards/Kit.tsx';
import { sameView } from '../cards/plays.ts';
import type { CardPlay, CardUi, CardView, EffectProps } from '../cards/types.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Answer, Character, Id } from '../data/api.ts';
import { Blocks, DASH, type Fill } from '../guide/render.tsx';
import { parse, settingText } from '../guide/markdown.ts';
import { Postbit, type PostbitPerson } from '../postbit/Postbit.tsx';
import { readable } from '../reactions/Reactions.tsx';
import { useLocation } from '../router.tsx';
import type { FrontDoorCharacter, FrontDoorPost } from '../types.ts';
import { PersonaMark } from '../updates/Persona.tsx';
import './front-door.css';

/** The instant every staged Act and play carries: a made-up thread has no real time. */
const STAGED_AT = '2026-01-01T00:00:00.000Z';
const SAMPLE = 'this is a sample post';
const refuse = (): Promise<Answer<never>> => Promise.resolve({ ok: false, error: SAMPLE });

const idOf = (key: string): Id => `front-door:${key}`;

const stage = (c: FrontDoorCharacter): Character => ({
  id: idOf(c.key), name: c.name, title: c.title ?? '', signature: '', avatarSquare: null, avatarPortrait: null, squareFrame: null,
  portraitFrame: null, pipStyle: 'default', joined: '',
});

interface Staged { readonly act: Act; readonly post: FrontDoorPost; readonly person: PostbitPerson | undefined; readonly plays: readonly CardPlay[] }

/** One card's effect around a post's words, with a `show` that keeps what the effect says about itself for the controls under the post. */
function Wrapped({ ui, post, plays, nameOf, onView, children }: {
  readonly ui: CardUi; readonly post: Act; readonly plays: readonly CardPlay[]; readonly nameOf: (c: Id | null) => string;
  readonly onView: (card: string, view: CardView | null) => void; readonly children: ReactNode;
}) {
  const Effect = ui.Effect;
  const show = useCallback((view: CardView | null) => onView(ui.key, view), [onView, ui.key]);
  const none = useCallback(() => {}, []);
  const props: Omit<EffectProps, 'children'> | null = Effect ? {
    post, plays, states: {}, released: NO_RELEASED, reader: { author: false, caster: false }, place: 'thread', reach: 'post', show, met: none,
    holdScreen: none, still: false, marks: null, save: refuse, release: refuse, nameOf,
  } : null;
  return Effect && props ? <Suspense fallback={children}><Effect {...props}>{children}</Effect></Suspense> : <>{children}</>;
}
const NO_RELEASED: ReadonlySet<Id> = new Set();

function Post({ staged, cards, fill, nameOf }: {
  readonly staged: Staged; readonly cards: readonly CardUi[]; readonly fill: (text: string) => string; readonly nameOf: (c: Id | null) => string;
}) {
  const { instance } = useKayfa();
  const { act, post, person, plays } = staged;
  const seq = act.seq!;
  const name = person?.character.name ?? 'A character';
  const [views, setViews] = useState<Readonly<Record<string, CardView>>>({});
  const onView = useCallback((card: string, view: CardView | null) => {
    setViews((was) => {
      const had = was[card];
      if (view === null) { if (had === undefined) return was; const { [card]: _gone, ...rest } = was; return rest; }
      return had !== undefined && sameView(had, view) ? was : { ...was, [card]: view };
    });
  }, []);

  /* The post's words, wrapped by each card played on it in turn, the latest outermost. */
  const order = [...new Set(plays.map((p) => p.card))];
  let body: ReactNode = <BbCode text={fill(post.body)} />;
  for (const key of order) {
    const ui = cards.find((c) => c.key === key);
    if (ui?.Effect) body = <Wrapped key={key} ui={ui} post={act} plays={plays.filter((p) => p.card === key)} nameOf={nameOf} onView={onView}>{body}</Wrapped>;
  }
  const shown = instance.reactions.filter((r) => (post.reactions[r.key] ?? 0) > 0);
  const controls = order.flatMap((key) => (views[key] ? [{ key, ui: cards.find((c) => c.key === key), view: views[key]! }] : []));
  return (
    <article id={`front-door-post-${seq}`} className="kb-act" aria-labelledby={`front-door-post-${seq}-title`} data-kb-seq={seq} data-kb-kind="post" data-kb-postbit="side">
      <h2 id={`front-door-post-${seq}-title`} className="kb-visually-hidden">Post {seq} by {name}</h2>
      {person && <Postbit person={person} layout="side" link={false} />}
      <header className="kb-act-meta"><span className="kb-act-number">#{seq}</span></header>
      <div className="kb-act-main">
        {body}
        {shown.length > 0 && (
          <div className="kb-reactions">
            <ul className="kb-chips" aria-label="Reactions">
              {shown.map((r) => (
                <li key={r.key} className="kb-chip" data-kb-reaction={r.key}>
                  <span className="kb-visually-hidden">{readable(r.key)}, {post.reactions[r.key]}</span>
                  <span aria-hidden="true">{r.emoji} {post.reactions[r.key]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {controls.some((c) => c.view.controls.length > 0) && (
        <footer className="kb-act-foot">
          {controls.map((c) => <Kit key={c.key} card={c.ui?.key ?? c.key} controls={c.view.controls} />)}
        </footer>
      )}
    </article>
  );
}

export function FrontDoor() {
  const { instance, ui, settings } = useKayfa();
  const { path } = useLocation();
  const door = ui.frontDoor;
  const label = useId();
  const noteTitle = useId();
  const persona = instance.developer ?? DEFAULT_DEVELOPER;
  const picture = persona.avatar === undefined ? undefined : ui.avatars?.[persona.avatar];
  const fill = useCallback((text: string) => text.replace(/\{\{setting:([^}]+)\}\}/gu, (_m, p: string) => settingText(p.trim(), settings) ?? DASH), [settings]);

  const cast = useMemo(() => new Map(door.cast.map((c) => {
    const rank = Math.min(Math.max(c.rank, 0), Math.max(instance.ranks.length - 1, 0));
    /* The rank's floor is a standing the postbit's rankIndex lands on that rank. */
    const standing = rankFloor(instance.ranks, rank);
    const person: PostbitPerson = { character: stage(c), posts: c.posts, standing, revealed: c.revealed ?? null, turnedAt: null };
    return [c.key, person] as const;
  })), [door.cast, instance.ranks]);
  const nameOf = useCallback((id: Id | null) => door.cast.find((c) => idOf(c.key) === id)?.name ?? 'A character', [door.cast]);

  const staged = useMemo<readonly Staged[]>(() => door.posts.map((post, i) => {
    const person = cast.get(post.by);
    const actId = idOf(String(i));
    const act: Act = {
      id: actId, character: person?.character.id ?? null, kind: 'post', thread: idOf('thread'), targetActId: null, seq: i + 1, createdAt: STAGED_AT,
      payload: { body: post.body }, currentPayload: { body: fill(post.body) }, editedAt: null, shownEditedAt: null,
    };
    const plays = (post.plays ?? []).map<CardPlay>((p, j) => ({
      id: `front-door:${i}:${j}`, card: p.card, layer: 1, caster: idOf(p.by), message: '', config: p.config, playedAt: STAGED_AT, post: actId,
    }));
    return { act, post, person, plays };
  }), [door.posts, cast, fill]);

  const note = useMemo(() => parse(door.note).filter((b) => b.t !== 'marker'), [door.note]);
  const noteFill: Fill = { settings, path, marker: () => null };

  return (
    <div className="kb-front-door">
      <section aria-labelledby={label}>
        <div className="kb-front-door-top">
          <p className="kb-crumb">{ui.copy.siteName} » {door.title}</p>
          <span id={label} className="kb-front-door-label">{door.label}</span>
        </div>
        <h1 className="kb-heading kb-thread-title">{door.title}</h1>
        <div className="kb-acts">
          <div className="kb-acts-head" aria-hidden="true"><span>Author</span><span>Message</span></div>
          {staged.map((s) => <Post key={s.act.id} staged={s} cards={ui.cards} fill={fill} nameOf={nameOf} />)}
        </div>
        <section className="kb-glass kb-front-door-note" aria-labelledby={noteTitle}>
          <h2 id={noteTitle} className="kb-visually-hidden">A note from {persona.name}</h2>
          <div className="kb-updates-by">
            <PersonaMark name={persona.name} picture={picture} />
            <div>
              <b className="kb-updates-name">{persona.name}</b>
              {persona.tagline !== '' && <span className="kb-updates-tagline">{persona.tagline}</span>}
            </div>
          </div>
          <div className="kb-front-door-prose"><Blocks blocks={note} fill={noteFill} demote={2} /></div>
        </section>
      </section>
    </div>
  );
}
