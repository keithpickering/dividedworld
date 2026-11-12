/**
 * The front door: what a signed-out visitor meets at every board address in place of the board, which stays hidden
 * (docs/plans/2026-11-05-front-door-design.md, sections 2.1 and 2.2). It is a board page, in the board's frame: a made-up thread, "Sample
 * thread", drawn with the thread's own pieces, then the developer persona's closing note on the glass.
 *
 * Every word is the instance's (`InstanceUi.frontDoor`), committed and approved by the owner; nothing here is read from the server or differs
 * between visitors, so the screen calls no API method and nothing on it proves a private fact ("A response never proves a private fact").
 *
 * The thread plays like one (docs/plans/2026-11-07-front-door-play-design.md). Each post is drawn as a thread draws it: the postbit, the
 * marks of the cards played on it on its date row, its words wrapped by those cards' effects (`PostEffects`), and its reactions under them.
 * All of it runs on stores this page builds for itself, inside `StagedCtx` (../staged.ts), so a visitor can react to a post or a play,
 * open a mark's Lens and scrub a splat there with its keyboard path, as in play ("An accessible path costs what the obstacle costs"),
 * and nothing is sent anywhere: a reload brings back the thread as the instance wrote it. The postbits are not links, and there is no
 * Quote, Spin, Edit, Report, permalink, Go to post or As it landed: a sample thread has nowhere for them to go.
 */
import { useCallback, useId, useMemo } from 'react';
import { DEFAULT_DEVELOPER } from '../../rules/instance.ts';
import { rankFloor } from '../../rules/ranks.ts';
import { BbCode } from '../bbcode/render.tsx';
import { PostEffects } from '../cards/Effects.tsx';
import { LensProvider } from '../cards/Lens.tsx';
import { PostMarks } from '../cards/Marks.tsx';
import { createPlays, type Plays } from '../cards/plays.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Character, Id } from '../data/api.ts';
import { Blocks, DASH, type Fill } from '../guide/render.tsx';
import { parse, settingText } from '../guide/markdown.ts';
import { Postbit, type PostbitPerson } from '../postbit/Postbit.tsx';
import { createMine, type Mine } from '../reactions/mine.ts';
import { Reactions } from '../reactions/Reactions.tsx';
import { useLocation } from '../router.tsx';
import { StagedCtx } from '../staged.ts';
import { createTallies, type Tallies } from '../thread/tallies.ts';
import type { FrontDoorCharacter } from '../types.ts';
import { PersonaMark } from '../updates/Persona.tsx';
import './front-door.css';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';

/** The instant every staged Act and play carries: a made-up thread has no real time. */
const STAGED_AT = '2026-01-01T00:00:00.000Z';

const idOf = (key: string): Id => `front-door:${key}`;

/** A made-up character is in the ladder's first rung, the one every new character starts in. */
const stage = (c: FrontDoorCharacter, group: string): Character => ({
  id: idOf(c.key), name: c.name, title: c.title ?? '', signature: '', avatarSquare: c.avatarSquare ?? null, avatarPortrait: c.avatarPortrait ?? null, squareFrame: null,
  portraitFrame: null, portraitTallness: null, outfit: [], trophies: [], pipStyle: 'default', pronouns: ENGINE_DEFAULT_PRONOUNS, joined: '', group,
});

interface Staged { readonly act: Act; readonly person: PostbitPerson | undefined }

/** The stores a thread keeps beside its page, built here once for the staged thread: its plays, its counts, and the visitor's own. */
interface Stores { readonly plays: Plays; readonly tallies: Tallies; readonly mine: Mine }

const noSpin = () => {};

function Post({ staged, stores, nameOf }: { readonly staged: Staged; readonly stores: Stores; readonly nameOf: (c: Id | null) => string }) {
  const { act, person } = staged;
  const seq = act.seq!;
  const name = person?.character.name ?? 'A character';
  /* The sample cast has no pictures. */
  const marks = <PostMarks post={act.id} plays={stores.plays} to={null} moments={false} nameOf={nameOf} faceOf={() => null} tallies={stores.tallies} mine={stores.mine} onSpin={noSpin} />;
  const body = typeof act.currentPayload.body === 'string' ? act.currentPayload.body : '';
  return (
    <article id={`front-door-post-${seq}`} className="kb-act" aria-labelledby={`front-door-post-${seq}-title`} data-kb-seq={seq} data-kb-kind="post" data-kb-postbit="side">
      <h2 id={`front-door-post-${seq}-title`} className="kb-visually-hidden">Post {seq} by {name}</h2>
      {person && <Postbit person={person} layout="side" link={false} />}
      <header className="kb-act-meta">{marks}<span className="kb-act-number">#{seq}</span></header>
      <div className="kb-act-main">
        <PostEffects plays={stores.plays} post={act} place="thread" marks={marks} nameOf={nameOf}><BbCode text={body} /></PostEffects>
        <Reactions act={act.id} author={act.character} authorName={name} tallies={stores.tallies} mine={stores.mine} />
      </div>
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
    const person: PostbitPerson = { character: stage(c, settings.groups[0]?.key ?? ''), posts: c.posts, standing, revealed: c.revealed ?? null, turnedAt: null };
    return [c.key, person] as const;
  })), [door.cast, instance.ranks]);
  const nameOf = useCallback((id: Id | null) => door.cast.find((c) => idOf(c.key) === id)?.name ?? 'A character', [door.cast]);

  const staged = useMemo<readonly Staged[]>(() => door.posts.map((post, i) => {
    const person = cast.get(post.by);
    const act: Act = {
      id: idOf(String(i)), character: person?.character.id ?? null, kind: 'post', thread: idOf('thread'), targetActId: null, seq: i + 1, createdAt: STAGED_AT,
      payload: { body: post.body }, currentPayload: { body: fill(post.body) }, editedAt: null, shownEditedAt: null,
    };
    return { act, person };
  }), [door.posts, cast, fill]);

  /* The plays as the Acts a thread reads them from, and every count the instance starts the thread with, on the post or on a play. */
  const stores = useMemo<Stores>(() => {
    const plays = createPlays();
    const tallies = createTallies();
    const acts: Act[] = [];
    door.posts.forEach((post, i) => {
      tallies.merge(idOf(String(i)), post.reactions);
      (post.plays ?? []).forEach((p, j) => {
        const id = idOf(`${i}:${j}`);
        acts.push({
          id, character: idOf(p.by), kind: 'card', thread: idOf('thread'), targetActId: idOf(String(i)), seq: null, createdAt: STAGED_AT,
          payload: { card: p.card, layer: p.layer ?? 1, config: p.config }, currentPayload: {}, editedAt: null, shownEditedAt: null,
        });
        if (p.reactions) tallies.merge(id, p.reactions);
      });
    });
    plays.add(acts);
    return { plays, tallies, mine: createMine() };
  }, [door.posts]);

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
        <StagedCtx.Provider value={true}>
          <LensProvider>
            <div className="kb-acts">
              <div className="kb-acts-head" aria-hidden="true"><span>Author</span><span>Message</span></div>
              {staged.map((s) => <Post key={s.act.id} staged={s} stores={stores} nameOf={nameOf} />)}
            </div>
          </LensProvider>
        </StagedCtx.Provider>
        <section className="kb-glass kb-glass-cut-dialog kb-front-door-note" aria-labelledby={noteTitle}>
          <h2 id={noteTitle} className="kb-visually-hidden">A note from {persona.name}</h2>
          <div className="kb-front-door-prose"><Blocks blocks={note} fill={noteFill} demote={2} /></div>
          <div className="kb-updates-by">
            <PersonaMark name={persona.name} picture={picture} />
            <div>
              <b className="kb-updates-name">{persona.name}</b>
              {persona.tagline !== '' && <span className="kb-updates-tagline">{persona.tagline}</span>}
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}
