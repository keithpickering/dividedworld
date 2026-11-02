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
 * - One message alone, refused, is given up. One alone that stays unreachable past the sixth
 *   attempt is given up too, but only when others in the same pass went through, which proves
 *   Realtime was up and the message is the trouble: an outage kills nothing. A message given up
 *   is kept, dead, with its payload and why (broadcasts_dead); nothing is deleted unsent. Its Act
 *   is on the board for the next load.
 * - The one-at-a-time pass renews its lease before each send and stops short of the lease, so
 *   another drain never finds the rows it still holds, and releases what it did not reach.
 */
import type { Broadcast, Delivery } from './broadcast.ts';
import type { Db } from './rpc.ts';

export const BROADCASTS_PER_SEND = 500;
/** From this attempt a failing batch is sent one message at a time. */
export const SPLIT_AFTER = 3;
/** From this attempt a message that alone stays unreachable, while others go, is given up. */
export const DEAD_AFTER = 6;
/** How long a one-at-a-time pass may run: well inside the lease (two minutes), renewed before each send. */
export const FALLBACK_MS = 60_000;

interface Waiting { id: number; topic: string; event: string; payload: unknown; attempts?: number }

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
  for (const [i, m] of due.entries()) {
    if (clock() - began >= FALLBACK_MS) { unreached.push(...due.slice(i)); break; }
    await db.rpc('broadcasts_renew', { ids: ids(due.slice(i)) });
    const one = await deliver([shape(m)]);
    if (one === 'sent') { anySent = true; await db.rpc('broadcasts_sent', { ids: [m.id] }); }
    else if (one === 'refused') {
      console.error('broadcast given up: Realtime refuses it for good', m.topic, m.event, m.id);
      await db.rpc('broadcasts_dead', { ids: [m.id], why: 'refused' });
    } else stuck.push(m);
  }
  const doomed = anySent ? stuck.filter((m) => (m.attempts ?? 0) >= DEAD_AFTER) : [];
  if (doomed.length) {
    console.error('broadcast given up: unreachable while others went', doomed.map((m) => `${m.topic}/${m.event}/${m.id}`).join(', '));
    await db.rpc('broadcasts_dead', { ids: ids(doomed), why: 'unreachable' });
  }
  const release = [...unreached, ...stuck.filter((m) => !doomed.includes(m))];
  if (release.length) await db.rpc('broadcasts_release', { ids: ids(release) });
}

const ids = (rows: readonly Waiting[]) => rows.map((m) => m.id);
