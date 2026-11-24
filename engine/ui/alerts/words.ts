/**
 * The words of an Alerts row (the alerts plan, Task 9; the alerts design, sections 2, 4, 9 and 12): each kind's line, its detail and its ways
 * (a link, or the way out the row offers), from the row (`Alert`) and the public Acts it names. Plain and true ("The fiction may lie; the log
 * never does"): no line names a caster or a reactor, and none depends on anything private; every name here is the player's own character's, a
 * thread's title or the target's public name.
 */
import type { Act, Alert, Id } from '../data/api.ts';
import type { Instance } from '../../rules/types.ts';
import type { InstanceUi } from '../types.ts';
import { FOLLOWED_COUNT_CAP } from '../data/api.ts';
import { pageOf, threadHref } from '../thread/pages.ts';
import { shortQuote, springConditions } from '../cards/lens-words.ts';
import { upperFirst } from '../copy-words.ts';
import { inSentence, lockoutEnd, plain, utcDay } from '../log/lines.ts';

/** A run of words: plain, or a title set in italics, as the board draws it. */
export type Part = string | { readonly em: string };
/** A link a row offers. `state` is what the navigation carries (router.tsx). */
export interface Way { readonly text: string; readonly to: string; readonly state?: unknown }
export interface Said {
  readonly line: readonly Part[];
  readonly detail: readonly Part[];
  readonly ways: readonly Way[];
  /** The tag at the row's right: the character it concerns, or whose it is. */
  readonly who: string;
}
export interface WordsContext {
  readonly instance: Pick<Instance, 'cards'> & Partial<Pick<Instance, 'groups'>>;
  readonly ui: Pick<InstanceUi, 'copy'>;
  /** The Acts the rows name, and the Acts those name (a card's post). */
  readonly acts: ReadonlyMap<Id, Act>;
  /** The furthest seq read in each followed thread (a thread never read is absent); null where it could not be read. */
  readonly reading: Readonly<Record<Id, number>> | null;
  /** Followed thread -> the name of the player's own character that started it (a public fact, the thread's first post); absent for a thread followed by choice. */
  readonly startedBy: ReadonlyMap<Id, string>;
  readonly perPage: number;
  /** Public names of the characters whose posts a row names, where it needs them (a card an admin ended names the post's author). */
  readonly names?: ReadonlyMap<Id, string>;
  /** The settlement id (a row's `sub`) of the newest settlement, which `/log/settlement` shows. */
  readonly newestSettlement: string | null;
  /** The staff characters among `names` (a public fact of a character): a staff setter's catching set card takes nothing. Absent, none is known to be staff. */
  readonly staff?: ReadonlySet<Id>;
  /** The names of the Mods by staff key (public, a staff character's): the infraction of a warning names its Mod by key, not by character. */
  readonly staffNames?: ReadonlyMap<string, string>;
  /** Public names of the boards a moved thread's move names, by id. */
  readonly boards?: ReadonlyMap<Id, string>;
  /** Public titles of the threads a move names (a thread moved): the row's own thread is the move's, in Announcements, so the thread that moved is named by the page. */
  readonly threadTitles?: ReadonlyMap<Id, string>;
}

export const plainText = (parts: readonly Part[]): string => parts.map((p) => (typeof p === 'string' ? p : p.em)).join('');

/** Sentences in a row, a space between those that are not empty. */
const sentences = (...groups: readonly (readonly Part[])[]): Part[] => groups.filter((g) => g.length > 0).flatMap((g, i) => (i === 0 ? [...g] : [' ', ...g]));
const inTitle = (row: Alert, tail = '.'): Part[] => (row.title ? ['In ', { em: row.title }, tail] : []);
const threadWay = (row: Alert): Way[] => (row.thread ? [{ text: 'Go to the thread', to: `/t/${row.thread}` }] : []);
const ownPost = (name: string | null) => (name ? `${name}'s post` : 'your post');

/** A post's number in words: "Pipewrench's post #43", else "a post of Pipewrench's" when the post could not be read. */
function postWords(name: string | null, post: Act | undefined): string {
  if (post && post.seq !== null) return `${ownPost(name)} #${post.seq}`;
  return name ? `a post of ${name}'s` : 'your post';
}
const postHref = (post: Act, ctx: WordsContext) => threadHref(post.thread, pageOf(post.seq!, ctx.perPage), post.seq!);

/** The way to a post: the post itself where its number is known, else its thread. */
function postWay(post: Act | undefined, row: Alert, ctx: WordsContext): Way[] {
  if (post && post.seq !== null) return [{ text: 'Go to the post', to: postHref(post, ctx) }];
  return threadWay({ ...row, thread: post?.thread ?? row.thread });
}

/** The post an Act is about: itself, or the post a card was played on. */
const aboutPost = (a: Act | undefined, ctx: WordsContext): Act | undefined => (a?.kind === 'card' && a.targetActId ? ctx.acts.get(a.targetActId) : a);

const cardName = (key: unknown, ctx: WordsContext): string | null => ctx.instance.cards.find((c) => c.key === key)?.name ?? null;


/**
 * A lockout back's spring: the Move it let land locks its character out of the spring's thread until `until` (public as the Move is). `play` is the spring's `by`;
 * `ended` is when an admin ended it early, from a `card_end` on the spring, where one is held. Read from the spring's own `did`, never from a card's key.
 */
function lockoutOf(spring: Act | undefined, ctx: WordsContext): { spring: Act; until: string; play: Act | undefined; caster: string | null; ended: string | null } | null {
  if (!spring || spring.kind !== 'spring' || spring.payload.did !== 'lockedOut' || typeof spring.payload.until !== 'string') return null;
  const play = typeof spring.payload.by === 'string' ? ctx.acts.get(spring.payload.by) : undefined;
  const locks = typeof spring.payload.locks === 'string' ? spring.payload.locks : play?.character ?? null;
  const t = lockoutEnd(spring, ctx.acts);
  return { spring, until: t.until, play, caster: locks === null ? null : ctx.names?.get(locks) ?? null, ended: t.ended };
}
const adminEnded = (l: { ended: string | null }): string[] => (l.ended === null ? [] : [`An admin ended it at ${l.ended}.`]);

/** A card play's parts: its name, where it landed, the detail and the way to it. Null when the play could not be read. */
function cardOn(row: Alert, ctx: WordsContext): { card: string; place: Part[]; detail: Part[]; ways: Way[] } | null {
  const play = row.act === null ? undefined : ctx.acts.get(row.act);
  if (!play) return null;
  const card = cardName(play.payload.card, ctx) ?? 'A card';
  const id = (key: string) => (typeof play.payload[key] === 'string' ? play.payload[key] as Id : null);
  const said = typeof play.payload.targetName === 'string' && play.payload.targetName !== '' ? play.payload.targetName : null;
  switch (play.payload.reach) {
    case 'character': {
      const target = id('character');
      const name = said ?? row.name ?? 'your character';
      return { card, place: [name], detail: ['It was played on your character, not on a post.'], ways: target ? [{ text: `Go to ${name}`, to: `/c/${encodeURIComponent(target)}` }] : [] };
    }
    case 'thread': {
      const target = id('thread');
      const title = said ?? row.title ?? 'your thread';
      return { card, place: [{ em: title }], detail: ['Your character started this thread.'], ways: target ? [{ text: 'Go to the thread', to: threadHref(target, 1) }] : threadWay(row) };
    }
    default: {
      const post = play.targetActId ? ctx.acts.get(play.targetActId) : undefined;
      return { card, place: [postWords(row.name, post)], detail: inTitle(row), ways: postWay(post, row, ctx) };
    }
  }
}

/** The parts of a card an admin ended: what it was played on, said by the target's public name, and the way to it. */
function endedOn(row: Alert, play: Act, ctx: WordsContext): { place: Part[]; ways: Way[] } {
  const said = typeof play.payload.targetName === 'string' && play.payload.targetName !== '' ? play.payload.targetName : null;
  const id = (key: string) => (typeof play.payload[key] === 'string' ? play.payload[key] as Id : null);
  switch (play.payload.reach) {
    case 'character': { const target = id('character'); const name = said ?? (target ? ctx.names?.get(target) : undefined) ?? 'a character'; return { place: [name], ways: target ? [{ text: `Go to ${name}`, to: `/c/${encodeURIComponent(target)}` }] : [] }; }
    case 'thread': { const target = id('thread'); return { place: ['the thread ', { em: said ?? row.title ?? 'a thread' }], ways: target ? [{ text: 'Go to the thread', to: threadHref(target, 1) }] : [] }; }
    case 'board': return { place: [`the ${said ?? 'a'} board`], ways: [] };
    default: {
      const post = play.targetActId ? ctx.acts.get(play.targetActId) : undefined;
      const author = post?.character == null ? undefined : ctx.names?.get(post.character);
      const own = post?.character != null && post.character === row.character;
      return { place: [own ? 'your post' : author ? `${author}'s post` : 'a post'], ways: postWay(post, row, ctx) };
    }
  }
}

/** The key the cards of one target share, so a page can batch them; null for a row that is not a card on something that can be told. A drawing batches per wall (`wall:<the play>`), a gift per drive (`drive:<the drive's opening play>`). */
export function targetKey(row: Alert, ctx: WordsContext): string | null {
  if (row.act === null) return null;
  if (row.kind === 'gift' || (row.kind === 'cardOnYours' && row.sub === 'drew')) {
    const target = ctx.acts.get(row.act)?.targetActId;
    return target ? `${row.kind === 'gift' ? 'drive' : 'wall'}:${target}` : null;
  }
  if (row.kind !== 'cardOnYours') return null;
  const play = ctx.acts.get(row.act);
  if (!play) return null;
  const reach = typeof play.payload.reach === 'string' ? play.payload.reach : 'post';
  const target = reach === 'post' ? play.targetActId : play.payload[reach];
  return typeof target === 'string' && target !== '' ? `${reach}:${target}` : null;
}

/** Cards played on one target, as one row ("Glitter Bomb and 2 more were played on your post"); `rows` are newest first. */
export function batchWords(rows: readonly Alert[], ctx: WordsContext): Said {
  const newest = rows[0]!;
  if (rows.length > 1 && newest.kind === 'gift') return { line: [`${rows.length} gifts were given to the drive on ${postWords(newest.name, giftPost(newest, ctx))}`], detail: sentences(inTitle(newest)), ways: giftWay(newest, ctx), who: newest.name ?? 'Yours' };
  if (rows.length > 1 && newest.sub === 'drew') {
    const wall = drewOn(newest, ctx);
    return { line: [`${rows.length} drawings on the wall on ${wall.place}`], detail: sentences(inTitle(newest)), ways: wall.ways, who: newest.name ?? 'Yours' };
  }
  const on = cardOn(newest, ctx);
  if (!on || rows.length === 1) return wordsFor(newest, ctx);
  return {
    line: [`${on.card} and ${rows.length - 1} more were played on `, ...on.place],
    detail: sentences([`${rows.length} cards in all.`], on.detail),
    ways: on.ways,
    who: newest.name ?? 'Yours',
  };
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/** How long, in words: "less than a minute", "an hour", "five hours", "two days". */
export function spanWords(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'a moment';
  const unit = (n: number, one: string, many: string) => (n === 1 ? `${one === 'hour' ? 'an' : 'a'} ${one}` : `${count(n)} ${many}`);
  if (ms < 60_000) return 'less than a minute';
  if (ms < 3_600_000) return unit(Math.floor(ms / 60_000), 'minute', 'minutes');
  if (ms < 86_400_000) return unit(Math.floor(ms / 3_600_000), 'hour', 'hours');
  return unit(Math.floor(ms / 86_400_000), 'day', 'days');
}

/**
 * A face-down card struck the player: it landed on their quoting post (the card Act names its spring), or a catching set card caught their cast (the play
 * names the set that caught it), or a pierce got their cast past one (the play names the pierce, and nothing about the back). Each is a public Act, so nothing here is computed from a private fact: the setter is the character the spring
 * (or the set) names, never an account. A part that could not be read is left out, never guessed.
 */
function trapStruck(row: Alert, act: Act | undefined, ctx: WordsContext): Said {
  const who = row.name ?? 'Yours';
  /* A pierce got the cast past a card set face down: the Act's public `pierce` names the pierce card, and nothing about the back is told (it stays face down, and its setter is not told). */
  if (row.sub === 'passed' && act) {
    const pierce = act.payload.pierce;
    const pierceCard = cardName(typeof pierce === 'object' && pierce !== null ? (pierce as { card?: unknown }).card : undefined, ctx);
    const laid = cardName(act.payload.card, ctx);
    const own = ctx.ui.copy.alerts?.trapStruck?.({ how: 'passed', setter: null, card: pierceCard, laid, span: null, setterStaff: false });
    return {
      line: own ? [own.line] : [`Your ${pierceCard ?? 'card'} got your ${laid ?? 'card'} past a card set face down`],
      detail: own ? [own.detail] : sentences(["It stays face down and didn't spring, and whoever set it isn't told."], inTitle(row)),
      ways: postWay(act.targetActId ? ctx.acts.get(act.targetActId) : undefined, row, ctx), who,
    };
  }
  const springId = act && typeof act.payload.spring === 'string' ? act.payload.spring : null;
  const spring = springId ? ctx.acts.get(springId) : undefined;
  const caughtSet = act && typeof act.payload.caught === 'string' ? act.payload.caught : null;
  /* A cast that rode a ride back names the set whose spring it sprang (`rode`); the cast landed as usual, so it is no catch. */
  const rodeSet = act && typeof act.payload.rode === 'string' ? act.payload.rode : null;
  /* A cast a refund handed back names the play that handed it back (`handedBack.by`); the cast landed and its card went back to its caster. */
  const handed = act?.payload.handedBack;
  /* Only a card set face down that handed it back, where no ride back or catch already names the cast: a ride back that let it land is the spring that sprang, and a sign refunding it after is a use card, no face-down card. */
  const handedBy = typeof handed === 'object' && handed !== null && typeof (handed as { by?: unknown }).by === 'string' ? handed as { by: string; card?: unknown } : null;
  const handedSet = caughtSet === null && rodeSet === null && handedBy !== null && ctx.instance.cards.find((c) => c.key === handedBy.card)?.play === 'set' ? handedBy.by : null;
  const set = ctx.acts.get(caughtSet ?? rodeSet ?? handedSet ?? (typeof spring?.payload.set === 'string' ? spring.payload.set : ''));
  const setterId = spring?.character ?? set?.character ?? null;
  const setter = setterId === null ? null : ctx.names?.get(setterId) ?? null;
  const ended = spring ? Date.parse(spring.createdAt) : act ? Date.parse(act.createdAt) : NaN;
  const span = set && Number.isFinite(ended) ? spanWords(ended - Date.parse(set.createdAt)) : null;
  const laid = cardName(act?.payload.card, ctx);
  const setterStaff = setterId !== null && ctx.staff?.has(setterId) === true;
  /* A lockout back's spring is named by the caster's play (`lockedOut`), as a ride's set is (`rode`). */
  const locked = act && typeof act.payload.lockedOut === 'string' ? lockoutOf(ctx.acts.get(act.payload.lockedOut), ctx) : null;
  if (locked && act) {
    const post = act.targetActId ? ctx.acts.get(act.targetActId) : undefined;
    const owner = post?.character ? ctx.names?.get(post.character) ?? null : null;
    const where = post && post.seq !== null ? `${owner ? `${owner}'s post` : 'post'} #${post.seq}` : owner ? `a post of ${owner}'s` : 'that post';
    const card = cardName(locked.spring.payload.card, ctx);
    const lockSetter = locked.spring.character ?? null;
    const setterName = lockSetter === null ? null : ctx.names?.get(lockSetter) ?? null;
    const own = ctx.ui.copy.alerts?.trapStruck?.({ how: 'lockedOut', setter: setterName, card, laid, span: null, setterStaff: lockSetter !== null && ctx.staff?.has(lockSetter) === true, until: locked.until, ...(locked.ended === null ? {} : { ended: locked.ended }) });
    return {
      line: own ? [own.line] : [`${laid ? `Your ${laid}` : 'Your play'} set off ${setterName ? `${setterName}'s` : 'a'} face-down ${card ?? 'card'}`],
      detail: own ? sentences([own.detail], adminEnded(locked)) : sentences([`The ${card ?? 'card'} on ${where} locked ${who === 'Yours' ? 'your character' : who} out of this thread until ${locked.until}.`], adminEnded(locked), inTitle(row)),
      ways: postWay(post, row, ctx), who,
    };
  }
  if (handedSet !== null && act) {
    const own = ctx.ui.copy.alerts?.trapStruck?.({ how: 'returned', setter, card: null, laid, span, setterStaff });
    return {
      line: own ? [own.line] : [`${setter ? `${setter}'s` : 'A'} face-down card was waiting for your ${laid ?? 'card'}`],
      detail: own ? [own.detail] : sentences(['A card set face down on that post sprang on your cast. It landed, and your card is back in your hand.'], inTitle(row)),
      ways: postWay(act.targetActId ? ctx.acts.get(act.targetActId) : undefined, row, ctx), who,
    };
  }
  if (rodeSet !== null && act) {
    /* The setter's card is public once its spring is, and the spring is in hand only where it was read: it is named only then. */
    const sprung = [...ctx.acts.values()].find((a) => a.kind === 'spring' && a.payload.did === 'rode' && a.payload.by === act.id);
    const card = cardName(sprung?.payload.card, ctx);
    const own = ctx.ui.copy.alerts?.trapStruck?.({ how: 'rode', setter, card, laid, span, setterStaff });
    return {
      line: own ? [own.line] : [`${setter ? `${setter}'s` : 'A'} face-down ${card ?? 'card'} was waiting for your ${laid ?? 'card'}`],
      detail: own ? [own.detail] : sentences([`${laid ? `Your ${laid}` : 'Your card'} landed as usual, and you keep everything it earns.`], inTitle(row)),
      ways: postWay(act.targetActId ? ctx.acts.get(act.targetActId) : undefined, row, ctx), who,
    };
  }
  if (caughtSet !== null) {
    const post = act?.targetActId ? ctx.acts.get(act.targetActId) : undefined;
    const own = ctx.ui.copy.alerts?.trapStruck?.({ how: 'caught', setter, card: laid, laid: null, span, setterStaff });
    const when = `face down ${span ? `${span} before` : 'before'} you cast it`;
    const named = `it was waiting for ${laid ?? 'your card'}`;
    return {
      line: own ? [own.line] : [`${setter ? `${setter}'s` : 'A'} face-down trap caught your ${laid ?? 'card'}`],
      detail: own ? [own.detail] : sentences(
        [setter ? `${setter} set it ${when}, and ${named}.` : `It was set ${when}, and ${named}.`],
        [`${laid ? `Your ${laid}` : 'The card'} ${setterStaff ? 'is spent' : `is now ${setter ? `${setter}'s` : 'the setter\'s'}`}.`], inTitle(row)),
      ways: postWay(post, row, ctx), who,
    };
  }
  const card = cardName(spring?.payload.card, ctx);
  const on = cardOn(row, ctx);
  const place: Part[] = on ? on.place : [ownPost(row.name)];
  const matched = springConditions(spring?.payload ?? {});
  const passage = matched.passage ? shortQuote(matched.passage) : null;
  const says = matched.says ? shortQuote(matched.says) : null;
  const yourQuote = `your quote${passage ? ` of ${passage}` : ''}${says ? ` saying ${says}` : ''}`;
  const own = ctx.ui.copy.alerts?.trapStruck?.({ how: 'quote', setter, card, laid, span, setterStaff, passage, says });
  const subject = setter ? `${setter}'s face-down ${card ?? 'card'}` : card ? `A face-down ${card}` : 'A face-down card';
  return {
    line: own ? [own.line] : [`${subject} struck `, ...place],
    detail: own ? [own.detail] : sentences(
      [`${setter ? `${setter} set it face down${span ? ` ${span} before` : ' before'} ${yourQuote} set it off.` : `${span ? `It was set face down ${span} before ${yourQuote} set it off.` : `${upperFirst(yourQuote)} set it off.`}`}`],
      laid ? [`It laid ${laid} on it.`] : [], inTitle(row)),
    ways: on ? on.ways : threadWay(row), who,
  };
}


const possessive = (name: string | null, fallback: string) => (name ? `${name}'s` : fallback);
const isoDay = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? utcDay(v) : null);
const rulesOf = (n: unknown) => (typeof n === 'number' ? `rule ${n}` : 'a rule');
const points = (n: unknown) => (typeof n === 'number' ? `${n} warn ${n === 1 ? 'point' : 'points'}` : 'warn points');

/** Where a drawing landed: the wall's post, said by its author's public name, and the way to it. */
function drewOn(row: Alert, ctx: WordsContext): { place: string; ways: Way[] } {
  const draw = row.act === null ? undefined : ctx.acts.get(row.act);
  const wall = draw?.targetActId ? ctx.acts.get(draw.targetActId) : undefined;
  const post = wall?.targetActId ? ctx.acts.get(wall.targetActId) : undefined;
  return { place: post && post.seq !== null ? `${ownPost(row.name)} #${post.seq}` : ownPost(row.name), ways: postWay(post, row, ctx) };
}
/** A gift's post: the drive's, three links from the donation (donation, drive play, post), where it could be read. */
function giftPost(row: Alert, ctx: WordsContext): Act | undefined {
  const gift = row.act === null ? undefined : ctx.acts.get(row.act);
  const drive = gift?.targetActId ? ctx.acts.get(gift.targetActId) : undefined;
  return drive?.targetActId ? ctx.acts.get(drive.targetActId) : undefined;
}
/** A gift's way: the drive's post, where it could be read. */
const giftWay = (row: Alert, ctx: WordsContext): Way[] => postWay(giftPost(row, ctx), row, ctx);

const LOG: Way[] = [{ text: 'Open My log', to: '/log' }];

/** A ruling, one line per sub (the rulings design, section 7): plain, naming the character, its detail read from the Act where there is one. An unknown or null sub keeps the generic words. */
function rulingWords(row: Alert, act: Act | undefined, ctx: WordsContext): Said {
  const who = row.name ?? 'Yours';
  const name = row.name ?? 'your character';
  const mine = (line: string, detail: readonly Part[], ways: readonly Way[]): Said => ({ line: [line], detail: ways === LOG ? [...detail] : sentences(detail, inTitle(row)), ways, who });
  /* An infraction names the post it was filed on (`about_act`); a card's play, its post; else the post is the Act itself, or the thread. */
  const about = act?.kind === 'infraction' && typeof act.payload.about_act === 'string' ? ctx.acts.get(act.payload.about_act) : aboutPost(act, ctx);
  const post = postWay(about, row, ctx);
  const p = act?.payload ?? {};
  switch (row.sub) {
    case 'warning': {
      /* The Mod is named by its staff key (a Mod's, not a character's id), resolved from the page's staff names. */
      const staff = typeof p.staff === 'string' ? ctx.staffNames?.get(p.staff) : undefined;
      const drops = isoDay(p.expires_at);
      return mine(`${name} got ${points(p.points)}`, sentences(act ? [`${staff ? `${staff} filed` : 'A Mod filed'} ${rulesOf(p.rule_number)}.`] : [], drops ? [`They drop off ${drops}.`] : [], ['You can appeal from the post.']), post);
    }
    case 'ban': {
      const until = isoDay(p.until);
      return mine(until ? `${name} was banned until ${until}` : `${name} was banned`, ['The warn bar filled. The ban ends by itself; you can appeal it to the Boss.'], LOG);
    }
    case 'fallTaken': {
      const taker = typeof p.character === 'string' ? ctx.names?.get(p.character) : undefined;
      return mine(`${taker ?? 'Another character'} took the fall for ${ownPost(row.name)}`, [`The ${points(p.points)} landed on ${taker ?? 'them'}, not on ${name}.`], post);
    }
    case 'reportJudged': {
      /* The verdict is one of three (`visit`, `dismissed`, `backfire`); a visit is said only where the verdict names the one it opened (a report with no Mod to send, or whose post could not be visited, keeps `visit` and opens none). */
      const opened = typeof p.visit_act === 'string' && p.visit_act !== '';
      const result = p.verdict === 'dismissed' ? ': dismissed' : p.verdict === 'backfire' ? ': it backfired' : p.verdict === 'visit' ? (opened ? ': a Mod opened a visit to the post' : ', but no visit was opened') : '';
      return mine(`${possessive(row.name, 'Your')} report was judged${result}`, p.verdict === 'backfire' && opened ? ['A Mod opened a visit to your own latest post.'] : [], post);
    }
    case 'reportRefunded': return mine(`${possessive(row.name, 'Your')} report could not be heard`, ['Its cost was refunded.'], post);
    case 'appealAnswered': return mine(`${possessive(row.name, 'Your')} appeal was ${typeof p.verdict === 'string' ? p.verdict : 'answered'}`, [], LOG);
    case 'appealRefunded': return mine(`${possessive(row.name, 'Your')} appeal was not heard`, ['Its cost was refunded. You can appeal again.'], LOG);
    case 'grouped': {
      const params = (typeof p.params === 'object' && p.params !== null ? p.params : {}) as { group?: unknown };
      const groups = [...(ctx.instance.groups?.ladder ?? []), ...(ctx.instance.groups?.conferred ?? [])];
      const group = groups.find((g) => g.key === params.group)?.name;
      /* How it ends is said from what the move holds: its own end (`expires_at`, where it has one) and its demand (an accepted apology ends it); with neither, the log. An appeal or an apology is a punishment's way out, so a favor never offers one. */
      const tone = (ctx.instance.groups?.conferred ?? []).find((g) => g.key === params.group)?.tone;
      const ends = isoDay(p.expires_at);
      const demand = (typeof p.demand === 'object' && p.demand !== null ? (p.demand as { kind?: unknown }).kind : undefined) === 'apologyAccepted';
      const how = [...(ends ? [`It ends ${ends} by itself.`] : []), ...(demand ? ['It ends when an apology is accepted.'] : [])];
      return mine(`${name} was put in ${group ?? 'a group'}`, sentences(how.length > 0 ? [how.join(' ')] : ['The log says how it ends.'], tone === 'punishment' ? ['You can appeal it, or apologize.'] : []), LOG);
    }
    case 'threadMoved': {
      /* The alert's own thread is the move's (Announcements); the thread that moved, and the board it went to, are the move's params. */
      const params = (typeof p.params === 'object' && p.params !== null ? p.params : {}) as { board?: unknown; thread?: unknown };
      const board = typeof params.board === 'string' ? ctx.boards?.get(params.board) ?? null : null;
      const moved = typeof params.thread === 'string' && params.thread !== '' ? params.thread : null;
      const title = moved === null ? undefined : ctx.threadTitles?.get(moved);
      return { line: [title ? { em: title } : 'Your thread', board ? ` was moved to the ${board} board` : ' was moved to another board'], detail: [], ways: moved === null ? [] : [{ text: 'Go to the thread', to: `/t/${moved}` }], who };
    }
    case 'trophyReversed': return mine(`An admin took back a trophy from ${name}`, ['The log says which.'], LOG);
    case 'pollClosed': return mine(`An admin closed ${possessive(row.name, 'your')} poll`, [], post);
    case 'gearGiven': return mine(`An admin gave ${name} gear`, ['The log says what.'], LOG);
    default: return { line: [`A ruling landed on ${name}`], detail: sentences(['The ruling is public, on the board.'], inTitle(row)), ways: post, who };
  }
}

/** Real moderation of a post, in the glass's own plain voice: never in character. */
function conductWords(row: Alert, ctx: WordsContext, act: Act | undefined): Said {
  const own = ownPost(row.name);
  /* The Act of an edit's decision is the version (seq null); the post it is of is the edit's target. */
  const post = postWay(act?.kind === 'edit' && act.targetActId ? ctx.acts.get(act.targetActId) ?? act : act, row, ctx);
  const who = row.name ?? 'Yours';
  const said = (line: string, detail: readonly Part[] = []): Said => ({ line: [line], detail: sentences(detail, inTitle(row)), ways: post, who });
  switch (row.sub) {
    case 'hide': return said(`An admin hid ${own} for the code of conduct`);
    case 'hideUntilEdited': return said(`An admin hid ${own} until it is edited`, ['Edit the post to bring it back.']);
    case 'unhide': return said(`An admin brought back ${own}`);
    case 'approve': return said(`An admin approved the edit to ${own}`);
    default: return said(`A code of conduct decision on ${own}`);
  }
}

export function wordsFor(row: Alert, ctx: WordsContext): Said {
  const who = row.name ?? 'Yours';
  const act = row.act === null ? undefined : ctx.acts.get(row.act);
  switch (row.kind) {
    case 'quote':
      return {
        line: [`${ownPost(row.name)} was quoted`],
        detail: row.title ? ['In ', { em: row.title }, act && act.seq !== null ? `, post #${act.seq}.` : '.'] : [],
        ways: postWay(act, row, ctx), who,
      };
    case 'framed':
      /* Out of character and true: a post holds words put in this character's mouth. It never says who wrote them, or whether the character said them. */
      return {
        line: [`Someone put words in ${row.name ?? 'your character'}'s mouth`],
        detail: row.title ? ['In ', { em: row.title }, act && act.seq !== null ? `, post #${act.seq}.` : '.'] : [],
        ways: postWay(act, row, ctx), who,
      };
    case 'cardOnYours': {
      if (row.sub === 'drew') {
        const drawer = act?.character == null ? undefined : ctx.names?.get(act.character);
        const wall = drewOn(row, ctx);
        return { line: [`${drawer ?? 'A character'} drew on the wall on ${wall.place}`], detail: inTitle(row), ways: wall.ways, who };
      }
      const on = cardOn(row, ctx);
      if (!on) return { line: ['A card was played on something of yours'], detail: inTitle(row), ways: threadWay(row), who };
      return { line: [`${on.card} was played on `, ...on.place], detail: on.detail, ways: on.ways, who };
    }
    case 'cardEnded': {
      if (row.sub === 'refunded') return { line: [`Your ${cardName(act?.payload.card, ctx) ?? 'card'} did not take; it was refunded`], detail: inTitle(row), ways: postWay(act?.targetActId ? ctx.acts.get(act.targetActId) : undefined, row, ctx), who };
      if (row.sub === 'onYours') {
        const target = act?.targetActId ? ctx.acts.get(act.targetActId) : undefined;
        if (target?.kind === 'card') {
          const on = endedOn(row, target, ctx);
          return { line: [`An admin ended ${cardName(target.payload.card, ctx) ?? 'a card'} on `, ...on.place], detail: inTitle(row), ways: on.ways, who };
        }
        return { line: ['An admin ended a card on something of yours'], detail: inTitle(row), ways: threadWay(row), who };
      }
      const play = act?.targetActId ? ctx.acts.get(act.targetActId) : undefined;
      /* An admin's end of a lockout (the target is a lockedOut spring, the setter's Act): nothing was spent or lost, so none of a card's words about cost apply. */
      if (play?.kind === 'spring' && play.payload.did === 'lockedOut') {
        const post = play.targetActId ? ctx.acts.get(play.targetActId) : undefined;
        const owner = post?.character == null ? null : post.character === row.character ? 'your' : ctx.names?.get(post.character) ?? null;
        const where = post && post.seq !== null ? `${owner === 'your' ? 'your post' : owner ? `${owner}'s post` : 'post'} #${post.seq}` : 'a post';
        const locked = typeof play.payload.locks === 'string' ? ctx.names?.get(play.payload.locks) ?? null : null;
        return { line: [`An admin ended the lockout your ${cardName(play.payload.card, ctx) ?? 'card'} on ${where} put on ${locked ?? 'a character'}.`], detail: sentences([], inTitle(row)), ways: postWay(post, row, ctx), who };
      }
      if (!play || play.kind !== 'card') return { line: ['An admin ended your card.'], detail: sentences(['Its cost and the card are not refunded.'], inTitle(row)), ways: threadWay(row), who };
      const on = endedOn(row, play, ctx);
      return {
        line: [`An admin ended your ${cardName(play.payload.card, ctx) ?? 'card'} on `, ...on.place, '.'],
        detail: sentences(['Its cost and the card are not refunded.'], inTitle(row)), ways: on.ways, who,
      };
    }
    case 'trapStruck': return trapStruck(row, act, ctx);
    case 'trapSprang': {
      const post = act?.targetActId ? ctx.acts.get(act.targetActId) : undefined;
      const card = cardName(act?.payload.card, ctx);
      /* A spring written before the face-down Moves has no `did`: its words stay as they were. */
      const did = act?.kind === 'spring' ? act.payload.did : undefined;
      const locked = did === 'lockedOut' ? lockoutOf(act, ctx) : null;
      if (locked) {
        /* "Your post": the setter's own, where the Act that set it is not needed; the Move's card and its character are public with the Move. */
        const move = cardName(locked.play?.payload.card, ctx) ?? 'a Move';
        const who2 = locked.caster ?? 'someone';
        const where = post && post.seq !== null ? `your post #${post.seq}` : 'your post';
        return {
          line: [card ? `Your face-down ${card} sprang` : 'Your face-down card sprang'],
          detail: sentences([`${card ?? 'A card'} on ${where} sprang when ${who2} played ${move} on it. ${upperFirst(move)} landed, and ${who2} ${locked.ended === null ? 'is' : 'was'} locked out of the thread until ${locked.until}.`], adminEnded(locked), inTitle(row)),
          ways: postWay(post, row, ctx), who,
        };
      }
      if (did === 'landed' || did === 'caught' || did === 'ended' || did === 'rode' || did === 'returned') {
        const m = springConditions(act?.payload ?? {});
        const quote = `A quote${m.passage ? ` of ${shortQuote(m.passage)}` : ''}${m.says ? ` saying ${shortQuote(m.says)}` : ''}`;
        const set = did === 'landed' ? `${quote} set it off, and it landed.` : did === 'caught' ? 'A cast it was waiting for set it off, and the card is now in your hand.'
          : did === 'returned' ? 'A card it was waiting for was cast there and set it off. The cast landed, and its card went back to its caster.'
          : did === 'rode' ? (typeof act?.payload.quadrant === 'string' ? 'A cast of the card it named set it off. The cast landed, and its reactions of the kind you named pay you at each settlement.' : 'A card it was waiting for was cast there and set it off. The cast landed, and every reaction to it pays you at each settlement.') : 'A Mod Bot\'s visit set it off, and it ended the visit.';
        return { line: [card ? `Your face-down ${card} sprang` : 'Your face-down card sprang'], detail: sentences([set], inTitle(row)), ways: postWay(post, row, ctx), who };
      }
      return { line: ['Your trap sprang'], detail: sentences(card ? [`The trap was ${card}, in `, ...(row.title ? [{ em: row.title }] : ['a thread']), '.'] : inTitle(row)), ways: postWay(post ?? act, row, ctx), who };
    }
    case 'hint': {
      const own = row.sub === null ? undefined : ctx.ui.copy.alerts?.hint?.(row.sub, { card: act?.kind === 'card' });
      const post = aboutPost(act, ctx);
      return {
        line: [own ? own.line : `A pattern in the reactions to ${ownPost(row.name)}`],
        detail: own ? [own.detail] : sentences(['Counted from the reaction counts anyone can see on the post.'], inTitle(row)),
        ways: postWay(post, row, ctx), who,
      };
    }
    /* A trophy and a lost belt are the character's own player's: the Alert says which mask and which trophy (`sub`), and the log says who gave it or took it. */
    case 'trophy':
      return { line: [row.name !== null && row.sub !== null ? `${row.name} was given ${inSentence(row.sub)}` : 'One of your characters was given a trophy'], detail: ['The log says who gave it.'], ways: [{ text: 'Open My log', to: '/log' }], who };
    case 'beltBack':
      return { line: [row.name !== null && row.sub !== null ? `${row.name} holds ${inSentence(row.sub)} again` : 'One of your characters holds a belt again'], detail: ['The log says what changed.'], ways: [{ text: 'Open My log', to: '/log' }], who };
    case 'beltLost':
      return { line: [row.name !== null && row.sub !== null ? `${row.name} lost ${inSentence(row.sub)}` : 'One of your characters lost a belt'], detail: ['The log says who took it.'], ways: [{ text: 'Open My log', to: '/log' }], who };
    case 'ruling': return rulingWords(row, act, ctx);
    case 'gift': {
      /* `amount` and `arrives` are in hundredths; what arrives is nothing where the post's author is staff, so "reached" is said only for what did. */
      const amount = typeof act?.payload.amount === 'number' ? ` of ${plain(act.payload.amount)}` : '';
      const arrives = typeof act?.payload.arrives === 'number' ? act.payload.arrives : null;
      const went = arrives === null ? [] : arrives === 0 ? ['It all went to the drive\'s overhead.'] : [`${plain(arrives)} of it was sent to ${row.name ?? 'your character'}, after the drive's overhead.`];
      return { line: [`A gift${amount} was given to the drive on ${postWords(row.name, giftPost(row, ctx))}`], detail: sentences(went, inTitle(row)), ways: giftWay(row, ctx), who };
    }
    case 'conduct': return conductWords(row, ctx, act);
    case 'settlement': {
      const moved = row.count === 0 ? 'Crowd pay came in.' : row.count === null ? 'It moved your characters.' : `It moved ${row.count} of your characters.`;
      const newest = row.sub !== null && row.sub === ctx.newestSettlement;
      const id = Number(row.sub);
      return {
        line: ['A settlement is in'], detail: [moved],
        ways: newest ? [{ text: 'Open the summary', to: '/log/settlement' }] : Number.isInteger(id) ? [{ text: 'Open it in My log', to: '/log', state: { open: id } }] : [{ text: 'Open My log', to: '/log' }],
        who: 'All yours',
      };
    }
    case 'followed': {
      const n = row.count ?? 0;
      const count = n >= FOLLOWED_COUNT_CAP ? `${FOLLOWED_COUNT_CAP}+` : String(n);
      const thread = row.thread;
      const first = ctx.reading === null || thread === null ? null : (ctx.reading[thread] ?? 0) + 1;
      const by = thread === null ? undefined : ctx.startedBy.get(thread);
      return {
        line: [`${count} new ${n === 1 ? 'post' : 'posts'} in `, { em: row.title ?? 'a thread' }],
        detail: [by === undefined ? 'Since you last read it.' : `Since you last read it. You follow it because ${by} started it.`],
        ways: thread === null ? [] : first === null ? threadWay(row) : [{ text: 'First unread post', to: threadHref(thread, pageOf(first, ctx.perPage), first) }],
        who: by ?? 'Followed',
      };
    }
    case 'update':
      return {
        line: [`New update${row.name ? ` from ${row.name}` : ''}: “${row.title ?? ''}”`], detail: [],
        ways: row.act === null ? [] : [{ text: 'Read it in Updates', to: `/updates?update=${encodeURIComponent(row.act)}` }], who: 'Everyone',
      };
    case 'seasonNews': {
      const ways = [{ text: 'Read it on the Season page', to: '/season?tab=news' }];
      const n = row.count;
      const own = row.sub === null ? undefined : ctx.ui.copy.alerts?.seasonNews?.(row.sub, row);
      if (own) return { line: [own.line], detail: own.detail === '' ? [] : [own.detail], ways, who: 'Everyone' };
      switch (row.sub) {
        case 'results': return { line: ['The season\'s results are in'], detail: n === null ? [] : [`${n} characters ranked.`], ways, who: 'Everyone' };
        case 'tally': return { line: ['New debuts and Turns are in'], detail: n === null ? [] : [`${n} ${n === 1 ? 'character is' : 'characters are'} named.`], ways, who: 'Everyone' };
        case 'bossArrived': return { line: [row.name ? `A new Boss has arrived: ${row.name}` : 'A new Boss has arrived'], detail: [], ways, who: 'Everyone' };
        case 'bossLeft': return { line: [row.name ? `The Boss, ${row.name}, has left` : 'The Boss has left'], detail: [], ways, who: 'Everyone' };
        default: return { line: ['There is news for the season'], detail: [], ways, who: 'Everyone' };
      }
    }
  }
}
