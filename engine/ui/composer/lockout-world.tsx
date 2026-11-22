/**
 * A thread with a lockout back sprung on one of its Moves, for the lockout screens' tests (the postbit stamp, the reply box, the play form, the Lens): Spritey (another player's) sets
 * the back on post 1, and Pipewrench (the signed-in player's, with Zed beside her) plays a Move on it, so the spring locks Pipewrench out of the thread for `hours`. The cards are the
 * engine's own test cards, never an instance's.
 */
import { landsOn, ok, type CardEffect, type CardRules, type CardTarget } from '../../rules/cards.ts';
import { PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import type { Instance } from '../../rules/types.ts';
import type { Act, Id, Refusal } from '../data/api.ts';
import type { CardUi } from '../cards/types.ts';
import { waitFor } from '@testing-library/react';
import { buildWorld, testInstance } from '../test-world.tsx';

const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
const lkback = { ...base, key: 'lkback', name: 'Lk Back', alignment: 'sweet' as const, rarity: 'rare' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, match: { flavors: ['salty' as const, 'pepperoni' as const], upTo: 'rare' as const }, outcome: { kind: 'lockout' as const, hours: 24 } }, canApply: () => ok(undefined) };
const lksalty = { ...base, key: 'lksalty', name: 'Lk Salty', alignment: 'salty' as const, rarity: 'common' as const, stack: 6, canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'lksalty', stack: 6 }, t, e, now) };
const lkwide = { ...base, key: 'lkwide', name: 'Lk Wide', alignment: 'sweet' as const, rarity: 'common' as const, reaches: ['post' as const, 'thread' as const, 'character' as const, 'board' as const], lasts: { unit: 'day' as const, count: 1 }, canApply: () => ok(undefined) };
export const lockoutInstance: Instance = { ...testInstance, cards: [lkback, lksalty, lkwide] as unknown as CardRules[], machine: [], settings: { ...testInstance.settings, economy: {} } };
const art = { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)', canvas: '', mark: '', credit: 'Test' };
export const lockoutCards: CardUi[] = ['lkback', 'lksalty', 'lkwide'].map((key) => ({ key, art, describe: () => `${key}.`, summary: `${key}.` }));

const must = <T,>(a: { ok: true; value: T } | Refusal): T => { if (!a.ok) throw new Error(`refused: ${a.error}`); return a.value; };

/** The world, with nothing sprung yet; `lockOut` springs it. Another thread (`elsewhere`, with its post) is not held. */
export function lockoutWorld(admin = false) {
  const fake = buildWorld(undefined, lockoutInstance);
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel', { pronouns: PRONOUN_PRESETS.she });
  const zed = fake.seed.character(me, 'Zed', 'face');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const { thread, act: post } = fake.seed.thread('general', spritey, 'A short thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  const away = fake.seed.thread('general', spritey, 'Another thread', 'elsewhere');
  fake.seed.wallet(me, 900); fake.seed.wallet(other, 900);
  fake.seed.cards(me, { lksalty: 6, lkwide: 6 }); fake.seed.cards(other, { lkback: 3 });
  if (admin) fake.seed.admin(me);
  fake.signInAs(me);
  /* A live Act sent before an open thread has subscribed reaches no one, so a test that plays or ends a lockout while a thread is open waits on `listening` first. */
  const subscribed = new Set<Id>();
  const subscribe = fake.subscribeThread.bind(fake);
  fake.subscribeThread = (t, l) => { const off = subscribe(t, l); subscribed.add(t); return off; };
  const listening = async (t: Id = thread) => { await waitFor(() => { if (!subscribed.has(t)) throw new Error(`thread ${t} is not subscribed yet`); }); };
  return { fake, me, other, pipe, zed, spritey, thread, post, second, elsewhere: away.thread, elsewherePost: away.act, listening };
}
export type LockoutWorld = ReturnType<typeof lockoutWorld>;

/** Spritey sets the back on post 1 and Pipewrench plays a Move on it: the spring (a `lockedOut` Act) and the back's id. */
export async function lockOut(w: LockoutWorld): Promise<{ spring: Act; back: Id }> {
  w.fake.signInAs(w.other);
  const back = must(await w.fake.setCard('lkback', w.spritey, w.post, {}));
  w.fake.signInAs(w.me);
  must(await w.fake.playCard('lksalty', w.pipe, w.post, {}, ''));
  const spring = (await w.fake.postPlays([w.post])).plays.find((a) => a.kind === 'spring')!;
  return { spring, back: back.id };
}
