/**
 * A world with The System's moves in it, for the tests and the stories of the screens that show them (the board's notice, a staff
 * member's profile and moderation log, the admin queue). It writes through the in-memory backend's seed, so every fact in it is one
 * the server's own rows could hold, and names no instance: the boards are the first two the instance has.
 *
 * Today is the backend's clock. The Director has made four moves: one an admin reversed, one that ran out, one a crowd undid, and
 * the one in force on the first board, "Pointless Toast Palace", which asks twelve different characters to post and has five.
 * A move waits in the admin queue, and one was held.
 */
import type { Instance, Quadrant } from '../../rules/types.ts';
import type { Fake } from '../data/fake.ts';

const DAY = 86_400_000;

export interface MoveWorld {
  readonly me: string;
  readonly admin: string;
  readonly director: string;
  readonly bot: string;
  readonly spritey: string;
  readonly pipewrench: string;
  /** The first board's slug and its name before the move. */
  readonly general: string;
  readonly generalName: string;
  readonly second: string;
  readonly secondName: string;
  /** The move in force. */
  readonly inForce: string;
  readonly reversed: string;
  readonly expired: string;
  readonly met: string;
  readonly queued: number;
  readonly held: number;
}

export function seedMoves(fake: Fake, instance: Instance, options: { readonly signIn?: 'player' | 'admin' | 'none' } = {}): MoveWorld {
  const now = fake.clock.now();
  const ago = (days: number) => now - days * DAY;
  const open = instance.boards.filter((b) => !b.system);
  const first = open[0];
  if (!first) throw new Error('the instance has no board for a move to rename');
  const second = open[1] ?? first;
  const cls = instance.classes[0]!.key;
  const me = fake.seed.account('moves-player');
  const admin = fake.seed.account('moves-admin', { admin: true });
  const spritey = fake.seed.character(fake.seed.account('moves-spritey'), 'Spritey', cls, { at: ago(40) });
  const pipewrench = fake.seed.character(me, 'Pipewrench', cls, { at: ago(40) });
  fake.seed.character(admin, 'Admin Alex', cls, { at: ago(40) });
  const director = fake.seed.staff('director', 'The Director', 'boss', { title: 'Head of Board Operations (Toast Division)', signature: '[i]A forum is like a loaf of bread. Somebody has to slice it.[/i]', at: ago(60) });
  const bot = fake.seed.staff('hall-monitor', 'Hall Monitor', 'bot', { title: 'Keeper of the Hall', signature: 'Walk, do not run.', at: ago(60) });
  fake.seed.staffProfile('director', { interests: ['toast', 'artisanal breads', 'the 1998 film Small Soldiers (since Tuesday)'], favorites: [spritey, pipewrench], mood: 'Disappointed but Hopeful', signature: 'A forum is like a loaf of bread. Somebody has to slice it.', at: ago(1) });

  const distinct = (board: string, count: number) => ({ kind: 'distinctCharactersOnBoard', params: { board, count } });
  const reversed = fake.seed.move('director', { board: second.slug, name: 'Small Soldiers Situation Room', at: ago(9), demand: distinct(second.slug, 8), expiresAt: ago(2) });
  fake.seed.endMove(reversed, { why: 'reversed', by: 'admin', at: ago(8) });
  const expired = fake.seed.move('director', { board: first.slug, name: 'Pirate Puns Palace', at: ago(7), demand: distinct(first.slug, 9), expiresAt: ago(4) });
  fake.seed.endMove(expired, { why: 'expired', by: 'tick', at: ago(4) });
  const met = fake.seed.move('director', { board: second.slug, name: 'Lawn Bowling Lounge', at: ago(4), demand: distinct(second.slug, 12), expiresAt: ago(1) });
  fake.seed.endMove(met, { why: 'met', by: 'tick', at: ago(2) });
  const inForce = fake.seed.move('director', {
    board: first.slug, name: 'Pointless Toast Palace', premise: 'Toast, and only toast.', description: 'Welcome to the Pointless Toast Palace. Please butter responsibly.',
    body: 'This board has been IMPROVED. From now on we talk about toast. Show me twelve of you can handle it and maybe I will think about it.',
    demand: distinct(first.slug, 12), at: ago(1), expiresAt: now + 5 * DAY,
  });
  /* Its tally, one kind of each quadrant read from the instance, so the world names none of its kinds. */
  const kindIn = (q: Quadrant) => instance.reactions.find((r) => r.quadrant === q)!.key;
  fake.seed.tally(inForce, { [kindIn('excitedPositive')]: 9, [kindIn('excitedNegative')]: 6, [kindIn('calmPositive')]: 3, [kindIn('boredNegative')]: 1 });

  /* Five different characters have posted on the board since the move landed. */
  const { thread } = fake.seed.thread(first.slug, spritey, 'toast is a sandwich and I can prove it', 'Hear me out.', { at: ago(0.5) });
  for (let i = 0; i < 4; i++) {
    const poster = fake.seed.character(fake.seed.account(`moves-poster-${i}`), `Poster ${i + 1}`, cls, { at: ago(40) });
    fake.seed.post(thread, poster, `Toast take ${i + 1}`, { at: ago(0.4) + i * 60_000 });
  }

  const queued = fake.seed.queueMove('director', {
    board: second.slug, name: 'Small Soldiers Situation Room', premise: 'The 1998 film Small Soldiers.', description: 'Commando Elite members only. Gorgonites will be processed.',
    demand: distinct(second.slug, 8), goLiveAt: now + 17 * 3_600_000, expiresAt: now + 14 * DAY, why: 'Games has gone soft. Time for discipline.',
  });
  const held = fake.seed.queueMove('director', { board: second.slug, name: 'Cheese Cellar', demand: distinct(second.slug, 5), goLiveAt: ago(3), expiresAt: now + 3 * DAY, why: 'Cheese.' });
  fake.seed.holdQueued(held, ago(0.2));
  fake.signInAs(options.signIn === 'none' ? null : options.signIn === 'admin' ? admin : me);
  return { me, admin, director, bot, spritey, pipewrench, general: first.slug, generalName: first.name, second: second.slug, secondName: second.name, inForce, reversed, expired, met, queued, held };
}
