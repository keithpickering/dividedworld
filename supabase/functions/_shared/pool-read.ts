/**
 * What `pool_read` returns (supabase/migrations/0421_whole_posts.sql), and how a function turns it into a read: the thread's title, the persona's character id, and the candidate posts, whole.
 * The Edge Functions that read a thread for a prompt (the chatter's turns and picks, the Mods' filings, reports and appeals) all do it this way: one `pool_read`, then `readThread`
 * (engine/system/read.ts), which chooses what the call reads under the ceiling and never cuts a post.
 */
import { pronounsOr, type PronounSet } from '../../../engine/rules/pronouns.ts';
import { readThread, type ReadCandidate, type ThreadReadResult } from '../../../engine/system/read.ts';

export interface PoolRead {
  readonly title: string;
  readonly self: string | null;
  readonly posts: readonly {
    readonly act: string; readonly seq: number; readonly at: string; readonly author: string; readonly name: string; readonly pronouns: PronounSet | null;
    readonly body: string; readonly replyTo: string | null; readonly quotes: readonly string[];
  }[];
}

/**
 * The reader's choice from what `pool_read` returned. A character with no profile row reads null pronouns, and takes `fallback` (the instance's default, else the engine's it-set) as the prompts have always written it.
 * `must` is what the call answers or judges (the replies a turn answers, a pick's quoted post, the judged post); the result's `answered` lists those taken.
 */
export function readOf(pr: PoolRead, fallback: PronounSet, must: readonly string[], readMost: number): ThreadReadResult {
  const cands: ReadCandidate[] = pr.posts.map((x) => ({ ...x, pronouns: pronounsOr(x.pronouns, fallback) }));
  return readThread(cands, { self: pr.self, must }, readMost);
}
