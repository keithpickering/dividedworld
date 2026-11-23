/**
 * The settlement, as a pure function.
 *
 * `settle(input, instance)` reads one window's Acts and reactions, turns each player's
 * reactions into votes (engine/rules/votes.ts), hands each character's class the Acts it made
 * and received in the window, and returns ledger entries per player and character, each with
 * a reason. The same function, run on the window so far with the shared vote and the halving
 * off, is a player's live estimate in their own log (`estimateForOwner`): there is no second
 * implementation to disagree with it.
 *
 * What a class is given is only what anyone could watch happen: Acts, and reactions as
 * quadrants, times and weights. Who reacted is read here, to hold one player's reactions to
 * one vote and to drop a player's reactions to their own characters, and never passed on.
 *
 * The rules the design leaves to the engine, and how they are read here:
 *
 * - One player, one vote per Act, whenever the reactions come: the vote's weight is fixed by
 *   the halving in the window of the player's first reaction there, and each window pays the
 *   difference between the shares now and those already paid (engine/rules/votes.ts).
 * - A vote after a card counts once per player and alignment, for that player's earliest card
 *   of that alignment on the target, so two Sweet cards pay what one would.
 * - "Early" is a rank: where the reacting player came among the players who reacted to the
 *   Act, by first reaction, with ties ordered by player. The class decides how early is early.
 * - A vote a player holds is given to its class (`held`) in each window in which another player
 *   first reacted to the Act, with how many other players had reacted before the window and by
 *   its end, so a class can pay the window a crowd arrives in, once (the owner's answer 15).
 * - Where a post "ends up", for a player's held vote, is its dominant quadrant by vote share at
 *   this settlement, over every reaction up to the window's end, without that player's own vote,
 *   so nobody's call is proven by itself; a tie is no direction. Reactions after the settlement
 *   do not reach back: a window is settled once.
 * - A Reversal's spring (a set card's) is settled as a play of its card, under the card's alignment,
 *   on the Act that sprang it (`by`): the cast it caught, or the staff Act or visit that tripped it,
 *   which is no character's. A face-down Move's spring is scored on its own post, which is its
 *   setter's, so for no class: the quote that sprang it is in `by` too, but the card the spring lands
 *   on the quoting post is the play there, and the two are one play (#420). A spring with no `by`
 *   (older rows) is scored on its trapped post. A caught play settles as the play it is.
 * - An earn gimmick (a use card whose gimmick is `earn`, or a cast card's), on a character or a post and not ended (an admin-ended play is not in
 *   the input), is a `by` earn or a flat earn, and pays under the reason `card.boost`; a play with no `ends` pays nothing. A cushion play is no earn.
 *   A `by` earn adds `by` times each positive earning of that character's Act that carries a time and a quadrant, falls in the gimmick's window
 *   [at, ends) and is in a quadrant or of a reaction kind it names; each `by` earn boosts on its own, and its entry's params are `{ card, by }`.
 *   A flat earn pays `flat` of a vote for each vote, whatever class the character holds and whatever the class earns for it: for each vote line
 *   (a player's share in one quadrant on one Act, positive or negative, times the halving) in the play's window [at, ends), in a quadrant it names or
 *   where the kind of the voter's first reaction in that quadrant on that Act is one it names, on an Act of the play's character or on the play's
 *   post, of a kind it names in `acts` (with none, on a post: a post or a spin), whose voter first reacted to that Act no earlier than the play.
 *   Of the flat earns that apply to one line the largest pays (a tie: the earliest play, then the smaller play id), as `tidy(flat * vote * votes)` with
 *   `{ card, flat }` in the entry's params. It follows the halving,
 *   where a skim and a ride do not, so a negative line (a vote that moved away) takes its pay back, and only where the voter first reacted while
 *   the play was up. A take-back is priced by the largest flat earn that applies when the line is taken back, not by the play that paid it. A line applies
 *   to a play the same way when it is paid and when it is taken back: a quadrant is the line's, and the voter's first reaction in a quadrant on an Act
 *   is a fact that never changes, since a reaction cannot be removed. So every play that applies at a take-back also applied when the share was paid, and
 *   a flat earn, whether it names quadrants or reaction kinds, never costs the character: its flat boosts as a whole never sum below zero. One play's own
 *   lines can, when a larger play paid and ended and a smaller one still up takes the share back.
 *   An earn may be a cast card's on a character or a post.
 * - The reveal perk: while a character's reveal is current, each positive earning of its class that the class marks `fromReactions` (Earning.fromReactions: a
 *   reaction to the character's own Acts, or its own early call, caused it) and that has a time adds `settings.revealPerk` times itself as `reveal.perk`, with
 *   `{ share }` in the entry's params and no class. A reveal is the time of an `unmask` Act (InputCharacter.reveals); it is current at a time `t` when the latest
 *   reveal `u <= t` has no class row of the character starting in `(u, t]`, so any Turn, announced or silent, ends it from the Turn's time, a new reveal starts it
 *   again, and a reveal made at a Turn's moment is current. It reads the class's own earnings as returned, so a loss, a boost, a cushion and a payout are never
 *   perked, and a perk is never cushioned; with `revealPerk` 0 or no reveal it adds nothing.
 * - A cushion play (a use card whose gimmick is `cushion`), on a character or a post and not ended, with an `ends`, gives back
 *   `share` of a loss from a reaction: each earning of the character's own class that has a time, an Act of that character, a negative amount and
 *   positive `votes` (Earning.votes, the signed votes of the one reaction it pays for, which a class sets where it pays per vote), inside the play's
 *   [at, ends) on the character or on the Act, gets `tidy(-share * amount)` as `card.cushion` with `{ card, share }` in the entry's params, from the
 *   largest `share` that applies (a tie: the earliest play, then the smaller play id). It reads the class's own earnings only, never a boost, a card's
 *   payout or another cushion. So a gain taken back (a negative amount on negative votes) is no loss, a loss taken back (a positive amount) is none
 *   either, and an earning with no `votes` (a cost no reaction caused) is never cushioned, except as a window's loss (second way, below). Each
 *   increase of a loss quadrant's share is a loss line and is cushioned; each decrease is a take-back and is never cushioned again, since the
 *   engine is not handed who voted and cannot tie an earning to its voter's first reaction as a flat earn's vote is. So any later reaction by the
 *   voter that shrinks a cushioned share, in another loss quadrant or in a quadrant that is no loss, leaves cushion behind that no standing loss
 *   matches. The smallest case, measured, is a quarter of a vote for a half cushion, when a cushioned loss's vote later spreads to one more
 *   quadrant, of either kind. The excess grows with each further reaction the voter leaves on the Act, and is bounded by how many one player may
 *   leave there (`settings.reactionCap`), since a reaction cannot be removed: at a cap of 3 a half cushion leaves at most five twelfths of a vote
 *   behind for one voter on one Act (the settlement design, section 3.2). It sits beside a flat earn and neither reads the other.
 *   The second way: an earning a class marks `ofWindow` (Earning.ofWindow) is a loss the window's reactions caused together. Where its amount is
 *   negative and its Act is the character's own, a cushion on the character or on the Act that is up at the window's end (`from <= window.to <
 *   ends`) gives back its share, as it does for a reaction's loss at the reaction's time. Its line has the Act, and a time or a
 *   quadrant only where the earning has one.
 * - A skim play (a cast card with a `skim`, a target post, a `quadrant` and an `ends`) pays its caster's character the skim's share of a vote, as
 *   `card.skim`, for each vote on the target in that quadrant after the play and before `ends` whose voter first reacted to the post after the
 *   play, never the caster's own player's, on a post that is not the caster's own player's. A vote moving out of the quadrant inside the
 *   week is a negative vote there and takes back what it paid, so a play never costs more than it paid.
 * - A ride pays `card.ride` for the votes on a card cast on a post, on the unhalved share of a vote: a ride gimmick (a use card on a post)
 *   pays its user's character its share for each vote, in any quadrant, before it ends, on a cast made while it was up; a ride spring (a
 *   trap whose outcome is a ride) pays its setter's character its share for each vote in the quadrant the set named, or in every quadrant,
 *   where its outcome says `every`, on the cast that sprang it, with no end. Neither pays for a cast by the post's author's player, nor the paid character's own player's votes.
 * - A character in `scoredAs` is given the named class's rules in every stretch of the window, whatever class it holds or Turns to.
 * - A card's payout is a contribution with no class, so it is in no class's season total (`byClass`).
 * - A play an admin reversed before the window's end is not in the input, nor are the votes on it
 *   (settlement_input and estimate_input leave it out), so there is no filter for it here.
 * - A card on a staff post is judged against the post's own reactions (`unscoredTargets`), which
 *   count as for any Act; the post and its reactors are paid nothing for it (#122).
 * - A card "outdraws" its target when it drew more votes in the window than the target did.
 *   A vote total is the shares, unhalved: the halving prices a character's further Acts to the
 *   character, and a card and its target are judged on how many players each drew.
 * - A play is handed how the room took what it is scored against (`targetLean`, `targetReadsAs`): the lean is the positive quadrants' vote shares
 *   minus the negative ones' on that Act, over every reaction up to the window's end, unhalved, without the caster's own player's votes, as `readsAs`
 *   leaves the caster out (a staff post's lean is read from its own reactions; a target nobody reacted to has none, 0). The flavor is, where the
 *   target is itself a card's play, what that play reads as this window: a staff cast's is its card's own alignment, and absent for a Pepperoni
 *   one, which has no room in the input to read it by.
 * - A spun thread's repliers are the distinct other players who posted in it, counted before
 *   the window and by its end, so a class can pay the window in which a threshold is crossed.
 * - A post's debate is every post that quotes it, transitively, and the spin and posts of each thread another
 *   player spun from it, up to the window's end. The walk follows threads spun "from the spark" only: a thread spun
 *   from a post inside the debate is not followed. Only `quotes` and the Acts in the input count (a staff post or one
 *   of The System's is not in the input, so it is no member). A character's class is handed a `SparkedDebate` for
 *   each of its posts made no earlier than `debateDays` before the window with a member inside the window, or with a
 *   member and a vote that moved on it inside the window, or of any age with a nonzero tallied sum (`input.tallied`) and a vote that
 *   moved on it inside the window (a take-back finds its spark; `paid` is the sums by reason): the members as times and voices that name no one (0 the
 *   author's player, then 1, 2... by first post, a character each with the shared vote off), whether the post is
 *   itself in an earlier post's debate by its own player, every other player's vote on it at the stretch's start and
 *   end, and the largest cushion share up on it or its character since it was made. It is handed to every stretch of the window, with
 *   `placed` true in the one its latest member's time (or its latest moved vote's) falls in; a spark costs its debate's size, with quotes indexed once.
 *   A class marks an earning `tally` and `settle` returns its window sums by Act and reason as `tallied`.
 * - A character that Turned inside the window is settled under each class it held, each for
 *   its own stretch; a reaction belongs to the class its target held when it landed.
 * - Crowd pay (`crowdPay`, docs/plans/2026-11-20-crowd-pay-design.md) is each player's flat sum for each Act of another player's that they
 *   first reacted to in the window, up to a cap; it is a wallet's alone, in no entry, no standing and no class's total.
 * - The crowd floor (`crowdFloor`, docs/plans/2026-11-23-crowd-floor-design.md) is `crowdFloor` of a vote for each vote a character's Act received that its class
 *   neither paid nor charged: a received line none of the class's earnings with `votes` (of any sign) names, by act, quadrant, time and kind, and that the class's
 *   `floorOn` accepts (absent: every one). It is `crowd.floor` with no class, so in no class's season total, and it follows the vote as any share does, halved and, where a
 *   vote moved, taken back (a negative line) from the quadrant it left. It is held apart from the class's earnings and pushed after the boost, the reveal perk and the
 *   cushion, so none of them reads it or is read by it; a flat earn pays on top of it. `crowdFloor` 0 pays none.
 * - Input is read in a canonical order and amounts are summed before they are rounded, so the
 *   result is the same whatever order the rows arrive in.
 */
import { payVotes, shareVotes, type PaidVote } from './votes.ts';
import type {
  ActKind, ActStanding, Alignment, ClassInput, ClassRules, GivenReaction, HeldVote, InputAct, InputCharacter, InputReaction, Instance,
  LandedCard, PlayedCard, Quadrant, ReceivedReaction, Settings, SettlementInput, SparkedDebate, SpunThread, Standing, UnscoredTarget,
} from './types.ts';
import { QUADRANTS, isPost } from './types.ts';
import type { GimmickEffect } from './cards.ts';

/** One ledger row: whole hundredths for one player and character, for one reason, in one window. */
export interface LedgerEntry {
  readonly window: string;
  readonly player: string;
  readonly character: string;
  readonly reason: string;
  readonly amount: number;
  /** The numbers its reason's words state, as the earnings it sums were settled under (Earning.params); absent where they name none. */
  readonly params?: Readonly<Record<string, number | string>>;
}

/**
 * What makes an entry one: a player's, character's and reason, and for a boost one card's too, so two Earn cards' boosts are two entries
 * each naming its card. No other reason names a card, so no other class's entries change. A detail line and a share find their entry by it.
 */
export const entryKey = (c: { player: string; character: string; reason: string; params?: Readonly<Record<string, number | string>> }) =>
  `${c.player}\u0000${lineKey(c.character, c.reason, c.params?.card)}`;

/**
 * What makes a line of one player's log: a character, a reason and, where the entry names one, its card. A share finds its line by it, in the
 * settlement (`entryKey`) and on the screens (the log's page), so the two never keep a second key that merely agrees.
 */
export const lineKey = (character: string, reason: string, card?: unknown) =>
  `${character}\u0000${reason}${typeof card === 'string' ? `\u0000${card}` : ''}`;

/** What the owner's log shows of an entry: which Act, which quadrant, how much, in whole hundredths that add up to the entry. */
export interface Detail {
  readonly player: string;
  readonly character: string;
  readonly reason: string;
  /** The card a boost line is for (`{ card }`), where the reason names one; it says which entry the line belongs to (`entryKey`). */
  readonly params?: Readonly<Record<string, number | string>>;
  readonly act?: string;
  readonly quadrant?: Quadrant;
  /** The reactions it pays for, where they are not on `act` (Earning.valuing). */
  readonly valuing?: { readonly act: string; readonly from: number };
  /** The time of the one reaction it pays for (Earning.at). */
  readonly at?: number;
  readonly amount: number;
}

export interface Settlement {
  readonly entries: readonly LedgerEntry[];
  readonly details: readonly Detail[];
  /** Each character's settled total for the window, which its season standing adds. */
  readonly standings: readonly { readonly character: string; readonly amount: number }[];
  /** What each class earned in all, for the season review. */
  readonly byClass: Readonly<Record<string, number>>;
  /** Each vote this window touched, as now paid: stored with the settlement, read by the next. */
  readonly paid: readonly PaidVote[];
  /** The window's sums of the earnings a class marked `tally`, by Act and reason, whole, with 0s left out, in Act then reason order: stored with the settlement, read by the next as `input.tallied`. */
  readonly tallied: readonly { readonly act: string; readonly reason: string; readonly amount: number }[];
  /**
   * Each player's crowd pay for the window (docs/plans/2026-11-20-crowd-pay-design.md): the Acts paid, in the order paid, and the amount.
   * A wallet's alone: in no entry, no standing and no class's total.
   */
  readonly crowd: readonly { readonly player: string; readonly acts: readonly string[]; readonly amount: number }[];
}

/** A reason's shape, as the ledger holds it (supabase/migrations/0003_aura.sql): `class.what`. */
export const REASON = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Whole hundredths, half away from zero, after the floating dust of summing shares is swept. */
const round = (x: number) => { const y = Math.round(Math.abs(x) * 1e6) / 1e6; return Math.sign(x) * Math.round(y) || 0; };
const tidy = (x: number) => Math.round(x * 1e6) / 1e6 || 0;
/** A list of Standings in one order that names no player: by the four quadrant numbers, in QUADRANTS order. */
const byVote = (xs: readonly Standing[]): Standing[] => [...xs].sort((x, y) => { for (const q of QUADRANTS) if (x[q] !== y[q]) return x[q] - y[q]; return 0; });
const byTime = <T extends { at: number; act: string }>(a: T, b: T) => a.at - b.at || cmp(a.act, b.act);

/**
 * Whole hundredths for each part that add up to `target` exactly: each part floored, and what
 * is short shared by largest remainder, ties by key. The details and the shares both round this
 * way, so a line and a share are never rounded two ways.
 */
function apportion(target: number, parts: readonly { readonly key: string; readonly amount: number }[]): number[] {
  const whole = parts.map((l) => Math.floor(l.amount));
  let short = target - whole.reduce((s, w) => s + w, 0);
  const byRemainder = parts.map((l, i) => ({ i, rem: l.amount - Math.floor(l.amount), key: l.key }))
    .sort((a, b) => b.rem - a.rem || cmp(a.key, b.key));
  /* The target is the rounded sum of the parts and each part is floored, so `short` is
     between 0 and the number of parts and no part gets two. Only floating dust across many
     parts could push it a step past either end, and the modulo keeps that bounded too. */
  for (let j = 0; short > 0; j = (j + 1) % byRemainder.length, short--) whole[byRemainder[j]!.i]! += 1;
  for (let j = byRemainder.length - 1; short < 0; j = (j - 1 + byRemainder.length) % byRemainder.length, short++) whole[byRemainder[j]!.i]! -= 1;
  return whole;
}

/**
 * How the settlement counts. Both on is the settlement itself. The live estimate turns both off
 * (estimateForOwner): with the shared vote off, each reaction is a vote of its own, and whatever
 * counts players counts reactions instead (a post's reactors, its lean, a card's later votes) or,
 * for a spun thread's repliers, characters; with the halving off, each Act's votes weigh whole.
 * Then no amount depends on how anyone's reactions group into players.
 */
export interface SettleOptions {
  readonly sharedVote?: boolean;
  readonly halving?: boolean;
}

/**
 * Crowd pay (docs/plans/2026-11-20-crowd-pay-design.md): for each player, a flat sum for each Act of another player's character
 * that the player first reacted to inside the window, up to `crowdPayMost` Acts, the earliest first reactions and then the smaller
 * Act id. It reads only the reacting player's own reactions, and neither their quadrant, kind nor character, and it is no vote's:
 * the shared vote, the halving and `SettleOptions` do not touch it. The Acts it can count are those in `input.acts`, so none of
 * The System's, no unscored staff post and no gift or admin-ended play, which `settlement_input` does not send.
 */
export function crowdPay(input: SettlementInput, settings: Pick<Settings, 'crowdPayEach' | 'crowdPayMost'>): Settlement['crowd'] {
  if (settings.crowdPayEach <= 0) return [];
  const { window } = input;
  const ownerOf = new Map(input.characters.map((c) => [c.id, c.player]));
  const authorOf = new Map<string, string | undefined>();
  for (const a of input.acts) if (a.at < window.to) authorOf.set(a.id, ownerOf.get(a.character));
  /* Each player's earliest reaction on each Act, over every reaction the input holds. */
  const first = new Map<string, Map<string, number>>();
  for (const r of input.reactions) {
    if (!authorOf.has(r.act) || authorOf.get(r.act) === r.player) continue;
    const mine = first.get(r.player) ?? new Map<string, number>();
    const seen = mine.get(r.act);
    if (seen === undefined || r.at < seen) mine.set(r.act, r.at);
    first.set(r.player, mine);
  }
  const rows: { player: string; acts: string[]; amount: number }[] = [];
  for (const [player, mine] of first) {
    const acts = [...mine].filter(([, at]) => at >= window.from && at < window.to)
      .sort((a, b) => a[1] - b[1] || cmp(a[0], b[0])).slice(0, settings.crowdPayMost).map(([act]) => act);
    if (acts.length > 0) rows.push({ player, acts, amount: acts.length * settings.crowdPayEach });
  }
  return rows.sort((a, b) => cmp(a.player, b.player));
}

export function settle(input: SettlementInput, instance: Instance, options: SettleOptions = {}): Settlement {
  const { window } = input;
  const settings = instance.settings;
  const sharedVote = options.sharedVote ?? true;
  const halving = (options.halving ?? true) ? settings.halving : 1;

  /* ---- the instance's vocabulary ---- */
  const quadrantOf = new Map(instance.reactions.map((r) => [r.key, r.quadrant]));
  const classOf = new Map<string, ClassRules>(instance.classes.map((c) => [c.key, c]));
  const alignmentOf = new Map<string, Alignment>(instance.cards.map((c) => [c.key, c.alignment]));
  const earnOf = new Map<string, Extract<GimmickEffect, { kind: 'earn' }>>();
  for (const c of instance.cards) if (c.gimmick?.kind === 'earn') earnOf.set(c.key, c.gimmick);
  const cushionOf = new Map<string, number>();
  for (const c of instance.cards) if (c.gimmick?.kind === 'cushion') cushionOf.set(c.key, c.gimmick.share);
  const skimOf = new Map<string, number>();
  const rideGimmickOf = new Map<string, number>();
  const rideTrapOf = new Map<string, { share: number; every: boolean }>();
  for (const c of instance.cards) {
    if (c.skim) skimOf.set(c.key, c.skim.share);
    if (c.gimmick?.kind === 'ride') rideGimmickOf.set(c.key, c.gimmick.share);
    if (c.trap?.outcome?.kind === 'ride') rideTrapOf.set(c.key, { share: c.trap.outcome.share, every: c.trap.outcome.every === true });
  }
  /* The class a character is scored as for this window, if a play named one: the instance must have it, as for a held class. */
  const scoredAs = new Map<string, string>();
  for (const s of input.scoredAs ?? []) {
    if (!classOf.has(s.class)) throw new Error(`settle: character ${s.character} is scored as class "${s.class}", which the instance does not have`);
    if (scoredAs.has(s.character)) throw new Error(`settle: character ${s.character} is scored as two classes`);
    scoredAs.set(s.character, s.class);
  }

  /* ---- the input, checked and in a canonical order; nothing at or after the window's end ---- */
  const systemActs = new Set(input.systemActs ?? []);
  const unscored = new Map<string, UnscoredTarget>((input.unscoredTargets ?? []).map((t) => [t.id, t]));
  /** A card's play or a trap's spring: each is a play of its card on its target. */
  const isPlay = (a: InputAct) => a.kind === 'card' || a.kind === 'spring';
  const reversals = new Set(instance.cards.filter((c) => c.play === 'set').map((c) => c.key));
  /** The Act a Reversal's spring names as what sprang it (a cast, or a staff Act or visit); nothing for any other play, a face-down Move's spring included. */
  const sprungBy = (a: { kind?: ActKind; card?: string; by?: string }) => (a.kind === 'spring' && a.card !== undefined && reversals.has(a.card) ? a.by : undefined);
  /** What a play is scored against: for a Reversal's spring, what sprang it; for every other play, its target post. */
  const scoredOn = (a: { kind?: ActKind; target?: string; card?: string; by?: string }) => sprungBy(a) ?? a.target;
  const characters = new Map<string, InputCharacter>();
  for (const c of [...input.characters].sort((a, b) => cmp(a.id, b.id))) {
    for (const k of c.classes) if (!classOf.has(k.class)) throw new Error(`settle: character ${c.id} holds class "${k.class}", which the instance does not have`);
    if (new Set(c.classes.map((k) => k.from)).size !== c.classes.length) throw new Error(`settle: character ${c.id} has two classes from the same instant`);
    characters.set(c.id, c);
  }
  const playerOf = (character: string) => {
    const c = characters.get(character);
    if (!c) throw new Error(`settle: character ${character} is not in the input`);
    return c.player;
  };
  const acts = new Map<string, InputAct>();
  for (const a of [...input.acts].filter((a) => a.at < window.to).sort((a, b) => a.at - b.at || cmp(a.id, b.id))) {
    playerOf(a.character);
    if (isPlay(a) && a.at >= window.from && (!a.card || !alignmentOf.has(a.card))) throw new Error(`settle: ${a.kind} Act ${a.id} plays "${a.card}", which the instance does not have`);
    acts.set(a.id, a);
  }
  const actOf = (id: string) => {
    const a = acts.get(id);
    if (!a) throw new Error(`settle: Act ${id} is not in the input`);
    return a;
  };
  const checked = [...input.reactions]
    /* A reaction to one of The System's own Acts (an old tally, the old reveal) is no character's to be
       paid for, and moves nobody's Aura, the reactor's included: no class is given it. */
    .filter((r) => r.at < window.to && !systemActs.has(r.act))
    .sort((a, b) => a.at - b.at || cmp(a.act, b.act) || cmp(a.player, b.player) || cmp(a.character, b.character) || cmp(a.kind, b.kind))
    .map((r) => {
      const quadrant = quadrantOf.get(r.kind) ?? r.quadrant;
      if (!quadrant) throw new Error(`settle: reaction kind "${r.kind}" is not one the instance has`);
      if (playerOf(r.character) !== r.player) throw new Error(`settle: reaction by ${r.character} names a player who does not own it`);
      return { ...r, quadrant };
    });
  /* With the shared vote off, each reaction votes alone: its voter is the reaction, and who
     left it (`owner`) is read only to keep a caster's own votes off their card's count. */
  const voter = <R extends { player: string }>(r: R, i: number) => (sharedVote ? { ...r, owner: r.player } : { ...r, owner: r.player, player: `${r.player}\u0000${i}` });
  const reactions = checked
    .filter((r) => !unscored.has(r.act))
    /* A player's reactions to their own characters are never counted, whichever character left them. */
    .filter((r) => r.player !== playerOf(actOf(r.act).character))
    .map(voter);
  /* The reactions on a staff post a card landed on: counted, as any Act's are, only to judge the card against it.
     Nobody owns the post, so no reaction there is anyone's own. */
  const unscoredReactions = checked.filter((r) => unscored.has(r.act)).map(voter);

  /* ---- votes ---- */
  const shared = shareVotes(reactions);
  const inWindow = (at: number) => at >= window.from && at < window.to;
  const { votes: windowVotes, paid: paidOnActs } = payVotes(reactions, window, sharedVote ? input.paid ?? [] : [], actOf, halving);
  /* A staff post's votes are its own author's alone to halve across: each post stands for an author of its own. */
  const unscoredOf = (id: string) => ({ character: `\u0000staff\u0000${id}`, at: unscored.get(id)!.at });
  const { votes: unscoredVotes, paid: paidOnStaff } = payVotes(unscoredReactions, window, sharedVote ? input.paid ?? [] : [], unscoredOf, halving);
  const paid = [...paidOnActs, ...paidOnStaff];
  const votesOn = new Map<string, number>();
  for (const v of [...windowVotes, ...unscoredVotes]) votesOn.set(v.act, (votesOn.get(v.act) ?? 0) + v.share);

  /* Each Act's reactors by first reaction, each player's shares there and the mask that says
     each, and the Act's lean: one pass over the reactions, which are in time order. */
  const zero = (): Record<Quadrant, number> => ({ excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 });
  const onAct = new Map<string, { first: Map<string, number>; firstKind: Map<string, string>; owner: Map<string, string>; lean: Record<Quadrant, number>; of: Map<string, { shares: Record<Quadrant, number>; voice: Partial<Record<Quadrant, { character: string; at: number }>> }> }>();
  for (const r of shared) {
    const a = onAct.get(r.act) ?? { first: new Map(), firstKind: new Map(), owner: new Map(), lean: zero(), of: new Map() };
    if (!a.first.has(r.player)) { a.first.set(r.player, r.at); a.owner.set(r.player, r.owner); }
    // The kind of each player's first reaction in each quadrant, which never changes, since a reaction cannot be removed.
    const inQuadrant = `${r.player}\u0000${r.quadrant}`;
    if (!a.firstKind.has(inQuadrant)) a.firstKind.set(inQuadrant, r.kind);
    a.lean[r.quadrant] += r.share;
    const p = a.of.get(r.player) ?? { shares: zero(), voice: {} };
    p.shares[r.quadrant] += r.share;
    p.voice[r.quadrant] = { character: r.character, at: r.at };
    a.of.set(r.player, p);
    onAct.set(r.act, a);
  }
  /* Each Act's signed lean, whole and by the player behind each vote: the positive quadrants' shares minus the negative ones', over
     every reaction up to the window's end, a staff post's as any Act's. One pass over the reactions; a play reads its target's. */
  const signed = new Map<string, { total: number; by: Map<string, number> }>();
  for (const r of [...shared, ...shareVotes(unscoredReactions)]) {
    const s = signed.get(r.act) ?? { total: 0, by: new Map() };
    const v = (r.quadrant === 'excitedPositive' || r.quadrant === 'calmPositive' ? 1 : -1) * r.share;
    s.total += v;
    s.by.set(r.owner, (s.by.get(r.owner) ?? 0) + v);
    signed.set(r.act, s);
  }
  const direction = (lean: Record<Quadrant, number>): Quadrant | null => {
    const top = Math.max(...QUADRANTS.map((q) => tidy(lean[q])));
    const leaders = QUADRANTS.filter((q) => tidy(lean[q]) === top);
    return top > 0 && leaders.length === 1 ? leaders[0]! : null;
  };
  /* Each held vote, on each Act another player first reached in the window: per Act, the work
     is its reactors, so a busy post costs its own players and nothing beyond them. Where the
     Act leans is read at the window's end, as every direction here is ("at this settlement"),
     not at the instant the crowd arrived. A quadrant is said by the player's latest mask to
     react there, as a share paid is (votes.ts): which mask speaks is the player's choice. */
  const held = new Map<string, HeldVote[]>();
  for (const [act, a] of onAct) {
    const order = [...a.first].sort((x, y) => x[1] - y[1] || cmp(x[0], y[0]));
    const arrivals = order.filter(([, at]) => inWindow(at));
    if (!arrivals.length) continue;
    const total = order.length;
    const beforeAll = total - arrivals.length;
    /* With the shared vote off, a voter's key is the engine's own, so reactions at one instant share
       a rank (1 + those strictly earlier) rather than being ordered by it. */
    const tiedFrom: number[] = [];
    order.forEach(([, at], i) => tiedFrom.push(i > 0 && order[i - 1]![1] === at ? tiedFrom[i - 1]! : i));
    order.forEach(([player, firstAt], i) => {
      const mine = inWindow(firstAt);
      const othersNow = total - 1;
      const othersBefore = beforeAll - (mine ? 0 : 1);
      if (othersNow === othersBefore) return;
      // The latest other arrival: the last one, or the one before it where the last is this
      // player's own (there is another, since another player arrived). Never a scan per player.
      const last = arrivals.at(-1)!;
      const at = last[0] !== player ? last[1] : arrivals.at(-2)![1];
      const p = a.of.get(player)!;
      const without = zero();
      for (const q of QUADRANTS) without[q] = a.lean[q] - p.shares[q];
      const endsUp = direction(without);
      for (const q of QUADRANTS) {
        // Shares only grow, so a quadrant with none is exactly 0; the share is paid exact (k/n),
        // never tidied, so a third of 7.5 rounds as 2.5 does.
        if (p.shares[q] <= 0) continue;
        const { character, at: reactedAt } = p.voice[q]!;
        const list = held.get(character) ?? [];
        list.push({ act, quadrant: q, at, reactedAt, share: p.shares[q], rank: (sharedVote ? i : tiedFrom[i]!) + 1, othersBefore, othersNow, endsUp });
        held.set(character, list);
      }
    });
  }

  /* ---- each character's stretches of class inside the window ---- */
  const stretchesOf = (c: InputCharacter) => {
    const classes = [...c.classes].sort((a, b) => a.from - b.from);
    const out: { class: string; from: number; to: number }[] = [];
    let current = classes.filter((k) => k.from <= window.from).at(-1);
    let start = window.from;
    for (const k of classes.filter((k) => k.from > window.from && k.from < window.to)) {
      if (current && k.from > start) out.push({ class: current.class, from: start, to: k.from });
      current = k;
      start = k.from;
    }
    if (current) out.push({ class: current.class, from: start, to: window.to });
    /* A character scored as a class keeps each stretch's bounds and takes the named class in all of them, so a Turn inside the window changes nothing. */
    const named = scoredAs.get(c.id);
    return named === undefined ? out : out.map((s) => ({ ...s, class: named }));
  };

  /* ---- what each character did and received, by time; every list indexed once, so the
     work grows with the rows read, not with their product ---- */
  const windowActs = [...acts.values()].filter((a) => inWindow(a.at));
  const group = <T, K>(xs: Iterable<T>, keyOf: (x: T) => K) => {
    const out = new Map<K, T[]>();
    for (const x of xs) { const k = keyOf(x); const list = out.get(k); if (list) list.push(x); else out.set(k, [x]); }
    return out;
  };
  const windowActsBy = group(windowActs, (a) => a.character);
  const windowVotesOn = group([...windowVotes, ...unscoredVotes], (v) => v.act);
  // Counts a spun thread's repliers, not card targets: a spin is deliberately not widened in here (types.ts isPost).
  const postsIn = group([...acts.values()].filter((a) => a.kind === 'post'), (a) => a.thread);
  const received = new Map<string, ReceivedReaction[]>();
  for (const v of windowVotes) {
    const target = actOf(v.act);
    const list = received.get(target.character) ?? [];
    list.push({ act: v.act, actKind: target.kind, quadrant: v.quadrant, at: v.at, actAt: target.at, kind: v.kind, votes: v.votes });
    received.set(target.character, list);
  }
  const given = new Map<string, GivenReaction[]>();
  for (const v of windowVotes) {
    const list = given.get(v.character) ?? [];
    list.push({ act: v.act, quadrant: v.quadrant, at: v.at, share: v.share });
    given.set(v.character, list);
  }
  /* Each Act a vote moved on in the window, with every other player's vote there at the window's start and end: one pass
     over the window's votes and the paid votes (or earlier reactions) of every Act, indexed by Act, whole. The paid votes are
     what earlier windows paid (weight x shares); `payVotes` returned what this window changed, which replaces them. With the shared
     vote off (the estimate) nothing is paid, so each earlier reaction is a voter of its own at a whole vote. */
  const asVote = (weight: number, shares: Readonly<Record<Quadrant, number>>): Standing => ({
    excitedPositive: weight * shares.excitedPositive, excitedNegative: weight * shares.excitedNegative, calmPositive: weight * shares.calmPositive, boredNegative: weight * shares.boredNegative,
  });
  /* Indexed by Act, whole: an Act a vote moved on and a spark whose debate moved both read them (the input holds only those Acts'). */
  const paidBefore = group(sharedVote ? input.paid ?? [] : [], (p) => p.act);
  const reactedBefore = sharedVote ? new Map<string, typeof reactions>() : group(reactions.filter((r) => r.at < window.from), (r) => r.act);
  const paidNow = group(paidOnActs, (p) => p.act);
  const standings = new Map<string, ActStanding[]>();
  /** Each touched Act's votes now, by voter, which the cards below read for the players they drew. */
  const nowOn = new Map<string, Map<string, Standing>>();
  const inOrder = (m: Map<string, Standing>) => byVote([...m.values()]);
  /** Every other player's vote on an Act at the window's start and at its end, by voter. */
  const standingMaps = (act: string) => {
    const author = playerOf(actOf(act).character);
    const before = new Map<string, Standing>();
    for (const p of paidBefore.get(act) ?? []) if (p.player !== author) before.set(p.player, asVote(p.weight, p.shares));
    for (const r of reactedBefore.get(act) ?? []) before.set(r.player, { ...zero(), [r.quadrant]: 1 });
    const now = new Map(before);
    for (const p of paidNow.get(act) ?? []) now.set(p.player, asVote(p.weight, p.shares));
    return { before, now };
  };
  for (const [act, vs] of group(windowVotes, (v) => v.act)) {
    const target = actOf(act);
    const { before, now } = standingMaps(act);
    const list = standings.get(target.character) ?? [];
    list.push({ act, actKind: target.kind, at: vs.reduce((m, v) => Math.max(m, v.at), -Infinity), before: inOrder(before), now: inOrder(now) });
    standings.set(target.character, list);
    nowOn.set(act, now);
  }
  const played = new Map<string, PlayedCard[]>();
  const landed = new Map<string, LandedCard[]>();
  /* Each target's earliest card per player and alignment, an earlier window's included: the card
     every later vote there counts for, per player and not per mask or class, as the plan's Task B
     reads the owner's answer 3. A card whose kind the instance has since retired has no
     alignment, and holds nothing. Built once; the acts are already in time order. */
  /* The alignment each play reads as this window (the Autocorrect design, section 8): a Pepperoni card's by the lean of the
     votes on it here, each a share of one vote, positive quadrants against negative, tidied as every sum is; a tie stays
     Pepperoni. They are the votes `votesOn` counts as the card's draw: other players' and staff's. A player's votes on their own
     Acts are never paid (payVotes), and the owner check below says so again, as `targetAfter`'s does. The room that decides is
     everyone but the two players the card is between (the core loop design, section 2, #170): the caster's player and the target
     post's author's player, so neither tips it with a second mask. A staff post (`unscored`) has no author player, and only the
     caster's is left out. In the live estimate the only owner this can recognize is the caller (estimate_input keys every other
     reaction per mask), so the estimate's lean can differ from the settled one; the settlement is exact. A play from an earlier
     window reads by this window's votes, so one the room has stopped reacting to stays Pepperoni here. */
  const readsAsOf = new Map<string, Alignment>();
  const readsAs = (a: { id: string; character: string; card?: string; kind?: ActKind; target?: string; by?: string }): Alignment => {
    const own = alignmentOf.get(a.card!)!;
    if (own !== 'pepperoni') return own;
    let known = readsAsOf.get(a.id);
    if (known) return known;
    const player = playerOf(a.character);
    /* The target's author, where the input holds the target. An earlier window's play is read here for the holder below, and its
       target can be absent (a staff post an earlier card landed on, or the post of an earlier card that is in the input only because
       it was reacted to): then no window play shares that target, so no window play ever looks its key up, and nothing here may
       throw on it. */
    const scored = scoredOn(a);
    const target = scored === undefined || unscored.has(scored) ? undefined : acts.get(scored);
    const author = target ? playerOf(target.character) : undefined;
    let lean = 0;
    for (const v of windowVotesOn.get(a.id) ?? []) if (v.owner !== player && v.owner !== author) lean += (v.quadrant === 'excitedPositive' || v.quadrant === 'calmPositive' ? 1 : -1) * v.share;
    known = tidy(lean) > 0 ? 'sweet' : tidy(lean) < 0 ? 'salty' : 'pepperoni';
    readsAsOf.set(a.id, known);
    return known;
  };
  const holder = new Map<string, string>();
  for (const c of [...acts.values()].filter((a) => isPlay(a) && a.reach === undefined && a.target && a.card && alignmentOf.has(a.card)).sort((x, y) => x.at - y.at || cmp(x.id, y.id))) {
    const k = `${scoredOn(c)}\u0000${playerOf(c.character)}\u0000${readsAs(c)}`;
    if (!holder.has(k)) holder.set(k, c.id);
  }
  /* The play that holds a target for a player in the crowd it drew: their earliest play there, of any alignment, an
     earlier window's included (`holder` holds one per alignment, which the lift needs). */
  const earliest = new Map<string, string>();
  for (const c of [...acts.values()].filter((a) => isPlay(a) && a.reach === undefined && a.target && a.card && alignmentOf.has(a.card))) {
    const k = `${scoredOn(c)}\u0000${playerOf(c.character)}`;
    if (!earliest.has(k)) earliest.set(k, c.id);
  }
  // A play beyond a post has no target post to outdraw, and lands on no post (the card mechanic's design, section 7): its own
  // reactions reach its caster through `received`, as any Act's do, and no rule here reads it.
  for (const a of windowActs.filter((x) => isPlay(x) && x.reach === undefined)) {
    if (!a.target) throw new Error(`settle: ${a.kind} Act ${a.id} has no target`);
    // A staff post is another's, and nobody's to land on.
    // A Reversal's spring's `by` that is no scored Act (a staff Act, a visit; an unknown one too) is read as a staff target, as `unscoredTargets` are.
    const scored = scoredOn(a)!;
    const target = unscored.has(scored) || (sprungBy(a) !== undefined && !acts.has(scored)) ? { id: scored, character: null } : actOf(scored);
    const player = playerOf(a.character);
    const after: Record<Quadrant, number> = { excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 };
    // Each vote after the card counts once per player and alignment: for the earliest of that
    // player's cards of this alignment on the target (an earlier window's included), so two
    // Sweet cards pay what one would (the owner's answer 3, on #4).
    for (const v of windowVotesOn.get(target.id) ?? []) if (v.at > a.at && v.owner !== player && holder.get(`${target.id}\u0000${player}\u0000${readsAs(a)}`) === a.id) after[v.quadrant] += v.share;
    const alignment = alignmentOf.get(a.card!)!;
    const onOthers = target.character === null || playerOf(target.character) !== player;
    const list = played.get(a.character) ?? [];
    // Sums of share differences, tidied as the leaning is, so float dust never decides an outdraw.
    for (const q of QUADRANTS) after[q] = tidy(after[q]);
    /* The players whose first reaction to the target came after the play, neither the caster's nor the author's (onAct holds
       no reaction of the author's own player), each at their vote now. */
    let drawnAt = -Infinity;
    const drawnNow: Standing[] = [];
    if (earliest.get(`${target.id}\u0000${player}`) === a.id) {
      const votes = nowOn.get(target.id);
      for (const [voterKey, firstAt] of onAct.get(target.id)?.first ?? []) {
        if (firstAt <= a.at || onAct.get(target.id)!.owner.get(voterKey) === player || !votes?.has(voterKey)) continue;
        drawnNow.push(votes.get(voterKey)!);
        drawnAt = Math.max(drawnAt, firstAt);
      }
    }
    const drawnAfter = drawnNow.length ? { at: drawnAt, now: byVote(drawnNow) } : null;
    /* How the room took the target, without the caster's own player's votes; and, where the target is a card's play, what it reads as. */
    const lean = signed.get(target.id);
    const targetLean = tidy((lean?.total ?? 0) - (lean?.by.get(player) ?? 0));
    const targetAct = acts.get(target.id);
    const staffCard = unscored.get(target.id)?.card;
    const staffFlavor = staffCard === undefined ? undefined : alignmentOf.get(staffCard);
    const targetReadsAs = unscored.has(target.id)
      ? (staffFlavor === 'pepperoni' ? undefined : staffFlavor)
      : targetAct && isPlay(targetAct) && targetAct.card && alignmentOf.has(targetAct.card) ? readsAs(targetAct) : undefined;
    list.push({ act: a.id, card: a.card!, alignment, readsAs: readsAs(a), at: a.at, target: target.id, onOthers, votes: tidy(votesOn.get(a.id) ?? 0), targetVotes: tidy(votesOn.get(target.id) ?? 0), targetAfter: after, drawnAfter, targetLean, ...(targetReadsAs ? { targetReadsAs } : {}) });
    played.set(a.character, list);
    if (onOthers && target.character !== null) {
      const on = landed.get(target.character) ?? [];
      on.push({ act: a.id, card: a.card!, alignment, readsAs: readsAs(a), at: a.at, on: target.id });
      landed.set(target.character, on);
    }
  }
  const spun = new Map<string, SpunThread[]>();
  for (const s of [...acts.values()].filter((a) => a.kind === 'spin')) {
    const spinner = playerOf(s.character);
    const firstReply = new Map<string, number>();
    for (const a of postsIn.get(s.thread) ?? []) {
      const p = playerOf(a.character);
      // Repliers are players; with the shared vote off, characters, so masks are never grouped.
      const replier = sharedVote ? p : a.character;
      if (p !== spinner && !firstReply.has(replier)) firstReply.set(replier, a.at);
    }
    const times = [...firstReply.values()].sort((x, y) => x - y);
    const before = times.filter((t) => t < window.from).length;
    const now = times.length;
    if (!(inWindow(s.at) || now > before)) continue;
    const at = now > before ? times[now - 1]! : s.at;
    const fromOthers = s.target !== undefined && (systemActs.has(s.target) || playerOf(actOf(s.target).character) !== spinner);
    const list = spun.get(s.character) ?? [];
    list.push({ act: s.id, thread: s.thread, at, fromOthers, repliersBefore: before, repliersNow: now });
    spun.set(s.character, list);
  }

  /* ---- each class's rules, stretch by stretch ---- */
  type Contribution = Detail & { class?: string; params?: Readonly<Record<string, number | string>>; kind?: string; votes?: number; ofWindow?: true; fromReactions?: true; tally?: true };
  const contributions: Contribution[] = [];
  /* The earn gimmicks up in the input, indexed once by what they are on: a character (a character-reach play) or a post. An admin-ended
     play is not in the input. Each character's pass below reads only its own and its posts' lists, so the pass costs its earnings
     times the gimmicks on that character and the post of each earning, never the instance's gimmicks. */
  type Boost = { card: string; from: number; ends: number; by: number; quadrants: readonly Quadrant[]; reactions: readonly string[] };
  type Flat = { card: string; play: string; from: number; ends: number; flat: number; quadrants: readonly Quadrant[]; reactions: readonly string[]; acts?: readonly ActKind[] };
  const boostsOn = new Map<string, Boost[]>();
  const flatsOn = new Map<string, Flat[]>();
  type Cushion = { card: string; play: string; from: number; ends: number; share: number };
  const cushionsOn = new Map<string, Cushion[]>();
  const push = <T>(m: Map<string, T[]>, key: string, x: T) => { const list = m.get(key); if (list) list.push(x); else m.set(key, [x]); };
  for (const a of acts.values()) {
    const earn = a.kind === 'card' && a.card ? earnOf.get(a.card) : undefined;
    const cushion = a.kind === 'card' && a.card ? cushionOf.get(a.card) : undefined;
    const on = a.reach === 'character' ? a.on : a.reach === undefined ? a.target : undefined;
    if (cushion !== undefined && on !== undefined && a.ends !== undefined) push(cushionsOn, on, { card: a.card!, play: a.id, from: a.at, ends: a.ends, share: cushion });
    // A use card lasts and so does a cast card's earn, so a play of an earn card in effect always has `ends`; a caught play is never in effect and comes without one (0370), and a row without one pays nothing.
    if (!earn || on === undefined || a.ends === undefined) continue;
    const quadrants = earn.quadrants ?? [];
    const reactions = earn.reactions ?? [];
    if ('flat' in earn) push(flatsOn, on, { card: a.card!, play: a.id, from: a.at, ends: a.ends, flat: earn.flat, quadrants, reactions, ...(earn.acts ? { acts: earn.acts } : {}) });
    else push(boostsOn, on, { card: a.card!, from: a.at, ends: a.ends, by: earn.by, quadrants, reactions });
  }
  /* ---- the debate under each post (the Tweener catalyst design, sections 1 and 8) ----
     A post's debate is every post that quotes it, transitively, and the spin and posts of each thread another player spun from it. The
     quote edges and the spins are indexed once, so a spark costs its debate's size: its members are collected by one walk down the
     edges, put in time order, and numbered as voices. Whether a post is in an earlier post's debate by its own player is read from the
     players above it, which each post keeps once (`above`, built in time order), never by walking up for every post. Only an Act in the
     input is a member: a staff post and one of The System's are not in it. */
  const dayMs = settings.debateDays * 86_400_000;
  const actList = [...acts.values()];
  const order = new Map<string, number>(actList.map((a, i) => [a.id, i]));
  const quotedBy = new Map<string, string[]>();
  const quoting = new Map<string, string[]>();
  for (const q of input.quotes ?? []) {
    const a = acts.get(q.act);
    const b = acts.get(q.quoted);
    // A quote names an earlier post: an edge that does not is read as none, so no cycle can be walked.
    if (!a || !b || !isPost(a.kind) || !isPost(b.kind) || order.get(b.id)! >= order.get(a.id)!) continue;
    push(quotedBy, b.id, a.id);
    push(quoting, a.id, b.id);
  }
  const spinsOf = group([...acts.values()].filter((a) => a.kind === 'spin' && a.target !== undefined && acts.has(a.target)), (a) => a.target!);
  const spinOfThread = new Map([...acts.values()].filter((a) => a.kind === 'spin').map((a) => [a.thread, a]));
  /** The players of every post whose debate a post is in by a quote, built in time order from the posts it quotes. */
  const above = new Map<string, ReadonlySet<string>>();
  for (const a of acts.values()) {
    const parents = quoting.get(a.id);
    if (!parents) continue;
    const players = new Set<string>();
    for (const q of parents) { players.add(playerOf(actOf(q).character)); for (const x of above.get(q) ?? []) players.add(x); }
    above.set(a.id, players);
  }
  /** Whether a post is in the debate of an earlier post by its own player: by a quote, or by a thread another player spun from it. */
  const inOwnDebateOf = (a: InputAct) => {
    const me = playerOf(a.character);
    if (above.get(a.id)?.has(me)) return true;
    const spun = a.kind === 'spin' ? a : spinOfThread.get(a.thread);
    const from = spun?.target === undefined ? undefined : acts.get(spun.target);
    return from !== undefined && isPost(from.kind) && playerOf(from.character) === me && playerOf(spun!.character) !== me;
  };
  /* A post with a nonzero tallied sum stays a spark at any age while a vote moves on it in the window, so a take-back finds it. */
  const talliedOn = new Map<string, Record<string, number>>();
  for (const t of input.tallied ?? []) if (t.amount !== 0) talliedOn.set(t.act, { ...talliedOn.get(t.act), [t.reason]: t.amount });
  const sparksBy = group([...acts.values()].filter((a) => a.kind === 'post' && (quotedBy.has(a.id) || spinsOf.has(a.id))
    && (a.at >= window.from - dayMs || (talliedOn.has(a.id) && windowVotesOn.has(a.id)))), (a) => a.character);
  const cushionedOn = (spark: InputAct) => {
    let most = 0;
    for (const g of [...(cushionsOn.get(spark.id) ?? []), ...(cushionsOn.get(spark.character) ?? [])]) if (g.ends > spark.at && g.share > most) most = g.share;
    return most;
  };
  /** A character's sparks whose debate moved in the window, each with the time that places it: its latest member's, or the latest vote that moved on it. */
  const debatesOf = (character: string) => {
    const out: { placed: number; debate: SparkedDebate }[] = [];
    const author = playerOf(character);
    for (const spark of sparksBy.get(character) ?? []) {
      const seen = new Set<string>([spark.id]);
      const members: number[] = [];
      const take = (id: string) => { if (!seen.has(id)) { seen.add(id); members.push(order.get(id)!); } };
      const down = [spark.id];
      for (let id = down.pop(); id !== undefined; id = down.pop()) {
        for (const q of quotedBy.get(id) ?? []) if (!seen.has(q)) { seen.add(q); members.push(order.get(q)!); down.push(q); }
      }
      for (const s of spinsOf.get(spark.id) ?? []) {
        if (playerOf(s.character) === author) continue;
        take(s.id);
        for (const t of postsIn.get(s.thread) ?? []) take(t.id);
      }
      if (!members.length) continue;
      members.sort((x, y) => x - y);
      const voices = new Map<string, number>();
      const posts = members.map((i) => {
        const m = actList[i]!;
        const p = playerOf(m.character);
        const key = sharedVote ? p : m.character;
        let voice = 0;
        if (p !== author) { voice = voices.get(key) ?? voices.size + 1; voices.set(key, voice); }
        return { at: m.at, voice };
      });
      const latest = posts[posts.length - 1]!.at;
      const moved = windowVotesOn.get(spark.id);
      if (!inWindow(latest) && !moved) continue;
      const placed = inWindow(latest) ? latest : moved!.reduce((m, v) => Math.max(m, v.at), -Infinity);
      const { before, now } = standingMaps(spark.id);
      out.push({ placed, debate: { act: spark.id, at: spark.at, posts, inOwnDebate: inOwnDebateOf(spark), standing: { before: inOrder(before), now: inOrder(now) }, cushioned: cushionedOn(spark), paid: talliedOn.get(spark.id) ?? {}, placed: false } });
    }
    return out.sort((x, y) => x.placed - y.placed || cmp(x.debate.act, y.debate.act));
  };
  for (const c of characters.values()) {
    const firstOfCharacter = contributions.length;
    const sparked = debatesOf(c.id);
    /* The crowd floor's lines, held apart from `own` and pushed after the boost, perk and cushion passes. */
    const floor: Contribution[] = [];
    for (const stretch of stretchesOf(c)) {
      const inside = <T extends { at: number }>(xs: readonly T[] | undefined) => (xs ?? []).filter((x) => x.at >= stretch.from && x.at < stretch.to);
      const classInput: ClassInput = {
        character: c.id,
        from: stretch.from,
        to: stretch.to,
        // Posts alone: a card, a spin, a reveal (`unmask`) and an announce are the character's Acts, never its posts.
        // Counts a character's posts, not card targets: a spin is deliberately not widened in here (types.ts isPost).
        posts: inside((windowActsBy.get(c.id) ?? []).filter((a) => a.kind === 'post')).map((a) => ({ act: a.id, at: a.at })),
        received: inside(received.get(c.id)).sort(byTime),
        given: inside(given.get(c.id)).sort(byTime),
        held: inside(held.get(c.id)).sort((x, y) => byTime(x, y) || cmp(x.quadrant, y.quadrant)),
        cardsPlayed: inside(played.get(c.id)).sort(byTime),
        cardsLanded: inside(landed.get(c.id)).sort(byTime),
        threadsSpun: inside(spun.get(c.id)).sort(byTime),
        standings: inside(standings.get(c.id)).sort(byTime),
        debates: sparked.map((d) => ({ ...d.debate, placed: d.placed >= stretch.from && d.placed < stretch.to })),
      };
      const empty = !classInput.posts.length && !classInput.received.length && !classInput.given.length && !classInput.held.length
        && !classInput.cardsPlayed.length && !classInput.cardsLanded.length && !classInput.threadsSpun.length && !classInput.standings.length && !classInput.debates.length;
      if (empty) continue;
      const rules = classOf.get(stretch.class)!;
      const earned = rules.earn(classInput, settings);
      for (const e of earned) {
        if (!Number.isFinite(e.amount)) throw new Error(`settle: class ${stretch.class} returned ${e.amount} for ${e.reason}`);
        if (e.tally && e.act === undefined) throw new Error(`settle: class ${stretch.class} tallied ${e.reason} with no act`);
        if (!REASON.test(e.reason)) throw new Error(`settle: class ${stretch.class} returned the reason "${e.reason}", which is not dot-separated words, each starting lowercase`);
        contributions.push({ player: c.player, character: c.id, class: stretch.class, reason: e.reason, amount: e.amount, ...(e.params ? { params: e.params } : {}), ...(e.act ? { act: e.act } : {}), ...(e.quadrant ? { quadrant: e.quadrant } : {}), ...(e.valuing ? { valuing: e.valuing } : {}), ...(e.at !== undefined ? { at: e.at } : {}), ...(e.kind !== undefined ? { kind: e.kind } : {}), ...(e.votes !== undefined ? { votes: e.votes } : {}), ...(e.ofWindow ? { ofWindow: true as const } : {}), ...(e.fromReactions ? { fromReactions: true as const } : {}), ...(e.tally ? { tally: true as const } : {}) });
      }
      /* The crowd floor: a vote the class neither paid nor charged (no earning with `votes`, of any sign, has its act, quadrant, time and kind) pays
         `crowdFloor` of a vote, as `crowd.floor` with no class. A moved vote's negative line takes its floor back as it took its pay. */
      if (settings.crowdFloor > 0) {
        const keyOf = (x: { act?: string; quadrant?: Quadrant; at?: number; kind?: string }) => `${x.act}|${x.quadrant}|${x.at}|${x.kind}`;
        const shielded = new Set(earned.filter((e) => e.votes !== undefined).map(keyOf));
        for (const r of classInput.received) {
          if (shielded.has(keyOf(r)) || (rules.floorOn && !rules.floorOn(r))) continue;
          const amount = tidy(settings.crowdFloor * r.votes);
          if (amount) floor.push({ player: c.player, character: c.id, reason: 'crowd.floor', amount, act: r.act, quadrant: r.quadrant, at: r.at, kind: r.kind, votes: r.votes });
        }
      }
    }
    /* Earn by a percentage: each positive earning of the character's own Act, with a time and a quadrant, inside a gimmick's window and in what it
       names, adds `by` times itself under the reason `card.boost`, each gimmick on its own. Boosts are added after, so none is boosted in turn. */
    const own = contributions.slice(firstOfCharacter);
    for (const e of boostsOn.size ? own : []) {
      if (!(e.amount > 0) || e.at === undefined || !e.quadrant || e.act === undefined || acts.get(e.act)?.character !== c.id) continue;
      const applicable = [...(boostsOn.get(c.id) ?? []), ...(boostsOn.get(e.act) ?? [])].filter((g) => e.at! >= g.from && e.at! < g.ends && (g.quadrants.includes(e.quadrant!) || (e.kind !== undefined && g.reactions.includes(e.kind))));
      for (const g of applicable) {
        const boost = tidy(e.amount * g.by);
        if (!boost) continue;
        contributions.push({ player: e.player, character: e.character, class: e.class, reason: 'card.boost', amount: boost, params: { card: g.card, by: g.by }, act: e.act, quadrant: e.quadrant, at: e.at });
      }
    }
    /* The reveal perk: each positive earning the class marks `fromReactions`, of the character's own Act and at a time its reveal is current, adds
       `revealPerk` times itself as `reveal.perk`, with no class. Current at `t`: a reveal at `u <= t` (the latest such) and no class row starting in
       (u, t], so a Turn ends it and a reveal made at the Turn's moment is current. Read from `own` and pushed after the boosts, so a boost, a cushion
       or a payout is never perked, and a perk is never boosted or cushioned. */
    if (settings.revealPerk > 0 && c.reveals?.length) {
      const reveals = [...c.reveals].sort((x, y) => x - y);
      const turns = c.classes.map((k) => k.from);
      const current = (t: number) => {
        let u = -Infinity;
        for (const r of reveals) if (r <= t) u = r;
        return u !== -Infinity && !turns.some((f) => f > u && f <= t);
      };
      for (const e of own) {
        if (!e.fromReactions || !(e.amount > 0) || e.at === undefined || !current(e.at)) continue;
        const perk = tidy(e.amount * settings.revealPerk);
        if (!perk) continue;
        contributions.push({ player: e.player, character: e.character, reason: 'reveal.perk', amount: perk, params: { share: settings.revealPerk }, ...(e.act ? { act: e.act } : {}), ...(e.quadrant ? { quadrant: e.quadrant } : {}), at: e.at });
      }
    }
    /* A cushion: a loss of the character's own Act, inside a cushion's window on the character or on the Act, gives back the largest share that
       applies, as `card.cushion`. Two kinds of loss: a loss from a reaction (a time, a negative amount, positive votes), taken at the reaction's
       time, and a window's loss (`ofWindow`, a negative amount), taken as the window settles, at its end. Read from `own`, the class's earnings
       before any boost was pushed, so a boost or another card's payout is never cushioned, and the entry has no class. */
    for (const e of cushionsOn.size ? own : []) {
      if (!(e.amount < 0) || e.act === undefined || acts.get(e.act)?.character !== c.id) continue;
      /* The moment the loss was taken: a reaction's own time, or for a window's loss the window's end, when it is charged. */
      const when = e.votes! > 0 && e.at !== undefined ? e.at : e.ofWindow ? window.to : undefined;
      if (when === undefined) continue;
      let best: Cushion | undefined;
      for (const g of [...(cushionsOn.get(c.id) ?? []), ...(cushionsOn.get(e.act) ?? [])]) {
        if (!(when >= g.from && when < g.ends)) continue;
        if (!best || g.share > best.share || (g.share === best.share && (g.from < best.from || (g.from === best.from && g.play < best.play)))) best = g;
      }
      if (!best) continue;
      const back = tidy(-best.share * e.amount);
      if (!back) continue;
      contributions.push({ player: e.player, character: e.character, reason: 'card.cushion', amount: back, params: { card: best.card, share: best.share }, act: e.act, ...(e.quadrant ? { quadrant: e.quadrant } : {}), ...(e.at !== undefined ? { at: e.at } : {}) });
    }
    contributions.push(...floor);
  }

  /* ---- card payouts: contributions with no class, for votes on a post or a cast ----
     Each vote is read at its unhalved share (`v.share`), as a card's lift is: the halving prices a character's own Acts. A payout names its
     card, so a character's payouts of two cards are two entries, and the Act, quadrant and time of the vote it pays for. */
  const payout = (reason: string, card: string, to: string, share: number, v: { act: string; quadrant: Quadrant; at: number; share: number }) => {
    const amount = tidy(share * settings.vote * v.share);
    if (amount) contributions.push({ player: playerOf(to), character: to, reason, amount, params: { card }, act: v.act, quadrant: v.quadrant, at: v.at });
  };
  /* Skim: a card Act whose card skims, on a post that is in the input (a staff post is not) and not its caster's own player's. */
  for (const a of acts.values()) {
    const share = a.kind === 'card' && a.card ? skimOf.get(a.card) : undefined;
    if (share === undefined || a.reach !== undefined || a.target === undefined || a.quadrant === undefined || a.ends === undefined) continue;
    const target = acts.get(a.target);
    const caster = playerOf(a.character);
    if (!target || playerOf(target.character) === caster) continue;
    const first = onAct.get(a.target)?.first;
    for (const v of windowVotesOn.get(a.target) ?? []) {
      if (v.quadrant !== a.quadrant || !(v.at > a.at && v.at < a.ends) || v.owner === caster || !((first?.get(v.player) ?? -Infinity) > a.at)) continue;
      payout('card.skim', a.card!, a.character, share, v);
    }
  }
  /* Ride: the gimmicks up and the springs that rode, each indexed once, by the post and by the cast they are on. */
  const gimmicksOn = new Map<string, { id: string; card: string; user: string; at: number; ends: number; share: number }[]>();
  const springsBy = new Map<string, { card: string; setter: string; quadrant?: Quadrant; share: number }[]>();
  for (const a of acts.values()) {
    if (a.kind === 'card' && a.card && a.reach === undefined && a.target !== undefined && a.ends !== undefined && rideGimmickOf.has(a.card)) {
      const list = gimmicksOn.get(a.target) ?? [];
      list.push({ id: a.id, card: a.card, user: a.character, at: a.at, ends: a.ends, share: rideGimmickOf.get(a.card)! });
      gimmicksOn.set(a.target, list);
    } else if (a.kind === 'spring' && a.card && a.by !== undefined && rideTrapOf.has(a.card)) {
      const trap = rideTrapOf.get(a.card)!;
      if (!trap.every && a.quadrant === undefined) continue;
      const list = springsBy.get(a.by) ?? [];
      list.push({ card: a.card, setter: a.character, ...(trap.every ? {} : { quadrant: a.quadrant }), share: trap.share });
      springsBy.set(a.by, list);
    }
  }
  for (const cast of acts.values()) {
    const votes = windowVotesOn.get(cast.id);
    if (!votes || cast.kind !== 'card' || cast.reach !== undefined || cast.target === undefined) continue;
    const post = acts.get(cast.target);
    if (!post || playerOf(post.character) === playerOf(cast.character)) continue;
    // A gimmick is no cast of its own to ride, and rides only a cast made while it was up.
    const up = (gimmicksOn.get(cast.target) ?? []).filter((g) => g.id !== cast.id && g.at <= cast.at && cast.at < g.ends);
    for (const g of up) for (const v of votes) if (v.at < g.ends && v.owner !== playerOf(g.user)) payout('card.ride', g.card, g.user, g.share, v);
    for (const s of springsBy.get(cast.id) ?? []) for (const v of votes) if ((s.quadrant === undefined || v.quadrant === s.quadrant) && v.owner !== playerOf(s.setter)) payout('card.ride', s.card, s.setter, s.share, v);
  }

  /* Flat earns: one pass over the window's votes, each read against the flat plays on its Act's character and on the Act, indexed once above, so
     the work grows with the votes and the plays on each. A vote line is `votes` of a vote (halved, and negative where a vote moved away). The
     largest `flat` among the plays that apply pays, a take-back as much as a pay, so a negative line is priced by the play that applies now, not
     by the play that paid. A play pays only for a voter who first reacted to the Act no earlier than the play. A line applies to a play that names
     quadrants by its quadrant and to one that names reaction kinds by the kind of the voter's first reaction in that quadrant on the Act, which never
     changes, so every play applying at a take-back applied at the pay, and the character's flat boosts never sum below zero, though a smaller play
     still up can take back more than it paid after a larger one has ended. */
  if (flatsOn.size) {
    for (const v of windowVotes) {
      const t = actOf(v.act);
      const on = onAct.get(v.act)!;
      const first = on.first.get(v.player)!;
      const firstKind = on.firstKind.get(`${v.player}\u0000${v.quadrant}`)!;
      let best: Flat | undefined;
      for (const list of [flatsOn.get(t.character), flatsOn.get(v.act)]) {
        for (const g of list ?? []) {
          if (!(v.at >= g.from && v.at < g.ends) || first < g.from) continue;
          if (!(g.quadrants.includes(v.quadrant) || g.reactions.includes(firstKind))) continue;
          if (!(g.acts ? g.acts.includes(t.kind!) : isPost(t.kind!))) continue;
          if (!best || g.flat > best.flat || (g.flat === best.flat && (g.from < best.from || (g.from === best.from && g.play < best.play)))) best = g;
        }
      }
      if (!best) continue;
      const amount = tidy(best.flat * settings.vote * v.votes);
      if (amount) contributions.push({ player: playerOf(t.character), character: t.character, reason: 'card.boost', amount, params: { card: best.card, flat: best.flat }, act: v.act, quadrant: v.quadrant, at: v.at });
    }
  }

  /* ---- summed, then rounded ---- */
  const sum = <K extends string>(keyOf: (c: Contribution) => K) => {
    const out = new Map<K, { first: Contribution; amount: number }>();
    for (const c of contributions) {
      const k = keyOf(c);
      const s = out.get(k);
      if (s) s.amount += c.amount; else out.set(k, { first: c, amount: c.amount });
    }
    return [...out.entries()].sort((a, b) => cmp(a[0], b[0]));
  };
  const entries: LedgerEntry[] = sum(entryKey)
    /* An entry's numbers are its first earning's: one window settles under one set of settings, so its earnings of one reason agree. */
    .map(([, { first, amount }]) => ({ window: window.id, player: first.player, character: first.character, reason: first.reason, amount: round(amount), ...(first.params ? { params: first.params } : {}) }))
    .filter((e) => e.amount !== 0);
  /* Each entry's detail, in whole hundredths that add up to the entry exactly: the log names
     which Act moved how much, and its lines never disagree with the ledger ("The fiction may
     lie; the log never does"). The rounding is shared by largest remainder, ties by key. A line
     is one Act, quadrant and reaction time, so two reactions' lines never merge (Earning.at). */
  const lines = sum((c) => `${entryKey(c)}\u0000${c.act ?? ''}\u0000${c.quadrant ?? ''}\u0000${c.at ?? ''}`);
  const linesOf = new Map<string, { key: string; first: Contribution; amount: number }[]>();
  for (const [key, { first, amount }] of lines) {
    const k = entryKey(first);
    const list = linesOf.get(k) ?? [];
    list.push({ key, first, amount: tidy(amount) });
    linesOf.set(k, list);
  }
  const details: Detail[] = [];
  const entryAmount = new Map(entries.map((e) => [entryKey(e), e.amount]));
  for (const [k, list] of [...linesOf].sort((a, b) => cmp(a[0], b[0]))) {
    const whole = apportion(entryAmount.get(k) ?? 0, list);
    list.forEach((l, i) => {
      if (whole[i] === 0) return;
      details.push({
        player: l.first.player, character: l.first.character, reason: l.first.reason, ...(typeof l.first.params?.card === 'string' ? { params: { card: l.first.params.card } } : {}),
        ...(l.first.act ? { act: l.first.act } : {}), ...(l.first.quadrant ? { quadrant: l.first.quadrant } : {}), ...(l.first.valuing ? { valuing: l.first.valuing } : {}), ...(l.first.at !== undefined ? { at: l.first.at } : {}), amount: whole[i]!,
      });
    });
  }
  /* The window's tallied sums by Act and reason, whole as an entry is, 0s left out. */
  const tallied = [...sum((c) => (c.tally ? `${c.act ?? ''}\u0000${c.reason}` : ''))]
    .filter(([k]) => k !== '')
    .map(([, { first, amount }]) => ({ act: first.act ?? '', reason: first.reason, amount: round(amount) }))
    .filter((t) => t.amount !== 0);
  const standing = new Map<string, number>();
  for (const e of entries) standing.set(e.character, (standing.get(e.character) ?? 0) + e.amount);
  const byClass: Record<string, number> = {};
  /* Only a class's own earnings are its season's: a card's payout has no class. */
  for (const [k, { amount }] of sum((c) => c.class ?? '')) if (k !== '') byClass[k] = round(amount);
  return {
    entries,
    details,
    standings: [...standing].sort((a, b) => cmp(a[0], b[0])).map(([character, amount]) => ({ character, amount })),
    byClass,
    paid,
    tallied,
    crowd: crowdPay(input, settings),
  };
}

/** One post's share of a ledger entry, in whole hundredths: the shares of an entry add up to it. */
export interface Share {
  readonly player: string;
  readonly character: string;
  readonly reason: string;
  readonly params?: Readonly<Record<string, number | string>>;
  readonly act: string;
  readonly quadrant?: Quadrant;
  readonly amount: number;
}

/**
 * Each entry split across the posts the live estimate valued for it (the log shares design,
 * sections 1 and 3): the settlement run once more over the window with the shared vote and the
 * halving off, as estimateForOwner runs it, its lines summed by Act and quadrant, and the entry's
 * exact amount split across those of the entry's sign in proportion to their size. A card's lift
 * is weighed on the card's own Act. The shares of an entry add up to it exactly, by the details'
 * rounding (apportion). An entry whose estimate holds no weight of its sign has no shares, nor
 * one whose estimate holds some of that weight on no Act, which no post could be shown as
 * earning; the log says such an entry was scored over the whole window. A share of 0 is none.
 *
 * So a share says nothing past the entry, already shown, and the estimate the player watched
 * live: no share moves with how reactions group into players, and where the estimate and the
 * settlement disagree about which post (a count of distinct players), the post is the estimate's.
 */
export function shareEntries(input: SettlementInput, instance: Instance, entries: readonly LedgerEntry[]): Share[] {
  const estimate = settle(input, instance, { sharedVote: false, halving: false });
  const weights = new Map<string, Map<string, { act: string; quadrant?: Quadrant; amount: number }>>();
  const unplaced = new Map<string, { up: boolean; down: boolean }>();
  for (const d of estimate.details) {
    const k = entryKey(d);
    if (!d.act) {
      const u = unplaced.get(k) ?? { up: false, down: false };
      if (d.amount > 0) u.up = true; else u.down = true;
      unplaced.set(k, u);
      continue;
    }
    const byPost = weights.get(k) ?? new Map();
    const key = `${d.act}\u0000${d.quadrant ?? ''}`;
    const w = byPost.get(key) ?? { act: d.act, ...(d.quadrant ? { quadrant: d.quadrant } : {}), amount: 0 };
    w.amount += d.amount;
    byPost.set(key, w);
    weights.set(k, byPost);
  }
  const shares: Share[] = [];
  for (const e of [...entries].sort((a, b) => cmp(a.player, b.player) || cmp(a.character, b.character) || cmp(a.reason, b.reason))) {
    const sign = Math.sign(e.amount);
    const k = entryKey(e);
    // Weight of the entry's sign on no Act: the split would hand its part to the posts, so the entry is scored over the window.
    if (sign > 0 ? unplaced.get(k)?.up : unplaced.get(k)?.down) continue;
    const posts = [...(weights.get(k) ?? [])]
      .filter(([, w]) => Math.sign(w.amount) === sign && sign !== 0)
      .sort((a, b) => cmp(a[0], b[0]));
    const total = posts.reduce((s, [, w]) => s + Math.abs(w.amount), 0);
    if (!total) continue;
    const whole = apportion(e.amount, posts.map(([key, w]) => ({ key, amount: tidy(e.amount * Math.abs(w.amount) / total) })));
    posts.forEach(([, w], i) => {
      if (whole[i] === 0) return;
      shares.push({ player: e.player, character: e.character, reason: e.reason, ...(typeof e.params?.card === 'string' ? { params: { card: e.params.card } } : {}), act: w.act, ...(w.quadrant ? { quadrant: w.quadrant } : {}), amount: whole[i]! });
    });
  }
  return shares;
}

/**
 * A player's wallet after a settlement's entries: the floor of zero and the cap, and what each
 * cut off. The entries themselves are never trimmed; the standing keeps all of them.
 */
export function applyCap(balance: number, entries: readonly { readonly amount: number }[], cap: number) {
  const raw = balance + entries.reduce((s, e) => s + e.amount, 0);
  const next = Math.min(cap, Math.max(0, raw));
  return { balance: next, change: next - balance, overflow: Math.max(0, raw - cap), floored: Math.max(0, -raw) };
}

/** One line of a player's live estimate: what one character earned for one reason, and from what. */
export interface EstimateLine {
  readonly character: string;
  readonly reason: string;
  /** The card a boost line is for, where the reason names one. */
  readonly params?: Readonly<Record<string, number | string>>;
  readonly act?: string;
  readonly quadrant?: Quadrant;
  /** When the reaction it values landed, for a line that values one reaction. */
  readonly at?: number;
  readonly amount: number;
}

/**
 * A player's live estimate of the open window (the screens' design, section 7; the clues design,
 * section 3): the settlement with the shared vote and the halving off, for the player's own
 * characters only. Each reaction is valued as a whole vote alone ("up to +0.10, before the shared
 * vote and halving"), so no amount says two reactions were one player's, or that a reactor reacted
 * elsewhere; the settlement is exact. Each line is exact, never apportioned, and names a time and
 * an amount, never who reacted:
 *
 * - a line the class paid for one reaction (Earning.at) is that reaction's, at its time, whole;
 * - a line that values reactions on another Act (a card's lift, Earning.valuing) is one line per
 *   vote settle counts there after that time, each a whole vote alike, so an even split is each
 *   vote's own amount;
 * - any other is one line with no time.
 *
 * `crowd` is the caller's row of `crowdPay` over the same input, or null: the crowd pay so far, exact for the caller.
 *
 * The lines add up to the entries. Run on the server, from estimate_input()
 * (supabase/migrations/0017_estimate.sql), which reads only what this player's estimate needs.
 */
export function estimateForOwner(input: SettlementInput, instance: Instance, player: string): { entries: { character: string; reason: string; amount: number; params?: Readonly<Record<string, number | string>> }[]; lines: EstimateLine[]; crowd: { acts: string[]; amount: number } | null } {
  const s = settle(input, instance, { sharedVote: false, halving: false });
  const mine = new Set(input.characters.filter((c) => c.player === player).map((c) => c.id));
  const playerOf = new Map(input.characters.map((c) => [c.id, c.player]));
  const authorOf = new Map(input.acts.map((a) => [a.id, a.character]));
  const quadrantOf = new Map(instance.reactions.map((r) => [r.key, r.quadrant]));
  const inWindow = (at: number) => at >= input.window.from && at < input.window.to;
  const lines: EstimateLine[] = [];
  for (const d of s.details.filter((x) => x.player === player)) {
    const { player: _who, valuing, ...line } = d;
    if (!valuing) { lines.push(line); continue; }
    // The votes the lift counts: on the Act it values, after the time it names, neither the
    // caller's nor the Act's author's, as settle counts them.
    const author = playerOf.get(authorOf.get(valuing.act) ?? '');
    const times = input.reactions
      .filter((r) => r.act === valuing.act && (quadrantOf.get(r.kind) ?? r.quadrant) === d.quadrant && inWindow(r.at) && r.at > valuing.from && r.player !== player && r.player !== author)
      .map((r) => r.at).sort((x, y) => x - y);
    if (!times.length) { lines.push(line); continue; }
    // Whole hundredths that add up to the line: the remainder to the earliest.
    const each = Math.trunc(d.amount / times.length);
    let rest = d.amount - each * times.length;
    for (const at of times) {
      const step = rest === 0 ? 0 : Math.sign(rest);
      rest -= step;
      lines.push({ ...line, at, amount: each + step });
    }
  }
  // The crowd pay so far: the caller's own row of the window's, which is the open one when this runs on estimate_input.
  const row = s.crowd.find((c) => c.player === player);
  const crowd = row ? { acts: [...row.acts], amount: row.amount } : null;
  return { crowd, entries: s.entries.filter((e) => e.player === player).map(({ character, reason, amount, params }) => ({ character, reason, amount, ...(typeof params?.card === 'string' ? { params: { card: params.card } } : {}) })), lines: lines.filter((l) => l.amount !== 0) };
}
