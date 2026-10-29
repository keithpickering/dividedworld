/**
 * The actions a player takes, decided before the database is asked.
 *
 * Invariants in SQL; judgment in TypeScript (design, section 12). An Edge Function hands each
 * request to decide(), which reads it against the instance's rules and returns the SQL function
 * that writes it, with that function's arguments, or the field that is wrong and why. The SQL
 * function then checks again everything it can (who plays the character, a cap, a length) and
 * writes in one transaction, so a check missed here cannot get through there
 * (supabase/tests/0011-actions.sql calls each one directly with what decide() refuses). What
 * only the database knows (who owns a character, what already exists) is decided only there.
 *
 * Lengths are counted in characters, code points, as Postgres's char_length counts them, so
 * the two never disagree on an emoji.
 */
import type { Instance } from './types.ts';
import { basePrice, casterMessage } from './cards.ts';

/**
 * A decided action. Most are written as the player, whose session the database reads. A card's
 * are written by the service for the caller (`asService`), since a play's price and
 * configuration are its card's own rules, which SQL cannot run: the caller adds `who`, and for a
 * play reads the post first (`needsTarget`) for the card to price, and for saved state reads
 * which card was played (`needsCardOfPlay`) for it to check.
 */
export type Decision =
  | {
    readonly ok: true;
    readonly rpc: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly asService?: true;
    readonly needsTarget?: true;
    readonly needsCardOfPlay?: true;
  }
  | { readonly ok: false; readonly field: string; readonly why: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const length = (s: string) => [...s].length;
/** Blank: JavaScript's whitespace and line terminators, and the zero-width characters; the SQL's own set is the same (supabase/migrations/0005_actions.sql). */
const BLANK = /^[\s\u200b-\u200d\u2060]*$/u;

/** The longest a character's name may be, as the characters table holds it (supabase/migrations/0001_core.sql). */
export const NAME_MAX_LENGTH = 40;
/**
 * What a name may not hold, so that no character's name can be made to look like another's:
 * control, invisible, filler and direction characters, and any space but U+0020. The same set as
 * supabase/migrations/0024_debuts.sql's create_character (0009's, remade), which holds it again.
 */
const NAME_HIDDEN = /[\u0001-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\u2800\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]|  /u;

class Refused extends Error {
  readonly field: string;
  constructor(field: string, why: string) { super(why); this.field = field; }
}

type Fields = Record<string, unknown>;
const id = (r: Fields, field: string): string => {
  const v = r[field];
  if (typeof v !== 'string' || !UUID.test(v)) throw new Refused(field, 'is not an id');
  return v;
};
const optionalId = (r: Fields, field: string): string | null => (r[field] === undefined || r[field] === null ? null : id(r, field));
const text = (r: Fields, field: string, most: number, { mayBeEmpty = false } = {}): string => {
  const v = r[field] ?? (mayBeEmpty ? '' : undefined);
  if (typeof v !== 'string') throw new Refused(field, 'is not text');
  if (!mayBeEmpty && BLANK.test(v)) throw new Refused(field, 'is empty');
  if (length(v) > most) throw new Refused(field, `is longer than ${most} characters`);
  return v;
};

const card = (r: Fields, instance: Instance): string => {
  const key = r.card;
  if (typeof key !== 'string' || !instance.cards.some((c) => c.key === key)) throw new Refused('card', `the Vending Machine has no card ${JSON.stringify(key)}`);
  return key;
};

type Decided = Omit<Extract<Decision, { ok: true }>, 'ok'>;

/**
 * A character's debut (supabase/migrations/0024_debuts.sql, 0028_loud_classes.sql): dropped `now`
 * or at the `tally`, `silent`, `announced`, or announced `with_class`; what a request leaves out is
 * the default given, where there is one.
 */
const debut = (r: Fields, defaults?: { timing: string; loudness: string }): { timing: string; loudness: string } => {
  const timing = r.timing ?? defaults?.timing;
  if (timing !== 'now' && timing !== 'tally') throw new Refused('timing', 'a character drops now or debuts at the tally');
  const loudness = r.loudness ?? defaults?.loudness;
  if (loudness !== 'silent' && loudness !== 'announced' && loudness !== 'with_class') throw new Refused('loudness', 'a debut is silent, announced, or announced with its class');
  return { timing, loudness };
};

/** A flag a request may leave out, which is then false. */
const flag = (r: Fields, field: string): boolean => {
  const v = r[field] ?? false;
  if (typeof v !== 'boolean') throw new Refused(field, 'is true or false');
  return v;
};

/** Each action: the SQL function that writes it, and its arguments from the request. */
const ACTIONS: Record<string, (r: Fields, instance: Instance) => Decided> = {
  startThread: (r, { settings }) => {
    const board = r.board;
    if (typeof board !== 'string' || !SLUG.test(board)) throw new Refused('board', 'is not a board');
    return { rpc: 'start_thread', args: { board_slug: board, through: id(r, 'character'), title: text(r, 'title', settings.titleMaxLength), body: text(r, 'body', settings.postMaxLength) } };
  },
  post: (r, { settings }) => ({
    rpc: 'post',
    args: { in_thread: id(r, 'thread'), through: id(r, 'character'), body: text(r, 'body', settings.postMaxLength), quoting: optionalId(r, 'quote') },
  }),
  edit: (r, { settings }) => ({
    rpc: 'edit_post',
    args: { target: id(r, 'post'), through: id(r, 'character'), body: text(r, 'body', settings.postMaxLength) },
  }),
  spin: (r, { settings }) => ({
    rpc: 'spin',
    args: { origin: id(r, 'origin'), through: id(r, 'character'), title: text(r, 'title', settings.titleMaxLength), body: text(r, 'body', settings.postMaxLength, { mayBeEmpty: true }) },
  }),
  react: (r, { reactions }) => {
    const kind = r.kind;
    if (typeof kind !== 'string' || !reactions.some((k) => k.key === kind)) throw new Refused('kind', `there is no reaction ${JSON.stringify(kind)}`);
    return { rpc: 'react', args: { target: id(r, 'act'), through: id(r, 'character'), reaction: kind } };
  },
  turn: (r, instance) => {
    const to = r.class;
    if (typeof to !== 'string' || !instance.classes.some((c) => c.key === to)) throw new Refused('class', `there is no class ${JSON.stringify(to)}`);
    // A Turn names the class it Turns from (`showFrom`), the one it Turns to (`showTo`), both or
    // neither (supabase/migrations/0028_loud_classes.sql); an older client's "revealed" is
    // announced, naming the class it Turns from.
    if (r.loudness === 'revealed') return { rpc: 'turn', args: { through: id(r, 'character'), to_class: to, loudness: 'announced', show_from: true, show_to: false } };
    const loudness = r.loudness;
    if (loudness !== 'silent' && loudness !== 'announced') throw new Refused('loudness', 'a Turn is silent or announced');
    const showFrom = flag(r, 'showFrom');
    const showTo = flag(r, 'showTo');
    if (loudness === 'silent' && (showFrom || showTo)) throw new Refused(showFrom ? 'showFrom' : 'showTo', 'a silent Turn names no class');
    return { rpc: 'turn', args: { through: id(r, 'character'), to_class: to, loudness, show_from: showFrom, show_to: showTo } };
  },
  withdrawTurn: (r) => ({ rpc: 'withdraw_turn', args: { through: id(r, 'character') } }),
  // A reveal of the character's own class (supabase/migrations/0027_unmask.sql): the class is read
  // where it is written, never taken from the request; the message is a caster's, plain and short.
  unmask: (r) => {
    const said = casterMessage(r.message);
    if (!said.ok) throw new Refused('message', said.why);
    return { rpc: 'unmask', args: { through: id(r, 'character'), in_thread: id(r, 'thread'), message: said.value } };
  },
  buyCard: (r, instance) => {
    const key = card(r, instance);
    return { rpc: 'buy_card', args: { card: key, price: basePrice(instance.cards.find((c) => c.key === key)!, instance.settings) }, asService: true };
  },
  playCard: (r, instance) => ({
    rpc: 'play_card',
    // The message is the card's rules' to read (decidePlay), with the post they price.
    args: { card: card(r, instance), through: id(r, 'character'), target: id(r, 'target'), config: r.config ?? {}, message: r.message ?? '' },
    asService: true,
    needsTarget: true,
  }),
  createCharacter: (r, instance) => {
    const kind = r.class;
    if (typeof kind !== 'string' || !instance.classes.some((c) => c.key === kind)) throw new Refused('class', `there is no class ${JSON.stringify(kind)}`);
    const name = text({ name: typeof r.name === 'string' ? r.name.replace(/^ +| +$/g, '') : r.name }, 'name', NAME_MAX_LENGTH);
    if (NAME_HIDDEN.test(name)) throw new Refused('name', 'can hold letters, marks, digits, symbols and single spaces, nothing hidden');
    return { rpc: 'create_character', args: { name, class: kind, ...debut(r, { timing: 'tally', loudness: 'announced' }) } };
  },
  setDebut: (r) => ({ rpc: 'set_debut', args: { through: id(r, 'character'), ...debut(r) } }),
  createInvite: () => ({ rpc: 'create_invite', args: {} }),
  reissueInvite: (r) => {
    if (typeof r.invite !== 'number' || !Number.isSafeInteger(r.invite) || r.invite < 1) throw new Refused('invite', 'is not an invite');
    return { rpc: 'reissue_invite', args: { invite: r.invite } };
  },
  openAccount: (r) => {
    const code = r.invite ?? null;
    if (code !== null && (typeof code !== 'string' || code.length > 64)) throw new Refused('invite', 'is not an invite code');
    return { rpc: 'open_account', args: { code } };
  },
  saveEffect: (r) => {
    if (typeof r.state !== 'object' || r.state === null) throw new Refused('state', 'is the effect\'s state, an object');
    return { rpc: 'save_effect_state', args: { through: id(r, 'character'), on_play: id(r, 'play'), state: r.state }, asService: true, needsCardOfPlay: true };
  },
};

/** The names of the actions decide() knows. */
export const ACTION_NAMES: readonly string[] = Object.keys(ACTIONS);

export function decide(request: unknown, instance: Instance): Decision {
  if (typeof request !== 'object' || request === null) return { ok: false, field: 'action', why: 'a request is an object naming its action' };
  const r = request as Fields;
  const action = typeof r.action === 'string' ? ACTIONS[r.action] : undefined;
  if (!action) return { ok: false, field: 'action', why: `the actions are ${ACTION_NAMES.join(', ')}` };
  try {
    return { ok: true, ...action(r, instance) };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, field: e.field, why: e.message };
    throw e;
  }
}
