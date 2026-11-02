/**
 * Sends what waits in the outbox (broadcasts_due, supabase/migrations/0007_seasons.sql), a batch at
 * a time, and clears each batch once it went. Two kinds of run drain it: the settlement job, on
 * its schedule, and the act function, after every write (an alert is queued by the write that made
 * it, and sent from here). They may run at once: due_broadcasts claims what it returns for a lease
 * and counts the claim as an attempt (0061_account_channel.sql), so each row goes to one of them.
 *
 * A send that fails never loses a row and never holds one up for good:
 * - Unreachable (no answer, a 5xx): the claim is released with a backoff that grows with the
 *   attempts, so the next drain tries again soon, not after the lease. From the third attempt a
 *   batch goes one message at a time, so one payload that Realtime fails on alone no longer takes
 *   the whole batch down with it, drain after drain.
 * - Refused for good (a 413, say): the batch goes one at a time at once.
 * - One message alone, refused, is given up. One alone that fails unreachable is counted a failure
 *   only when others in the same pass went through, which proves Realtime was up and the message
 *   is the trouble; the third such failure gives it up. Claims are not failures (an outage piles
 *   claims on every waiting row), so an outage kills nothing and one flaky send kills no good row. A message given up
 *   is kept, dead, with its payload and why (broadcasts_dead); nothing is deleted unsent. Its Act
 *   is on the board for the next load.
 * - The one-at-a-time pass renews its lease every 20 sends and stops short of the lease (a minute),
 *   so another drain never finds the rows it still holds; it gives way after three single sends
 *   in a row fail with none sent (Realtime is down, not the rows), and releases what it did not reach.
 */
import type { Broadcast, Delivery } from './broadcast.ts';
import type { Db } from './rpc.ts';

export const BROADCASTS_PER_SEND = 500;
/** From this attempt a failing batch is sent one message at a time. */
export const SPLIT_AFTER = 3;
/** A message that fails alone this many times, in passes where others went through, is given up. */
export const DEAD_AFTER_FAILURES = 3;
/** A one-at-a-time pass renews its lease this often, in sends. */
export const RENEW_EVERY = 20;
/** A pass gives way after this many single failures in a row with nothing sent. */
export const GIVE_WAY_AFTER = 3;
/** How long a one-at-a-time pass may run: well inside the lease (two minutes), renewed before each send. */
export const FALLBACK_MS = 60_000;

interface Waiting { id: number; topic: string; event: string; payload: unknown; attempts?: number; failures?: number }

export async function sendWaiting(
  db: Db,
  deliver: (messages: readonly Broadcast[]) => Promise<Delivery>,
  options: { readonly clock?: () => number } = {},
): Promise<void> {
  const clock = options.clock ?? Date.now;
  const shape = (m: Waiting) => ({ topic: m.topic, event: m.event, payload: m.payload });
  for (;;) {
    const due = await db.rpc<Waiting[]>('due_broadcasts', { most: BROADCASTS_PER_SEND });
    if (!due.length) return;
    const outcome = await deliver(due.map(shape));
    if (outcome === 'sent') {
      await db.rpc('broadcasts_sent', { ids: ids(due) });
      if (due.length < BROADCASTS_PER_SEND) return;
      continue;
    }
    if (outcome === 'unreachable' && !due.some((m) => (m.attempts ?? 0) >= SPLIT_AFTER)) {
      await db.rpc('broadcasts_release', { ids: ids(due) });
      return;
    }
    await oneAtATime(db, deliver, due, clock, shape);
    return;
  }
}

async function oneAtATime(
  db: Db, deliver: (messages: readonly Broadcast[]) => Promise<Delivery>, due: readonly Waiting[], clock: () => number,
  shape: (m: Waiting) => Broadcast,
): Promise<void> {
  const began = clock();
  let anySent = false;
  const unreached: Waiting[] = [];
  const stuck: Waiting[] = [];
  let inARow = 0;
  for (const [i, m] of due.entries()) {
    if (clock() - began >= FALLBACK_MS || (!anySent && inARow >= GIVE_WAY_AFTER)) { unreached.push(...due.slice(i)); break; }
    if (i % RENEW_EVERY === 0) await db.rpc('broadcasts_renew', { ids: ids(due.slice(i)) });
    const one = await deliver([shape(m)]);
    if (one === 'sent') { anySent = true; inARow = 0; await db.rpc('broadcasts_sent', { ids: [m.id] }); }
    else if (one === 'refused') {
      console.error('broadcast given up: Realtime refuses it for good', m.topic, m.event, m.id);
      await db.rpc('broadcasts_dead', { ids: [m.id], why: 'refused' });
    } else { stuck.push(m); inARow++; }
  }
  // Only in a pass where others went through is a failure the row's own.
  const doomed = anySent ? stuck.filter((m) => (m.failures ?? 0) + 1 >= DEAD_AFTER_FAILURES) : [];
  const counted = anySent ? stuck.filter((m) => !doomed.includes(m)) : [];
  if (counted.length) await db.rpc('broadcasts_failed', { ids: ids(counted) });
  if (doomed.length) {
    console.error('broadcast given up: unreachable while others went', doomed.map((m) => `${m.topic}/${m.event}/${m.id}`).join(', '));
    await db.rpc('broadcasts_dead', { ids: ids(doomed), why: 'unreachable' });
  }
  const release = [...unreached, ...stuck.filter((m) => !doomed.includes(m))];
  if (release.length) await db.rpc('broadcasts_release', { ids: ids(release) });
}

const ids = (rows: readonly Waiting[]) => rows.map((m) => m.id);
