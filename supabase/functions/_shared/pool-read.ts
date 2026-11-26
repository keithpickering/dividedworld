/**
 * What `pool_read` returns (supabase/migrations/0421_whole_posts.sql), and how a function turns it into a read: the thread's title, the persona's character id, and the candidate posts, whole.
 * The Edge Functions that read a thread for a prompt (the chatter's turns and picks, the Mods' filings, reports and appeals) all do it this way: one `pool_read`, then `readThread`
 * (engine/system/read.ts), which chooses what the call reads under the ceiling and never cuts a post.
 */
import { pronounsOr, type PronounSet } from '../../../engine/rules/pronouns.ts';
import type { CardRules } from '../../../engine/rules/cards.ts';
import type { ReadOrigin, ReadOriginPost, ReadPlay, ReadPoll, Reactions } from '../../../engine/system/extras.ts';
import { readThread, type ReadCandidate, type ReadOptions, type ThreadReadResult } from '../../../engine/system/read.ts';

export interface PoolRead {
  readonly title: string;
  readonly self: string | null;
  readonly posts: readonly {
    readonly act: string; readonly seq: number; readonly at: string; readonly author: string; readonly name: string; readonly pronouns: PronounSet | null;
    readonly body: string; readonly replyTo: string | null; readonly quotes: readonly string[];
    /** From `post_extras`, absent from an answer of `pool_read` before 0426 (read as none) (supabase/migrations/0426_reads_see_the_board.sql): the live poll, the plays the board shows, the public reaction counts, and the moment a rewound post shows (`body` is then that version's). */
    readonly poll?: ReadPoll | null; readonly plays?: readonly ReadPlay[]; readonly reactions?: Reactions; readonly rewoundTo?: string | null;
  }[];
  /** What a spun thread was spun from; null for a thread that was not. The origin post carries its own poll, plays and reactions. */
  readonly origin?: (Omit<ReadOrigin, 'post'> & { readonly post: (Omit<ReadOriginPost, 'pronouns' | 'poll' | 'plays' | 'reactions' | 'rewoundTo'> & { readonly pronouns?: PronounSet | null; readonly poll?: ReadPoll | null; readonly plays?: readonly ReadPlay[]; readonly reactions?: Reactions; readonly rewoundTo?: string | null }) | null }) | null;
}

/**
 * What a read needs from the instance and the call: `now`, the call's time in ms (an Edge Function may read its clock; the engine never does), the instance's cards (the `seen` sentence of each, the name
 * of each) and its reactions (a kind shown as its emoji), and its groups' names where a place names one.
 */
export interface ReadContext {
  readonly now: number;
  readonly cards: readonly Pick<CardRules, 'key' | 'name' | 'seen' | 'covers'>[];
  readonly reactions: readonly { readonly key: string; readonly emoji: string }[];
  readonly groupName?: (key: string) => string | undefined;
}

/** The context of a read from an instance (anything with its `cards` and `reactions`) and the time. */
export const readContext = (instance: { readonly cards: ReadContext['cards']; readonly reactions: ReadContext['reactions'] }, now: number): ReadContext => ({ now, cards: instance.cards, reactions: instance.reactions });

/**
 * The reader's choice from what `pool_read` returned. A character with no profile row reads null pronouns, and takes `fallback` (the instance's default, else the engine's it-set) as the prompts have always written it.
 * `must` is what the call answers or judges (the replies a turn answers, a pick's quoted post, the judged post); the result's `answered` lists those taken.
 */
export function readOf(pr: PoolRead, fallback: PronounSet, must: readonly string[], readMost: number, ctx: ReadContext): ThreadReadResult {
  const cands: ReadCandidate[] = pr.posts.map((x) => ({ ...x, pronouns: pronounsOr(x.pronouns, fallback), poll: x.poll ?? null, plays: x.plays ?? [], reactions: x.reactions ?? {}, rewoundTo: x.rewoundTo ?? null }));
  const origin: ReadOrigin | null = pr.origin === undefined || pr.origin === null ? null
    : { ...pr.origin, post: pr.origin.post === null || pr.origin.post === undefined ? null : { ...pr.origin.post, pronouns: pronounsOr(pr.origin.post.pronouns, fallback), poll: pr.origin.post.poll ?? null, plays: pr.origin.post.plays ?? [], reactions: pr.origin.post.reactions ?? {}, rewoundTo: pr.origin.post.rewoundTo ?? null } };
  return readThread(cands, { self: pr.self, must }, { ...readingOf(readMost, ctx), origin });
}

/**
 * What a read renders with, besides the origin: the ceiling, the call's time, the instance's `seen` sentence and name for each card, and each reaction as its emoji. The reader (`readOf`) and the patrol
 * (which shows each sampled post whole with its extras, `patrolPrompt`) take it from here, so a card is told the same way to both.
 */
export function readingOf(readMost: number, ctx: ReadContext): Omit<ReadOptions, 'origin'> {
  const byKey = new Map(ctx.cards.map((c) => [c.key, c]));
  const emoji = new Map(ctx.reactions.map((r) => [r.key, r.emoji]));
  return {
    readMost, now: ctx.now,
    // A card with no `seen`, a card the instance lacks and a back with no card are all null: the reader says what is known of them.
    seen: (card, p) => (card === null ? null : byKey.get(card)?.seen?.(p) ?? null),
    covers: (card, p) => (card === null ? null : byKey.get(card)?.covers?.(p) ?? null),
    cardName: (key) => byKey.get(key)?.name,
    groupName: ctx.groupName,
    reactionName: (kind) => emoji.get(kind) ?? kind,
  };
}
