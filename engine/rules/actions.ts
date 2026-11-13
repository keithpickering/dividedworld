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
import { normalizePronouns, pronounProblems, type PronounSet } from './pronouns.ts';
import { OLD_VOICE_OFF, REACHES, casterMessage, listed, reachesOf, withheld, type Play, type Reach, type SetConditions } from './cards.ts';

/**
 * A decided action. Most are written as the player, whose session the database reads. A card's
 * are written by the service for the caller (`asService`), since a play's price and
 * configuration are its card's own rules, which SQL cannot run: the caller adds `who`, and for a
 * play reads the post first (`needsTarget`) for the card to price, and for saved state reads
 * which card was played (`needsCardOfPlay`) for it to check; a draw or a wash on a wall reads it too (`needsSurface`). A play names how it is played
 * (`play`), so the caller decides it by that play's rules (engine/rules/cards.ts).
 */
export type Decision =
  | {
    readonly ok: true;
    readonly rpc: string;
    readonly args: Readonly<Record<string, unknown>>;
    readonly asService?: true;
    readonly needsTarget?: true;
    readonly needsCardOfPlay?: true;
    /** A draw or a wash on a surface (`draw_on_surface`, `wash_surface`): the caller reads which card holds the wall (`card_of_play`) and decides the drawing by that card's rules, with the limit from the settings rows. */
    readonly needsSurface?: true;
    readonly play?: Exclude<Play, 'keep'>;
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
/** The price a purchase's screen showed: a whole number of hundredths above 0 and within the database's integer. */
const shownPrice = (r: Fields): number => {
  const v = r.price;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 2_147_483_647) throw new Refused('price', 'is not a price the machine shows');
  return v;
};
/** The amount of a gift: a whole number of hundredths above 0 and within the database's integer; which amounts a drive offers is the database's to say. */
const giftAmount = (r: Fields): number => {
  const v = r.amount;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 2_147_483_647) throw new Refused('amount', 'is not a whole amount of hundredths');
  return v;
};
const optionalId = (r: Fields, field: string): string | null => (r[field] === undefined || r[field] === null ? null : id(r, field));
/**
 * The characters a body puts words in the mouth of (the BBCode design, "The framed alert"): a list of ids the page found in its counterfeit quotes. The first five
 * distinct ones are sent, as write_framed looks at no more; none, or none given, is no argument at all, so a request that names no `framing` reads as before.
 */
const FRAMING_MOST = 5;
const framing = (r: Fields): { framing?: string[] } => {
  const v = r.framing;
  if (v === undefined || v === null) return {};
  if (!Array.isArray(v)) throw new Refused('framing', 'is not a list of ids');
  const kept = [...new Set(v.slice(0, FRAMING_MOST).map((x) => { if (typeof x !== 'string' || !UUID.test(x)) throw new Refused('framing', 'is not a list of ids'); return x; }))];
  return kept.length === 0 ? {} : { framing: kept };
};
const text = (r: Fields, field: string, most: number, { mayBeEmpty = false } = {}): string => {
  const v = r[field] ?? (mayBeEmpty ? '' : undefined);
  if (typeof v !== 'string') throw new Refused(field, 'is not text');
  if (!mayBeEmpty && BLANK.test(v)) throw new Refused(field, 'is empty');
  if (length(v) > most) throw new Refused(field, `is longer than ${most} characters`);
  return v;
};

const card = (r: Fields, instance: Instance): string => {
  const key = r.card;
  const named = typeof key === 'string' ? instance.cards.find((c) => c.key === key) : undefined;
  if (typeof key !== 'string' || named === undefined) throw new Refused('card', `the Vending Machine has no card ${JSON.stringify(key)}`);
  if (withheld(named, instance.settings)) throw new Refused('card', OLD_VOICE_OFF);
  return key;
};

/**
 * Where a play goes (the card mechanic's design, section 7): a post unless the request says, and only a reach its card lists, refused
 * here before SQL is asked. Beyond a post it travels as `reach`, and a character play names the post whose postbit took it
 * (`from_post`), which SQL holds to be that character's. A Set goes on a post alone.
 */
const reached = (r: Fields, instance: Instance, key: string, play: Exclude<Play, 'keep'>): Fields => {
  const reach = (r.reach ?? 'post') as Reach;
  if (!REACHES.includes(reach)) throw new Refused('reach', 'is a post, a character, a thread or a board');
  if (play === 'set') {
    if (reach !== 'post') throw new Refused('reach', 'a card is set face down on a post');
    return {};
  }
  const lands = reachesOf(instance.cards.find((c) => c.key === key)!);
  if (!lands.includes(reach)) throw new Refused('reach', `this card lands on ${listed(lands)}`);
  if (reach === 'post') return {};
  return { reach, ...(reach === 'character' ? { from_post: id(r, 'post') } : {}) };
};

/** A Cast's or a Use's arguments: the card, the character, the target, its configuration and message, and where it goes. */
const played = (r: Fields, instance: Instance, play: 'cast' | 'use'): Fields => {
  const key = card(r, instance);
  const through = id(r, 'character');
  const target = id(r, 'target');
  return { card: key, through, target, config: r.config ?? {}, message: r.message ?? '', ...reached(r, instance, key, play), ...firstDraw(r, instance, key) };
};

/**
 * A surface card's first draw (the card's own `surface.validateDraw` reads it in decidePlay, which holds what it must be): carried as `first`,
 * and refused here, before anything is read, when a surface card is played without one. Any other card carries none, so a request that names one is not read.
 */
const firstDraw = (r: Fields, instance: Instance, key: string): { first?: unknown } => {
  if (instance.cards.find((c) => c.key === key)?.surface === undefined) return {};
  if (r.first === undefined || r.first === null) throw new Refused('first', 'draw your tag first');
  return { first: r.first };
};

/**
 * A Set's conditions, from the request's optional `when` (quote-conditions design, section 1): `says` and `passage` are text and `who` is
 * `{ except, characters }` with ids, none of them required. A shape that is not that is refused here; what the words and the list must
 * satisfy is decideSet's, and whether a named character is on the board is SQL's. Anyone is no `who`.
 */
const conditions = (r: Fields): SetConditions | undefined => {
  const w = r.when;
  if (w === undefined || w === null) return undefined;
  if (typeof w !== 'object' || Array.isArray(w)) throw new Refused('when', 'is not a set of conditions');
  const { says, passage, who } = w as Fields;
  const out: { says?: string; passage?: string; who?: { except: boolean; characters: string[] } } = {};
  if (says !== undefined && says !== null) { if (typeof says !== 'string') throw new Refused('when', 'what they say is not text'); out.says = says; }
  if (passage !== undefined && passage !== null) { if (typeof passage !== 'string') throw new Refused('when', 'the passage is not text'); out.passage = passage; }
  if (who !== undefined && who !== null) {
    const l = who as Fields;
    if (typeof who !== 'object' || Array.isArray(who) || typeof l.except !== 'boolean' || !Array.isArray(l.characters)) throw new Refused('when', 'who is not a list of characters and whether they are spared');
    out.who = { except: l.except, characters: l.characters.map((x) => { if (typeof x !== 'string' || !UUID.test(x)) throw new Refused('when', 'who is not a list of ids'); return x; }) };
  }
  return Object.keys(out).length === 0 ? undefined : out;
};

/** A Set's arguments: the card, the character and the post, with no message, and the conditions if it names any. It carries no first draw, since a surface card is never set (faceUpOnly); refused for any reach but a post's. */
const setArgs = (r: Fields, instance: Instance): Fields => {
  const key = card(r, instance);
  const when = conditions(r);
  const args = { card: key, through: id(r, 'character'), target: id(r, 'target'), config: r.config ?? {}, ...(when ? { conditions: when } : {}) };
  reached(r, instance, key, 'set');
  return args;
};

type Decided = Omit<Extract<Decision, { ok: true }>, 'ok'>;

/** A character's pronouns, if the request names any: lowered as every writer stores them, or refused in pronounProblems' words; none is null, which create_character reads as the instance's default. */
const pronouns = (r: Fields): PronounSet | null => {
  const v = r.pronouns;
  if (v === undefined || v === null) return null;
  const lowered = typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? x.trim().toLowerCase() : x]))
    : v;
  const problems = pronounProblems(lowered);
  if (problems.length) throw new Refused('pronouns', problems.join('; '));
  return normalizePronouns(lowered as unknown as PronounSet);
};

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

/** The drawing a draw or a wash carries: whatever the card's own validator reads, so only its presence is checked here. */
const drawing = (r: Fields): unknown => {
  if (r.input === undefined || r.input === null) throw new Refused('input', 'is the drawing');
  return r.input;
};

/** Each action: the SQL function that writes it, and its arguments from the request. */
const ACTIONS: Record<string, (r: Fields, instance: Instance) => Decided> = {
  startThread: (r, { settings }) => {
    const board = r.board;
    if (typeof board !== 'string' || !SLUG.test(board)) throw new Refused('board', 'is not a board');
    return { rpc: 'start_thread', args: { board_slug: board, through: id(r, 'character'), title: text(r, 'title', settings.titleMaxLength), body: text(r, 'body', settings.postMaxLength), ...framing(r) } };
  },
  post: (r, { settings }) => ({
    rpc: 'post',
    args: { in_thread: id(r, 'thread'), through: id(r, 'character'), body: text(r, 'body', settings.postMaxLength), quoting: optionalId(r, 'quote'), ...framing(r) },
  }),
  edit: (r, { settings }) => ({
    rpc: 'edit_post',
    args: { target: id(r, 'post'), through: id(r, 'character'), body: text(r, 'body', settings.postMaxLength) },
  }),
  spin: (r, { settings }) => ({
    rpc: 'spin',
    args: { origin: id(r, 'origin'), through: id(r, 'character'), title: text(r, 'title', settings.titleMaxLength), body: text(r, 'body', settings.postMaxLength, { mayBeEmpty: true }), ...framing(r) },
  }),
  // A barred character's apology (supabase/migrations/0130_bars_apologies.sql): the spin of the move's Act that bars it, with words of its own that the judge reads.
  apologize: (r, { settings }) => ({
    rpc: 'apologize',
    args: { in_move: id(r, 'move'), through: id(r, 'character'), title: text(r, 'title', settings.titleMaxLength), body: text(r, 'body', settings.postMaxLength), ...framing(r) },
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
  // A purchase names the slot and the price the screen showed (supabase/migrations/0139_machine.sql): the database holds the slot and
  // refuses, in plain words, a price that is no longer its own, so an admin's change between the look and the press is never charged unseen.
  buyCard: (r) => ({ rpc: 'buy_card', args: { slot: id(r, 'slot'), price: shownPrice(r) }, asService: true }),
  buyPack: (r) => ({ rpc: 'buy_pack', args: { slot: id(r, 'slot'), price: shownPrice(r) }, asService: true }),
  // A gift to a drive (supabase/migrations/0153_drives.sql, donate): the service's call for the account, as a purchase is. The drive's open time, the amounts it offers, the split and the wallet are the database's to say.
  donate: (r) => ({ rpc: 'donate', args: { through: id(r, 'character'), drive: id(r, 'drive'), amount: giftAmount(r) }, asService: true }),
  playCard: (r, instance) => ({
    rpc: 'play_card',
    // The message is the card's rules' to read (decidePlay), with the target they price.
    args: played(r, instance, 'cast'),
    asService: true,
    needsTarget: true,
    play: 'cast',
  }),
  // A Use is a play on the caller's own post, written as a cast is; SQL holds whose post it is.
  useCard: (r, instance) => ({
    rpc: 'play_card',
    args: played(r, instance, 'use'),
    asService: true,
    needsTarget: true,
    play: 'use',
  }),
  // A Set carries no message: its Act says nothing, so every card set face down is alike.
  setCard: (r, instance) => ({
    rpc: 'set_card',
    args: setArgs(r, instance),
    asService: true,
    needsTarget: true,
    play: 'set',
  }),
  // A face-down card taken back to the hand (supabase/migrations/0148_card_types.sql): the service's call for the account, as set_card is; the database holds whose back it is.
  takeBack: (r) => ({ rpc: 'take_back', args: { through: id(r, 'character'), set_act: id(r, 'set') }, asService: true }),
  // A drawing on a surface, and its wash (supabase/migrations/0317_surfaces.sql): the service's call for the account. The card that holds the wall reads the drawing (`input`, its own shape),
  // counts its cells and, for a draw, reads the limit from the settings rows; the database holds the rest (who plays the character, a ban, a bar, an ended play, the lock).
  draw: (r) => ({ rpc: 'draw_on_surface', args: { through: id(r, 'character'), play: id(r, 'play'), input: drawing(r) }, asService: true, needsSurface: true }),
  wash: (r) => ({ rpc: 'wash_surface', args: { through: id(r, 'character'), play: id(r, 'play'), input: drawing(r) }, asService: true, needsSurface: true }),
  createCharacter: (r, instance) => {
    const kind = r.class;
    if (typeof kind !== 'string' || !instance.classes.some((c) => c.key === kind)) throw new Refused('class', `there is no class ${JSON.stringify(kind)}`);
    const name = text({ name: typeof r.name === 'string' ? r.name.replace(/^ +| +$/g, '') : r.name }, 'name', NAME_MAX_LENGTH);
    if (NAME_HIDDEN.test(name)) throw new Refused('name', 'can hold letters, marks, digits, symbols and single spaces, nothing hidden');
    return { rpc: 'create_character', args: { name, class: kind, ...debut(r, { timing: 'now', loudness: 'announced' }), pronouns: pronouns(r) } };
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
  // An admin ends a card play (supabase/migrations/0092_card_end.sql): the player's own call, since only_admins reads the caller.
  reverseCard: (r) => ({ rpc: 'reverse_card', args: { play: id(r, 'play') } }),
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
