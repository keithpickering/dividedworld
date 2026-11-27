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
 * A post wearing a card that folds the row (`CardUi.foldsRow`) folds it as a thread's does (`thread/fold.tsx`): a bar with the marks in it, the row behind,
 * the visitor's own press to open it. Its plays are live at the staged instant, since no clock is read.
 *
 * The door is also the first page's impact (docs/plans/2026-11-27-front-door-impact-design.md, section 1): for a visitor it stages bright effects
 * (`stageEffects`, unless the device asks for more contrast or forced colors) and, when a staged play's card has sounds, the game bus
 * (`stageSound`), both released when the door unmounts. The "Sound: on" toggle is the visitor's mute; its press is also the gesture that unlocks audio.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DEFAULT_DEVELOPER } from '../../rules/instance.ts';
import { rankFloor } from '../../rules/ranks.ts';
import { BYTES, cellsOf, count, GRID, hasCell, union, type Cells } from '../../rules/surface.ts';
import { BbCode } from '../bbcode/render.tsx';
import { stageEffects } from '../appearance.ts';
import { stageSound } from '../audio/sound.ts';
import { PostEffects, WriteLateNote } from '../cards/Effects.tsx';
import { LensProvider } from '../cards/Lens.tsx';
import { PostMarks } from '../cards/Marks.tsx';
import { createPlays, type Plays } from '../cards/plays.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Character, Id, SurfaceAct } from '../data/api.ts';
import { Blocks, DASH, type Fill } from '../guide/render.tsx';
import { parse, settingText } from '../guide/markdown.ts';
import { Postbit, type PostbitPerson } from '../postbit/Postbit.tsx';
import { createMine, type Mine } from '../reactions/mine.ts';
import { Reactions } from '../reactions/Reactions.tsx';
import { useLocation } from '../router.tsx';
import { StagedCtx } from '../staged.ts';
import { FoldedRow, useRowFolding } from '../thread/fold.tsx';
import { createTallies, type Tallies } from '../thread/tallies.ts';
import type { FrontDoorCharacter } from '../types.ts';
import { PersonaMark } from '../updates/Persona.tsx';
import './front-door.css';
import { frontDoorId, frontDoorPlayId } from './ids.ts';
import { ENGINE_DEFAULT_PRONOUNS } from '../../rules/pronouns.ts';
import { forgedList } from '../../bbcode/quoted.ts';

/** The instant every staged Act and play carries: a made-up thread has no real time. */
const STAGED_AT = '2026-01-01T00:00:00.000Z';

const idOf = frontDoorId;

/**
 * A staged wall's draws as a wall's live Acts, oldest first, each with the share of the wall it owns: a later draw owns the cells it covers
 * (`surfaceStep` in data/fake.ts prunes a draw left owning nothing, so a staged wall drops it too and shows what a live thread would).
 */
function wallShares(draws: readonly Cells[]): readonly number[] {
  const owners = new Uint16Array(GRID * GRID);
  draws.forEach((cells, k) => { for (let i = 0; i < owners.length; i++) if (hasCell(cells, i)) owners[i] = k + 1; });
  const owned = new Array<number>(draws.length).fill(0);
  for (const o of owners) if (o !== 0) owned[o - 1]!++;
  return owned;
}

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
  /* A post wearing a card that folds the row is drawn as the thread draws it (thread/fold.tsx): a bar with the marks in it, and the row behind. A staged post's plays are live at the staged instant. */
  const { ui } = useKayfa();
  const ref = useRef<HTMLElement>(null);
  const fold = useRowFolding({ plays: stores.plays, actId: act.id, eligible: true, now: Date.parse(STAGED_AT), cards: ui.cards, article: ref });
  return (
    <article
      ref={ref} id={`front-door-post-${seq}`} className="kb-act" aria-labelledby={`front-door-post-${seq}-title`} data-kb-seq={seq} data-kb-kind="post" data-kb-postbit="side"
      data-kb-fold={fold.folding ? (fold.folded ? 'open' : 'folded') : undefined}
    >
      <h2 id={`front-door-post-${seq}-title`} className="kb-visually-hidden">Post {seq} by {name}</h2>
      <FoldedRow fold={fold} id={`front-door-post-${seq}-row`} bar={{ person, name, spoken: name, seq, marks }}>
        {person && <Postbit person={person} layout="side" link={false} />}
        <header className="kb-act-meta">{!fold.folding && marks}<span className="kb-act-number">#{seq}</span></header>
        <div className="kb-act-main" data-kb-content-area>
          <PostEffects plays={stores.plays} post={act} place="thread" marks={marks} nameOf={nameOf}><BbCode text={body} forged={forgedList(act.currentPayload)} /></PostEffects>
          <Reactions act={act.id} author={act.character} authorName={name} tallies={stores.tallies} mine={stores.mine} />
        </div>
        <WriteLateNote plays={stores.plays} post={act} />
      </FoldedRow>
    </article>
  );
}

const CONTRAST_QUERIES = ['(prefers-contrast: more)', '(forced-colors: active)'] as const;
const mediaOf = (): MediaQueryList[] => (typeof window === 'undefined' ? [] : CONTRAST_QUERIES.flatMap((q) => window.matchMedia?.(q) ?? []));
function subscribeContrast(onChange: () => void): () => void {
  const queries = mediaOf();
  for (const q of queries) q.addEventListener?.('change', onChange);
  return () => { for (const q of queries) q.removeEventListener?.('change', onChange); };
}
/** Whether the device asks for more contrast or forced colors, kept current; without `matchMedia` it does not. */
function useHighContrast(): boolean {
  return useSyncExternalStore(subscribeContrast, () => mediaOf().some((q) => q.matches), () => false);
}

/** The visitor's own mute for the door's game sound; its press is the gesture that unlocks audio, so it needs no other code. */
function SoundToggle({ on, set }: { readonly on: boolean; readonly set: (on: boolean) => void }) {
  return <button type="button" className="kb-button" aria-pressed={on} onClick={() => set(!on)}>Sound: {on ? 'on' : 'off'}</button>;
}

export function FrontDoor() {
  const { instance, ui, settings } = useKayfa();
  const { path } = useLocation();
  const door = ui.frontDoor;
  const label = useId();
  const noteTitle = useId();
  const persona = instance.developer ?? DEFAULT_DEVELOPER;
  const picture = persona.avatar === undefined ? undefined : ui.avatars?.[persona.avatar];
  /* A post's picture must be an http(s) address (`safeImageSrc`), and a bundled file's address is root-relative, so a staged
     picture that starts with a single `/` is made absolute against the page's own origin. These words are the instance's
     committed content, never a player's; a protocol-relative or absolute address is left to the parser as anywhere. */
  const fill = useCallback((text: string) => text
    .replace(/\{\{setting:([^}]+)\}\}/gu, (_m, p: string) => settingText(p.trim(), settings) ?? DASH)
    .replace(/\[img\](\/(?!\/)[^[]*)\[\/img\]/giu, (_m, src: string) => `[img]${new URL(src, window.location.origin).href}[/img]`), [settings]);

  const cast = useMemo(() => new Map(door.cast.map((c) => {
    const rank = Math.min(Math.max(c.rank, 0), Math.max(instance.ranks.length - 1, 0));
    /* The rank's floor is a standing the postbit's rankIndex lands on that rank. */
    const standing = rankFloor(instance.ranks, rank);
    const person: PostbitPerson = { character: stage(c, settings.groups[0]?.key ?? ''), posts: c.posts, standing, revealed: c.revealed ?? null };
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
        const id = frontDoorPlayId(i, j, p);
        acts.push({
          id, character: idOf(p.by), kind: 'card', thread: idOf('thread'), targetActId: idOf(String(i)), seq: null, createdAt: STAGED_AT,
          payload: { card: p.card, layer: p.layer ?? 1, config: p.config }, currentPayload: {}, editedAt: null, shownEditedAt: null,
        });
        if (p.reactions) tallies.merge(id, p.reactions);
      });
    });
    plays.add(acts);
    /* A play's saved state, and a surface play's draws as its wall's live Acts (what `readSurface` would have read), both with no read. */
    door.posts.forEach((post, i) => {
      (post.plays ?? []).forEach((p, j) => {
        const id = frontDoorPlayId(i, j, p);
        if (p.state !== undefined) plays.setStates({ [id]: { state: p.state, savedAt: STAGED_AT } });
        const rules = instance.cards.find((c) => c.key === p.card);
        if (p.draws === undefined || !rules?.surface) return;
        const kept: { readonly by: string; readonly payload: Record<string, unknown>; readonly cells: Cells }[] = [];
        for (const d of p.draws) {
          const verdict = rules.surface.validateDraw(d.draw);
          if (verdict.ok) kept.push({ by: d.by, payload: verdict.value.payload, cells: cellsOf(verdict.value.strokes) });
        }
        const shares = wallShares(kept.map((k) => k.cells));
        const wall: SurfaceAct[] = kept.flatMap((k, n) => shares[n] === 0 ? [] : [{
          id: idOf(`draw:${i}:${j}:${n}`), character: idOf(k.by), kind: 'draw', thread: idOf('thread'), targetActId: id, seq: null, createdAt: STAGED_AT,
          payload: k.payload, currentPayload: {}, editedAt: null, shownEditedAt: null, share: shares[n]!,
        }]);
        plays.setSurfaceActs(id, count(kept.reduce<Cells>((all, k) => union(all, k.cells), new Uint8Array(BYTES))), wall);
      });
    });
    return { plays, tallies, mine: createMine() };
  }, [door.posts, instance.cards]);

  /* Whether a staged play's card has sounds: only then is there game sound to stage or to mute. */
  const noisy = useMemo(() => door.posts.some((post) => (post.plays ?? []).some((p) => (ui.cards.find((c) => c.key === p.card)?.sounds?.length ?? 0) > 0)), [door.posts, ui.cards]);
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => (noisy ? stageSound({ gameSound: soundOn ? 'on' : 'off' }) : undefined), [noisy, soundOn]);
  const highContrast = useHighContrast();
  useLayoutEffect(() => stageEffects(highContrast ? 'standard' : 'bright'), [highContrast]);

  const note = useMemo(() => parse(door.note).filter((b) => b.t !== 'marker'), [door.note]);
  const noteFill: Fill = { settings, path, marker: () => null };

  return (
    <div className="kb-front-door">
      <section aria-labelledby={label}>
        <div className="kb-front-door-top">
          <p className="kb-crumb">{ui.copy.siteName} » {door.title}</p>
          <span id={label} className="kb-front-door-label">{door.label}</span>
          {noisy && <SoundToggle on={soundOn} set={setSoundOn} />}
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
