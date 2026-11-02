/**
 * Sends what waits in the outbox (broadcasts_due, supabase/migrations/0007_seasons.sql), a batch at
 * a time, and clears each batch once it went. Two kinds of run drain it: the settlement job, on
 * its schedule, and the act function, after every write (an alert is queued by the write that made
 * it, and sent from here). They may run at once: due_broadcasts claims what it returns for a lease
 * (0061_account_channel.sql), so each row goes to one of them. A row whose send failed stays
 * claimed and comes back when the lease lapses, so a failed send is retried by the next drain, and
 * is sent at least once, never lost.
 *
 * Where Realtime cannot be reached, everything claimed stays for a later drain. Where it refuses a
 * batch for good (a 413, say), the batch is sent one message at a time, so one bad message never
 * holds back every one after it, drain after drain: each that goes is cleared, and one refused
 * alone is given up, logged by its topic, and cleared too. Its Act is on the board for the next
 * load.
 */
import type { Broadcast, Delivery } from './broadcast.ts';
import type { Db } from './rpc.ts';

export const BROADCASTS_PER_SEND = 500;

export async function sendWaiting(db: Db, deliver: (messages: readonly Broadcast[]) => Promise<Delivery>): Promise<void> {
  const shape = (m: { topic: string; event: string; payload: unknown }) => ({ topic: m.topic, event: m.event, payload: m.payload });
  for (;;) {
    const due = await db.rpc<{ id: number; topic: string; event: string; payload: unknown }[]>('due_broadcasts', { most: BROADCASTS_PER_SEND });
    if (!due.length) return;
    const outcome = await deliver(due.map(shape));
    if (outcome === 'unreachable') return;
    if (outcome === 'refused') {
      for (const m of due) {
        const one = await deliver([shape(m)]);
        if (one === 'unreachable') return;
        if (one === 'refused') console.error('broadcast given up: Realtime refuses it for good', m.topic, m.event, m.id);
        await db.rpc('broadcasts_sent', { ids: [m.id] });
      }
    } else {
      await db.rpc('broadcasts_sent', { ids: due.map((m) => m.id) });
    }
    if (due.length < BROADCASTS_PER_SEND) return;
  }
}
