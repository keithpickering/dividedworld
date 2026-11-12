/**
 * The writer of a card's text, as a pure module (docs/plans/2026-11-07-you-were-saying-design.md, sections 3, 4, 6, 12 and 15): it takes a
 * `Db`, the `Models`, the instance and its settings, and works the queue claim_card_writes hands out (supabase/migrations/0149_card_writes.sql).
 * supabase/functions/write/index.ts is the edge for the cron's sweep; the act function's kick (afterTheAnswer) calls it for one post.
 *
 * A job is the frame's inputs. The card's own `writes.frame` makes the prompt from the post's visible words, never its markup, and the tails
 * already chained on the post; `scrubbedComplete` makes the call (a ledger row per call, models.complete); the job is finished with the text
 * or with the predicate that failed, and the database refunds where it is due. Nothing here reads who owns a post, a play or a character.
 *
 * Before any call the job is checked again: an instance whose old voice has been switched off since, and a post an edit has emptied
 * (`emptyPost`), finish without one.
 *
 * **Errors** ("Three unrelated timeouts are not a poison pill"). A transport failure is retried on the request inside models.complete; one
 * that outlived its retries is `unreachable`. An `AnswerRejected` is finished with its own predicate (`nonEmpty`, `scrub:word`, ...). A
 * database error, or a ledger row that could not be written (an unrecorded call is not trusted), stops the run and is thrown at once; the
 * jobs left claimed are taken again when their claim runs out. Any other error is a bug: it is logged and counted, the job is left
 * claimed (never finished as a failure it was not, which would refund a play for our fault), and the run goes on. The claim counts each
 * take in `attempts`, so a job that keeps crashing is finished `unreachable` past its third, without a call, and the chain behind it moves.
 *
 * **Time.** Jobs on different posts run up to `CONCURRENCY` at once, so a slow endpoint lengthens the wait and never stalls the board; a claim
 * takes no more jobs than that and hands back only the first waiting play of each post, so after a round the next is claimed, until a claim
 * is empty or the budget is spent.
 */
import { parse } from '../../../engine/bbcode/parse.ts';
import { visibleText } from '../../../engine/bbcode/visible.ts';
import { writeTokensMost } from '../../../engine/rules/cards.ts';
import { tokenCounter } from '../../../engine/system/tokens.ts';
import type { Instance, Settings } from '../../../engine/rules/types.ts';
import type { Models } from '../../../engine/system/model.ts';
import { scrubbedComplete } from '../../../engine/system/scrub.ts';
import { AnswerRejected, LedgerWriteFailed } from '../_shared/models/index.ts';
import { TransportFailure } from '../_shared/models/transport.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';

/** A job past this many claims is finished `unreachable` without a call. */
export const MOST_ATTEMPTS = 3;
/** How many jobs run at once. */
export const CONCURRENCY = 4;
/** No new round is claimed after this long; a claim lasts five minutes (a model call may take four) and the function's limit is longer. */
export const BUDGET_MS = 90_000;
/** A stored text is at most this many characters (card_texts). */
const MOST_CHARS = 4_000;
/** The characters a token is allowed, as models.complete counts them when no bound is given. */
const CHARS_A_TOKEN = 6;

export interface WriteJob {
  readonly play: string;
  readonly version: string;
  readonly post: string;
  readonly thread: string;
  readonly attempts: number;
  readonly card: string | null;
  readonly config: unknown;
  /** What the play bought, recorded with it (the play's own Act); a regeneration is made at this length however the economy has changed since. */
  readonly tokens: number | null;
  readonly author: string;
  readonly body: string;
  readonly title: string;
  readonly before: readonly { readonly name: string; readonly body: string }[];
  readonly earlier: readonly { readonly play: string; readonly text: string }[];
}

export interface WriteCounts { readonly claimed: number; readonly written: number; readonly failed: number; readonly errored: number }
export interface WriteOptions { readonly concurrency?: number; readonly budgetMs?: number; readonly now?: () => number }

const visible = (body: string): string => visibleText(parse(body));
const stops = (e: unknown): boolean => e instanceof DatabaseError || e instanceof TransportError || e instanceof LedgerWriteFailed;

/** Works the queue: the whole of it, or with `onlyPost` the one post's. Answers counts only. */
export async function runWrites(db: Db, models: Models, instance: Instance, settings: Settings, most: number, onlyPost?: string, options: WriteOptions = {}): Promise<WriteCounts> {
  const now = options.now ?? Date.now;
  // No more jobs are claimed than run at once, so none waits its turn inside its lease while a slow model holds the others.
  const concurrency = options.concurrency ?? CONCURRENCY;
  const started = now();
  const counts = { claimed: 0, written: 0, failed: 0, errored: 0 };
  let stopped = false;
  let firstError: unknown;
  const stop = (e: unknown) => { if (!stopped) { stopped = true; firstError = e; } };

  const finish = async (job: WriteJob, text: string | null, failed: string | null): Promise<void> => {
    await db.rpc('finish_card_write', { play: job.play, version: job.version, text, failed });
    if (text === null) counts.failed++; else counts.written++;
  };

  const work = async (job: WriteJob): Promise<void> => {
    const rules = job.card === null ? undefined : instance.cards.find((c) => c.key === job.card);
    // A card the instance no longer has, or one that no longer writes, an instance that has since switched its old voice off, and a job that has
    // crashed its worker too often, make no call.
    if (!rules?.writes || !settings.oldVoice || job.attempts > MOST_ATTEMPTS) return finish(job, null, 'unreachable');
    const writes = rules.writes;
    let text: string;
    try {
      // The frame is built inside the job's own try: a card's rules throwing on one post is that job's error, never the run's.
      const own = visible(job.body);
      // An edit emptied the post: nothing to continue, no call. On a first generation this refunds; on a regeneration the earlier tail stays.
      if (own.trim() === '') return finish(job, null, 'emptyPost');
      // The length the play bought, as the play recorded it: never worked out again from the settings of today.
      if (job.tokens === null || !Number.isSafeInteger(job.tokens) || job.tokens < 1) return finish(job, null, 'unreachable');
      // At most what the window leaves room for (design section 4): a play bought before the window shrank is made shorter, never refused.
      const maxTokens = Math.min(job.tokens, writeTokensMost(settings));
      const count = tokenCounter(settings.oldVoiceTokenizer);
      const { prompt, stop: stopAt } = writes.frame({
        post: { name: job.author, text: own },
        before: job.before.map((b) => ({ name: b.name, text: visible(b.body) })),
        title: job.title,
        tails: job.earlier.map((e) => e.text),
        settings,
        budget: settings.oldVoiceWindow - maxTokens,
        count,
      });
      const out = await scrubbedComplete(models, {
        duty: 'cardText', play: job.play, lines: 'many', maxTokens, maxChars: Math.min(MOST_CHARS, maxTokens * CHARS_A_TOKEN),
        temperature: 0.9, topP: 0.95, prompt, stop: stopAt,
      }, instance.system.scrubWords);
      text = out.value;
    } catch (e) {
      if (e instanceof AnswerRejected) return finish(job, null, e.predicate);
      if (e instanceof TransportFailure) return finish(job, null, 'unreachable');
      if (stops(e)) throw e;
      // A bug: said in the log by the play and the error's name alone (a message could carry a post's words), the job left claimed for its next
      // turn (and its third attempt's `unreachable`).
      console.error('a card text could not be written', job.play, e instanceof Error ? e.name : 'unknown');
      counts.errored++;
      return;
    }
    return finish(job, text, null);
  };

  while (!stopped && now() - started < (options.budgetMs ?? BUDGET_MS)) {
    const jobs = await db.rpc<WriteJob[]>('claim_card_writes', { most: Math.min(most, concurrency), only_post: onlyPost ?? null });
    if (!jobs.length) break;
    counts.claimed += jobs.length;
    const queue = [...jobs];
    const worker = async (): Promise<void> => {
      for (let job = queue.shift(); job && !stopped; job = queue.shift()) {
        try { await work(job); } catch (e) { stop(e); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  }
  if (stopped) throw firstError;
  return counts;
}
