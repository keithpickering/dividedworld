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
 * - A card "outdraws" its target when it drew more votes in the window than the target did.
 *   A vote total is the shares, unhalved: the halving prices a character's further Acts to the
 *   character, and a card and its target are judged on how many players each drew.
 * - A spun thread's repliers are the distinct other players who posted in it, counted before
 *   the window and by its end, so a class can pay the window in which a threshold is crossed.
 * - A character that Turned inside the window is settled under each class it held, each for
 *   its own stretch; a reaction belongs to the class its target held when it landed.
 * - Input is read in a canonical order and amounts are summed before they are rounded, so the
 *   result is the same whatever order the rows arrive in.
 */
import { payVotes, shareVotes, type PaidVote } from './votes.ts';
import type {
  Alignment, ClassInput, ClassRules, GivenReaction, HeldVote, InputAct, InputCharacter, InputReaction, Instance,
  LandedCard, PlayedCard, Quadrant, ReceivedReaction, SettlementInput, SpunThread,
} from './types.ts';
import { QUADRANTS } from './types.ts';

/** One ledger row: whole hundredths for one player and character, for one reason, in one window. */
export interface LedgerEntry {
  readonly window: string;
  readonly player: string;
  readonly character: string;
  readonly reason: string;
  readonly amount: number;
}

/** What the owner's log shows of an entry: which Act, which quadrant, how much, in whole hundredths that add up to the entry. */
export interface Detail {
  readonly player: string;
  readonly character: string;
  readonly reason: string;
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
}

/** A reason's shape, as the ledger holds it (supabase/migrations/0003_aura.sql): `class.what`. */
export const REASON = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Whole hundredths, half away from zero, after the floating dust of summing shares is swept. */
const round = (x: number) => { const y = Math.round(Math.abs(x) * 1e6) / 1e6; return Math.sign(x) * Math.round(y) || 0; };
const tidy = (x: number) => Math.round(x * 1e6) / 1e6 || 0;
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

export function settle(input: SettlementInput, instance: Instance, options: SettleOptions = {}): Settlement {
  const { window } = input;
  const settings = instance.settings;
  const sharedVote = options.sharedVote ?? true;
  const halving = (options.halving ?? true) ? settings.halving : 1;

  /* ---- the instance's vocabulary ---- */
  const quadrantOf = new Map(instance.reactions.map((r) => [r.key, r.quadrant]));
  const classOf = new Map<string, ClassRules>(instance.classes.map((c) => [c.key, c]));
  const alignmentOf = new Map<string, Alignment>(instance.cards.map((c) => [c.key, c.alignment]));

  /* ---- the input, checked and in a canonical order; nothing at or after the window's end ---- */
  const systemActs = new Set(input.systemActs ?? []);
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
    if (a.kind === 'card' && a.at >= window.from && (!a.card || !alignmentOf.has(a.card))) throw new Error(`settle: card Act ${a.id} plays "${a.card}", which the instance does not have`);
    acts.set(a.id, a);
  }
  const actOf = (id: string) => {
    const a = acts.get(id);
    if (!a) throw new Error(`settle: Act ${id} is not in the input`);
    return a;
  };
  const reactions = [...input.reactions]
    /* A reaction to one of The System's own Acts (a tally, the reveal) is no character's to be
       paid for, and moves nobody's Aura, the reactor's included: no class is given it. */
    .filter((r) => r.at < window.to && !systemActs.has(r.act))
    .sort((a, b) => a.at - b.at || cmp(a.act, b.act) || cmp(a.player, b.player) || cmp(a.character, b.character) || cmp(a.kind, b.kind))
    .map((r) => {
      const quadrant = quadrantOf.get(r.kind);
      if (!quadrant) throw new Error(`settle: reaction kind "${r.kind}" is not one the instance has`);
      if (playerOf(r.character) !== r.player) throw new Error(`settle: reaction by ${r.character} names a player who does not own it`);
      return { ...r, quadrant };
    })
    /* A player's reactions to their own characters are never counted, whichever character left them. */
    .filter((r) => r.player !== playerOf(actOf(r.act).character))
    /* With the shared vote off, each reaction votes alone: its voter is the reaction, and who
       left it (`owner`) is read only to keep a caster's own votes off their card's count. */
    .map((r, i) => (sharedVote ? { ...r, owner: r.player } : { ...r, owner: r.player, player: `${r.player}\u0000${i}` }));

  /* ---- votes ---- */
  const shared = shareVotes(reactions);
  const inWindow = (at: number) => at >= window.from && at < window.to;
  const { votes: windowVotes, paid } = payVotes(reactions, window, sharedVote ? input.paid ?? [] : [], actOf, halving);
  const votesOn = new Map<string, number>();
  for (const v of windowVotes) votesOn.set(v.act, (votesOn.get(v.act) ?? 0) + v.share);

  /* Each Act's reactors by first reaction, each player's shares there and the mask that says
     each, and the Act's lean: one pass over the reactions, which are in time order. */
  const zero = (): Record<Quadrant, number> => ({ excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 });
  const onAct = new Map<string, { first: Map<string, number>; lean: Record<Quadrant, number>; of: Map<string, { shares: Record<Quadrant, number>; voice: Partial<Record<Quadrant, { character: string; at: number }>> }> }>();
  for (const r of shared) {
    const a = onAct.get(r.act) ?? { first: new Map(), lean: zero(), of: new Map() };
    if (!a.first.has(r.player)) a.first.set(r.player, r.at);
    a.lean[r.quadrant] += r.share;
    const p = a.of.get(r.player) ?? { shares: zero(), voice: {} };
    p.shares[r.quadrant] += r.share;
    p.voice[r.quadrant] = { character: r.character, at: r.at };
    a.of.set(r.player, p);
    onAct.set(r.act, a);
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
    return out;
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
  const windowVotesOn = group(windowVotes, (v) => v.act);
  const postsIn = group([...acts.values()].filter((a) => a.kind === 'post'), (a) => a.thread);
  const received = new Map<string, ReceivedReaction[]>();
  for (const v of windowVotes) {
    const target = actOf(v.act);
    const list = received.get(target.character) ?? [];
    list.push({ act: v.act, actKind: target.kind, quadrant: v.quadrant, at: v.at, votes: v.votes });
    received.set(target.character, list);
  }
  const given = new Map<string, GivenReaction[]>();
  for (const v of windowVotes) {
    const list = given.get(v.character) ?? [];
    list.push({ act: v.act, quadrant: v.quadrant, at: v.at, share: v.share });
    given.set(v.character, list);
  }
  const played = new Map<string, PlayedCard[]>();
  const landed = new Map<string, LandedCard[]>();
  /* Each target's earliest card per player and alignment, an earlier window's included: the card
     every later vote there counts for, per player and not per mask or class, as the plan's Task B
     reads the owner's answer 3. A card whose kind the instance has since retired has no
     alignment, and holds nothing. Built once; the acts are already in time order. */
  const holder = new Map<string, string>();
  for (const c of [...acts.values()].filter((a) => a.kind === 'card' && a.target && a.card && alignmentOf.has(a.card)).sort((x, y) => x.at - y.at || cmp(x.id, y.id))) {
    const k = `${c.target}\u0000${playerOf(c.character)}\u0000${alignmentOf.get(c.card!)}`;
    if (!holder.has(k)) holder.set(k, c.id);
  }
  for (const a of windowActs.filter((a) => a.kind === 'card')) {
    if (!a.target) throw new Error(`settle: card Act ${a.id} has no target`);
    const target = actOf(a.target);
    const player = playerOf(a.character);
    const after: Record<Quadrant, number> = { excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 };
    // Each vote after the card counts once per player and alignment: for the earliest of that
    // player's cards of this alignment on the target (an earlier window's included), so two
    // Sweet cards pay what one would (the owner's answer 3, on #4).
    for (const v of windowVotesOn.get(target.id) ?? []) if (v.at > a.at && v.owner !== player && holder.get(`${target.id}\u0000${player}\u0000${alignmentOf.get(a.card!)}`) === a.id) after[v.quadrant] += v.share;
    const alignment = alignmentOf.get(a.card!)!;
    const onOthers = playerOf(target.character) !== player;
    const list = played.get(a.character) ?? [];
    // Sums of share differences, tidied as the leaning is, so float dust never decides an outdraw.
    for (const q of QUADRANTS) after[q] = tidy(after[q]);
    list.push({ act: a.id, card: a.card!, alignment, at: a.at, target: target.id, onOthers, votes: tidy(votesOn.get(a.id) ?? 0), targetVotes: tidy(votesOn.get(target.id) ?? 0), targetAfter: after });
    played.set(a.character, list);
    if (onOthers) {
      const on = landed.get(target.character) ?? [];
      on.push({ act: a.id, card: a.card!, alignment, at: a.at, on: target.id });
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
  type Contribution = Detail & { class: string };
  const contributions: Contribution[] = [];
  for (const c of characters.values()) {
    for (const stretch of stretchesOf(c)) {
      const inside = <T extends { at: number }>(xs: readonly T[] | undefined) => (xs ?? []).filter((x) => x.at >= stretch.from && x.at < stretch.to);
      const classInput: ClassInput = {
        character: c.id,
        from: stretch.from,
        to: stretch.to,
        // Posts alone: a card, a spin and a reveal (`unmask`) are the character's Acts, never its posts.
        posts: inside((windowActsBy.get(c.id) ?? []).filter((a) => a.kind === 'post')).map((a) => ({ act: a.id, at: a.at })),
        received: inside(received.get(c.id)).sort(byTime),
        given: inside(given.get(c.id)).sort(byTime),
        held: inside(held.get(c.id)).sort((x, y) => byTime(x, y) || cmp(x.quadrant, y.quadrant)),
        cardsPlayed: inside(played.get(c.id)).sort(byTime),
        cardsLanded: inside(landed.get(c.id)).sort(byTime),
        threadsSpun: inside(spun.get(c.id)).sort(byTime),
      };
      const empty = !classInput.posts.length && !classInput.received.length && !classInput.given.length && !classInput.held.length
        && !classInput.cardsPlayed.length && !classInput.cardsLanded.length && !classInput.threadsSpun.length;
      if (empty) continue;
      for (const e of classOf.get(stretch.class)!.earn(classInput, settings)) {
        if (!Number.isFinite(e.amount)) throw new Error(`settle: class ${stretch.class} returned ${e.amount} for ${e.reason}`);
        if (!REASON.test(e.reason)) throw new Error(`settle: class ${stretch.class} returned the reason "${e.reason}", which is not dot-separated words, each starting lowercase`);
        contributions.push({ player: c.player, character: c.id, class: stretch.class, reason: e.reason, amount: e.amount, ...(e.act ? { act: e.act } : {}), ...(e.quadrant ? { quadrant: e.quadrant } : {}), ...(e.valuing ? { valuing: e.valuing } : {}), ...(e.at !== undefined ? { at: e.at } : {}) });
      }
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
  const entries: LedgerEntry[] = sum((c) => `${c.player}\u0000${c.character}\u0000${c.reason}`)
    .map(([, { first, amount }]) => ({ window: window.id, player: first.player, character: first.character, reason: first.reason, amount: round(amount) }))
    .filter((e) => e.amount !== 0);
  /* Each entry's detail, in whole hundredths that add up to the entry exactly: the log names
     which Act moved how much, and its lines never disagree with the ledger ("The fiction may
     lie; the log never does"). The rounding is shared by largest remainder, ties by key. A line
     is one Act, quadrant and reaction time, so two reactions' lines never merge (Earning.at). */
  const lines = sum((c) => `${c.player}\u0000${c.character}\u0000${c.reason}\u0000${c.act ?? ''}\u0000${c.quadrant ?? ''}\u0000${c.at ?? ''}`);
  const linesOf = new Map<string, { key: string; first: Contribution; amount: number }[]>();
  for (const [key, { first, amount }] of lines) {
    const k = `${first.player}\u0000${first.character}\u0000${first.reason}`;
    const list = linesOf.get(k) ?? [];
    list.push({ key, first, amount: tidy(amount) });
    linesOf.set(k, list);
  }
  const details: Detail[] = [];
  const entryAmount = new Map(entries.map((e) => [`${e.player}\u0000${e.character}\u0000${e.reason}`, e.amount]));
  for (const [k, list] of [...linesOf].sort((a, b) => cmp(a[0], b[0]))) {
    const whole = apportion(entryAmount.get(k) ?? 0, list);
    list.forEach((l, i) => {
      if (whole[i] === 0) return;
      details.push({
        player: l.first.player, character: l.first.character, reason: l.first.reason,
        ...(l.first.act ? { act: l.first.act } : {}), ...(l.first.quadrant ? { quadrant: l.first.quadrant } : {}), ...(l.first.valuing ? { valuing: l.first.valuing } : {}), ...(l.first.at !== undefined ? { at: l.first.at } : {}), amount: whole[i]!,
      });
    });
  }
  const standing = new Map<string, number>();
  for (const e of entries) standing.set(e.character, (standing.get(e.character) ?? 0) + e.amount);
  const byClass: Record<string, number> = {};
  for (const [k, { amount }] of sum((c) => c.class)) byClass[k] = round(amount);
  return {
    entries,
    details,
    standings: [...standing].sort((a, b) => cmp(a[0], b[0])).map(([character, amount]) => ({ character, amount })),
    byClass,
    paid,
  };
}

/** One post's share of a ledger entry, in whole hundredths: the shares of an entry add up to it. */
export interface Share {
  readonly player: string;
  readonly character: string;
  readonly reason: string;
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
    const k = `${d.player}\u0000${d.character}\u0000${d.reason}`;
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
    const k = `${e.player}\u0000${e.character}\u0000${e.reason}`;
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
      shares.push({ player: e.player, character: e.character, reason: e.reason, act: w.act, ...(w.quadrant ? { quadrant: w.quadrant } : {}), amount: whole[i]! });
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
 * The lines add up to the entries. Run on the server, from estimate_input()
 * (supabase/migrations/0017_estimate.sql), which reads only what this player's estimate needs.
 */
export function estimateForOwner(input: SettlementInput, instance: Instance, player: string): { entries: { character: string; reason: string; amount: number }[]; lines: EstimateLine[] } {
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
      .filter((r) => r.act === valuing.act && quadrantOf.get(r.kind) === d.quadrant && inWindow(r.at) && r.at > valuing.from && r.player !== player && r.player !== author)
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
  return { entries: s.entries.filter((e) => e.player === player).map(({ character, reason, amount }) => ({ character, reason, amount })), lines: lines.filter((l) => l.amount !== 0) };
}
