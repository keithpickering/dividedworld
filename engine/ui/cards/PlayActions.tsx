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
import type { PronounSet } from '../../rules/pronouns.ts';
import type { Act } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { useThread } from '../thread/context.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { faceOf, withCardEconomy } from './faces.ts';
import { landing, landingOn } from './land.ts';
import { playOf, reachesOf, type BeyondPost, type CardRules, type CardTarget, type Play } from '../../rules/cards.ts';
import { useRest } from '../glass/prepared.ts';
import { usePlay, type PlayTarget } from './play.tsx';
import { livePlays, stackPlays, usePlays, type Plays } from './plays.ts';
import type { Id } from '../data/api.ts';
import { lowerFirst } from '../copy-words.ts';

/** The post a play lands on, as the hand and the form name it. */
function useTarget(act: Act): PlayTarget | null {
  const { thread, perPage, summary, plays, nameOf, know, reread } = useThread();
  if (act.kind !== 'post' || act.seq === null) return null;
  return { post: act, board: summary.board, title: summary.title, author: act.character === null ? lowerFirst(nameOf(null)) : nameOf(act.character), to: threadHref(thread, pageOf(act.seq, perPage), act.seq), plays, know: know ?? (async () => {}), ...(reread ? { reread } : {}) };
}

/** What the ghost mark is named by its card's play: "Play Whoops! on post 41", "Set Card Collector face down on post 41", "Use Force Field on post 41". */
export function ghostName(card: string, play: Play, seq: number): string {
  return play === 'set' ? `Set ${card} face down on post ${seq}` : play === 'use' ? `Use ${card} on post ${seq}` : `Play ${card} on post ${seq}`;
}

/** The armed card's play control for a post: the dashed "+" mark that ends its strip. */
export function GhostMark({ act }: { readonly act: Act }) {
  const play = usePlay();
  const { hudCharacter, actingCharacters } = usePlayer();
  const { api, instance, settings, ui } = useKayfa();
  const { plays, underOf } = useThread();
  const here = usePlays(plays, act.id);
  const target = useTarget(act);
  const rules = play?.armed == null ? undefined : instance.cards.find((c) => c.key === play.armed);
  /* Rest or focus on the mark reads the post early, so the press that follows opens the form at once (glass/prepared.ts). */
  const rest = useRest(() => { if (play && rules && target) play.readyForm(rules.key, target); });
  if (!play || !hudCharacter || !target || act.seq === null || !rules) return null;
  /* While a compose is open on another post, this post offers nothing: the picked post stands alone. `compose` is the signed-in account's own, so an ended one hides nothing. */
  if (play.compose !== null && play.compose.target.post?.id !== act.id) return null;
  /* A Set and a Use go on a post of the reader's own characters alone: decided on the reader's screen, from their own characters, never sent. */
  const how = playOf(rules);
  const own = actingCharacters.some((c) => c.id === act.character);
  if ((how === 'set' || how === 'use') && !own) return null;
  /* A reply drawn under a post takes no card that replies: asked of the rules with the post it is under, so no ghost mark is drawn for one. */
  const under = underOf?.(act.id);
  const context = { cards: instance.cards, ...(under === undefined ? {} : { under }) };
  /* A Move on one's own post may also be set face down (a ward never blocks that): the mark is offered where either lands, and named for the choice the form keeps. */
  const held = stackPlays(here.plays, api.now());
  const casts = landing(rules, act, held, context).ok;
  const sets = how === 'cast' && own && landing(rules, act, held, { ...context, faceDown: true }).ok;
  if (!casts && !sets) return null;
  const down = sets && (play.faceDown || !casts);
  const cardUi = ui.cards.find((c) => c.key === rules.key);
  const face = faceOf(rules, cardUi, withCardEconomy(instance.settings, settings.cardEconomy), ui.copy.cardKinds);
  /* A card played on the post itself opens no form: its Compose mounts in the post's slot. It is cast face up and never set, so it has one mark. */
  if (cardUi?.Compose) {
    if (!casts) return null;
    return (
      <button
        type="button" className="kb-mark kb-meta-tile kb-ghost-mark" aria-label={ghostName(rules.name, how, act.seq)} data-kb-card={rules.key} data-kb-alignment={rules.alignment}
        aria-pressed={play.compose?.card === rules.key && play.compose.target.post?.id === act.id}
        style={{ '--kb-mark-color': face.art.color } as CSSProperties}
        onClick={() => play.openCompose(rules.key, target)}
      >
        <span className="kb-meta-tile-in" aria-hidden="true">
          {face.art.mark && <img className="kb-mark-icon kb-ghost-icon" src={face.art.mark} alt="" draggable={false} />}
          <span className="kb-mark-plus">+</span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button" className="kb-mark kb-meta-tile kb-ghost-mark" aria-label={ghostName(rules.name, down ? 'set' : how, act.seq)} data-kb-card={rules.key} data-kb-alignment={rules.alignment}
      style={{ '--kb-mark-color': face.art.color } as CSSProperties}
      aria-busy={play.opening(rules.key, target) ? 'true' : undefined}
      onClick={() => { if (how === 'cast' && own) play.choose(down); play.openForm(rules.key, target); }}
      {...rest}
    >
      <span className="kb-meta-tile-in" aria-hidden="true">
        {face.art.mark && <img className="kb-mark-icon kb-ghost-icon" src={face.art.mark} alt="" draggable={false} />}
        <span className="kb-mark-plus">+</span>
      </span>
    </button>
  );
}

/**
 * A target beyond a post as its strip offers it (the card mechanic's design, section 7): the reach and its target, its name as the
 * ghost and the form say it, and what the form links to and reads. A character's is the postbit of one post (`from`), whose thread and
 * board are above it; a thread's head names its board; a board's banner, nothing.
 */
export interface ReachAt {
  readonly reach: BeyondPost;
  readonly target: Id;
  readonly name: string;
  /** The target character's pronouns, for a play on a character (the postbit's person); none for a thread or a board. */
  readonly pronouns?: PronounSet;
  /** The post whose postbit offers it: a character play's Act sits on it. */
  readonly fromPost: Act | null;
  /** The thread and the board above the target, whose live plays its card's rules see. */
  readonly thread: Id | null;
  readonly board: Id | null;
  /** The character who started the thread, where the target is one: a use card goes on a thread its acting character started. */
  readonly starter?: Id | null;
  /** The thread's title, for the form. */
  readonly title: string;
  /** Where the form's link goes: the post, the thread, the board. */
  readonly to: string;
  readonly plays: Plays;
  readonly know: (characters: readonly (Id | null)[]) => Promise<void>;
  /** Where focus goes when the form closes: the post's article, the thread's title, the board's title; the ghost itself may be gone. */
  readonly focusBack: () => HTMLElement | null;
}

/** What a ghost beyond a post is named: "Play Glitter on Spritey", "Use a ward on Spritey". */
export const reachGhostName = (card: string, play: Play, name: string): string => `${play === 'use' ? 'Use' : 'Play'} ${card} on ${name}`;

/**
 * The armed card's play control on a target beyond a post: drawn where the card lists the reach and can land on the target, given the
 * target's live plays and those above it, by the card's own rules (landingOn). A Use on a character goes on one of the reader's own
 * characters alone, decided from the reader's own characters, never sent; a Set never goes beyond a post.
 */
export function ReachGhost({ at }: { readonly at: ReachAt }) {
  const play = usePlay();
  const { hudCharacter, actingCharacters } = usePlayer();
  const { api, instance, settings, ui } = useKayfa();
  const here = usePlays(at.plays, at.target);
  const onThread = usePlays(at.plays, at.thread ?? '');
  const onBoard = usePlays(at.plays, at.board ?? '');
  const rules = play?.armed == null ? undefined : instance.cards.find((c) => c.key === play.armed);
  const rest = useRest(() => { if (play && rules) play.readyForm(rules.key, { post: at.fromPost, reach: { reach: at.reach, target: at.target, name: at.name }, title: at.title, author: at.name, to: at.to, plays: at.plays, know: at.know }); });
  if (!play || !hudCharacter || !rules || !reachesOf(rules).includes(at.reach)) return null;
  /* A compose is open on a post, which is never this target: it offers nothing until the compose ends. */
  if (play.compose !== null) return null;
  const how = playOf(rules);
  if (how === 'set' || how === 'keep') return null;
  if (how === 'use' && at.reach === 'character' && !actingCharacters.some((c) => c.id === at.target)) return null;
  /* A use card is used on a thread the acting character (the HUD's, as the server checks it) started, and never on a board: no ghost where it cannot go. */
  if (how === 'use' && (at.reach === 'board' || (at.reach === 'thread' && (at.starter ?? null) !== hudCharacter.id))) return null;
  const effect = effectOf(instance.cards);
  const above = {
    ...(at.thread ? { thread: livePlays(onThread.plays, api.now()).filter((p) => p.reach === 'thread').map(effect) } : {}),
    ...(at.board ? { board: livePlays(onBoard.plays, api.now()).filter((p) => p.reach === 'board').map(effect) } : {}),
  };
  const goal = { reach: at.reach, [at.reach]: at.target } as unknown as CardTarget;
  if (!landingOn(rules, goal, stackPlays(here.plays, api.now()), { cards: instance.cards, above }).ok) return null;
  const face = faceOf(rules, ui.cards.find((c) => c.key === rules.key), withCardEconomy(instance.settings, settings.cardEconomy), ui.copy.cardKinds);
  const target: PlayTarget = { post: at.fromPost, reach: { reach: at.reach, target: at.target, name: at.name, ...(at.pronouns ? { pronouns: at.pronouns } : {}), above }, title: at.title, author: at.name, to: at.to, plays: at.plays, know: at.know, focusBack: at.focusBack };
  return (
    <button
      type="button" className="kb-mark kb-meta-tile kb-ghost-mark" aria-label={reachGhostName(rules.name, how, at.name)} data-kb-card={rules.key} data-kb-alignment={rules.alignment} data-kb-reach={at.reach}
      style={{ '--kb-mark-color': face.art.color } as CSSProperties}
      aria-busy={play.opening(rules.key, target) ? 'true' : undefined}
      onClick={() => play.openForm(rules.key, target)}
      {...rest}
    >
      <span className="kb-meta-tile-in" aria-hidden="true">
        {face.art.mark && <img className="kb-mark-icon kb-ghost-icon" src={face.art.mark} alt="" draggable={false} />}
        <span className="kb-mark-plus">+</span>
      </span>
    </button>
  );
}

/** A live play above a target as its rules see it: its card, its Act, and what it does while up (a ward or a price, read from its card's rules) and when it ends. */
const effectOf = (cards: readonly CardRules[]) => (p: { readonly id: Id; readonly card: string; readonly ends?: string }) => {
  const gimmick = cards.find((c) => c.key === p.card)?.gimmick;
  return { card: p.card, act: p.id, ...(gimmick ? { gimmick } : {}), ...(p.ends ? { ends: p.ends } : {}) };
};

/**
 * Whether a target beyond a post has a strip to draw: a play on it, or an armed card that reaches it. With neither, its host draws no
 * strip at all, so a postbit, a thread's head and a banner are as they were until a card concerns them (the board matches hold).
 */
export function useReachShown(plays: Plays, target: Id | null, reach: BeyondPost): boolean {
  const { instance } = useKayfa();
  const play = usePlay();
  const here = usePlays(plays, target ?? '');
  if (target === null) return false;
  if (here.plays.some((p) => p.reach === reach)) return true;
  const rules = play?.armed == null ? undefined : instance.cards.find((c) => c.key === play.armed);
  return rules !== undefined && reachesOf(rules).includes(reach);
}
