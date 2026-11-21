/**
 * What the other players do while the camera runs (docs/plans/2026-11-21-commentary-video-plan.md, Task 4): the stage's parts, handed
 * to the page as `window.__kbStage.play` and driven by tools/hype/stage.mjs's `window.__shot`. Each is the backend's own action as the
 * player it names, so a reaction is scored, a cast is caught or rides, and a refusal throws, with the words the server would give. Where the
 * backend does not play a thing (a Move from a quote, a Mod's visit, a Boss's move), the part writes what the database's own code would have
 * written, as the backend's other stories seed it, and says so here.
 *
 * Every part signs in as the player behind the character it names, for the length of one call, and signs the film's player back in at once
 * (`inAs`), and the page is never told of the other player's session (stage-world.ts holds its session events to the film's player).
 */
import type { Act } from '../../../../engine/ui/data/api.ts';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import type { Instance } from '../../../../engine/rules/types.ts';
import LINES from './staff-lines.json';
import { GPT2_TAIL } from './gpt2.ts';
import { pendingOf } from './forecast.ts';
import { CHAIR_PHRASE, type Made } from './stage-world.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The quiz a Mod's visit may ask: the fixture's own (engine/ui/cards/Visit.board.stories.tsx, `QUIZ`, which that story file does not export; its
 * three strings copied here). The rehearsal's logs hold no text for a quiz (the design, section 5), so by the owner's leave this is the one
 * exception to "every word is the rehearsal's".
 */
export const QUIZ = { kind: 'quiz', question: 'Which form is used to request another form?', choices: ['Form 1-A', 'Form 0', 'Form 27-B/6'], answer: 'Form 0' } as const;

/** The Mods the staff helpers name, by the key they are made under in the stage's world, and the opener each uses where a call names none. */
const MODS = { qc: { key: 'qc', roster: 'quality-control', opener: 'openerQcHelp' }, ontopic: { key: 'ontopic', roster: 'ontopic', opener: 'openerOtLooking' } } as const;
export type ModName = keyof typeof MODS;

/** A line of staff-lines.json, by key: its words, who wrote it, and (for a filing) the post it was aimed at. */
interface Line { readonly text: string; readonly by: string; readonly points?: number; readonly band?: 'minor' | 'moderate' | 'severe'; readonly post?: { readonly by: string; readonly text: string; readonly board: string; readonly thread: string } | null }
const lineOf = (key: string): Line => {
  const l = (LINES as Record<string, Line | undefined>)[key];
  if (l === undefined) throw new Error(`staff-lines.json has no line "${key}": its lines are ${Object.keys(LINES).join(', ')}`);
  return l;
};

/** The thread a board's visit is on where a call names no post: written for the video, in the cast's voices, on the board the Mod's line names. */
const BOARD_THREADS: Readonly<Record<string, { readonly title: string; readonly open: readonly [string, string]; readonly reply: readonly [string, string] }>> = {
  Help: { title: 'my wiggler crashes the editor when it blinks', open: ['Serious Deer', 'Help. Every time the Wiggler blinks, the editor closes. Twelve frames, one crash. I have no idea why.'], reply: ['Snuckles', 'It is the blink frame. I am almost sure it is the blink frame. Please tell me it is the blink frame.'] },
  'Movies & TV': { title: 'Watched the new monster movie last night', open: ['Serious Deer', 'Watched the new monster movie last night. The monster walks like a twelve-frame sprite and I loved it.'], reply: ['Snuckles', 'I also watched a movie. It was fine. I am being normal about it.'] },
  'Video Games': { title: 'What are you playing this week?', open: ['Serious Deer', 'What is everybody playing this week? I am playing a platformer with a very good walk cycle.'], reply: ['Snuckles', 'Playing my own sprite sheet, which is not a game, but I am playing it anyway.'] },
  'Arts & Crafts': { title: 'Pixel art WIP, feedback welcome', open: ['Serious Deer', 'Pixel art WIP, a Wiggler, twelve frames. Feedback welcome.'], reply: ['Snuckles', 'It is wonderful and I will say so every time.'] },
  'Pointless Post Palace': { title: 'count to 1000 one post at a time', open: ['Serious Deer', '1'], reply: ['Snuckles', '2'] },
};

/** The thread, the opening post and the post a filing was aimed at, for each filing: written for the video, around the aimed-at post's own words (from the log). */
const FILING_OPENERS: Readonly<Record<string, readonly [string, string]>> = {
  filingQcHelp: ['Snuckles', 'My game crashes the moment the player jumps. Second jump, every time. I have no idea why.'],
  filingQcGames: ['Human Josh', 'What is everybody playing this week? I am playing a game. As a human, I enjoy that.'],
  filingQcGotcha: ['Snuckles', 'Pixel art WIP, a Wiggler, twelve frames. Feedback welcome.'],
  filingOtThematic: ['Human Josh', 'Shows you quit after one episode. Mine is all of them.'],
  filingOtPatience: ['Serious Deer', 'My comfort rewatch is the same movie every winter. What is yours?'],
  filingOtPalace: ['Human Josh', '1'],
};

/** What a cast came to: the play, and whether a back caught it or let it ride. */
export interface Cast { readonly play: string; readonly caught: boolean; readonly rode: boolean }

/** A beat that landed: what it was, and when on the page's clock (a frame at 60 a second from `zero`). */
export interface Landed { readonly what: string; readonly ms: number; readonly frame: number }

/** The steps of node 9's pile, in the order they land on Snuckles's first post: who plays each, which card, and what it is called. */
export const PILE: readonly { readonly what: string; readonly by: string; readonly card: string; readonly config?: Readonly<Record<string, unknown>>; readonly message?: string; readonly reach?: 'character'; readonly lastsMs?: number }[] = [
  { what: 'whoops-1', by: 'D-Guy', card: 'whoops', config: { color: '#ff2bd6', seed: 101 } },
  { what: 'whoops-2', by: 'Serious Deer', card: 'whoops', config: { color: '#19e3ff', seed: 202 } },
  { what: 'whoops-3', by: 'Chadluminum', card: 'whoops', config: { color: '#ffd93d', seed: 303 } },
  { what: 'steel-chair-1', by: 'Serious Deer', card: 'steel-chair' },
  { what: 'steel-chair-2', by: 'Human Josh', card: 'steel-chair' },
  { what: 'steel-chair-3', by: 'Chadluminum', card: 'steel-chair' },
  /* The smoke thins as the card's days pass; the film's pile lets it last seconds, so the heap under it comes back into view. */
  { what: 'hot-box', by: 'D-Guy', card: 'hot-box', config: { color: '#32cd32' }, lastsMs: 7000 },
  { what: 'laugh-track', by: 'Serious Deer', card: 'laugh-track', config: { cues: [{ phrase: 'his legs move', sound: 'laugh' }], seed: 7 }, message: 'Laugh Track' },
  { what: 'jimmy-wails', by: 'Serious Deer', card: 'jimmy-wails', message: 'Please. He spent two weeks on twelve frames.' },
  { what: 'you-were-saying', by: 'Serious Deer', card: 'you-were-saying', config: { steps: 0 }, message: '' },
  { what: 'off-day', by: 'D-Guy', card: 'off-day', config: { class: 'face' }, reach: 'character' },
  { what: 'stick-around', by: 'D-Guy', card: 'stick-around', config: { sentence: 'I have read the whole walk cycle and I feel changed.' }, message: 'required reading' },
];

/**
 * The order the film lands the pile's plays in (tools/hype/shot-commentary-3.mjs reads it from the page): node 9 lands all twelve on a fresh
 * post, a play about every 1.4 s with Stick Around last; node 11's one page lands the three chairs in its first stretch and the heap in its fourth.
 */
export const FILM_ORDER = {
  n09: ['whoops-1', 'steel-chair-1', 'whoops-2', 'steel-chair-2', 'laugh-track', 'whoops-3', 'steel-chair-3', 'jimmy-wails', 'you-were-saying', 'off-day', 'hot-box', 'stick-around'],
  n11: { chairs: ['steel-chair-1', 'steel-chair-2', 'steel-chair-3'], heap: ['whoops-1', 'whoops-2', 'whoops-3', 'laugh-track', 'jimmy-wails', 'you-were-saying', 'off-day'] },
} as const;

/**
 * The words the pile's You Were Saying? on post 1 runs on with: the first 300 characters of the card's real tail (gpt2.ts), which type in as the play
 * lands. (The tail is the continuation of another post, the stage's post `gpt2`; node 9's pile keeps its own post, so it types the head of the same real text.)
 */
const TAIL = GPT2_TAIL.slice(0, 300);

export function playbook(fake: Fake, instance: Instance, made: Made) {
  const landed: Landed[] = [];
  let zero = 0;
  const mark = (what: string): Landed => {
    const ms = performance.now() - zero;
    const entry = { what, ms, frame: Math.round((ms * 60) / 1000) };
    landed.push(entry);
    return entry;
  };
  const rules = (card: string) => instance.cards.find((c) => c.key === card);
  const ownerOf = (name: string): string => {
    const o = made.owners[name];
    if (o === undefined) throw new Error(`the stage has no character named "${name}": its characters are ${Object.keys(made.owners).join(', ')}`);
    return o;
  };
  const characterOf = (name: string): string => made.cast[name] ?? ownerOf(name);
  const actOf = async (seq: number): Promise<Act> => {
    const [a] = await fake.acts(made.thread, seq, seq);
    if (!a) throw new Error(`the thread has no post ${seq}`);
    return a;
  };
  /**
   * One call of the backend as `account`: the session is theirs while the call is made and the film's player's again at once. The backend runs a call's
   * body as it is made and answers a moment after, so nothing else runs while the session is the other player's, and the page is never told it was
   * (the world holds the session's changes to the film's player, stage-world.ts); a page that was told would draw the other player's screens.
   */
  const inAs = <T,>(account: string, call: () => Promise<T>): Promise<T> => {
    if (account === made.viewer) return call();
    fake.signInAs(account);
    try { return call(); } finally { fake.signInAs(made.viewer); }
  };
  /** Gives the account one more of a card when its hand holds none, and a wallet that covers a play: the film's casts are not about the economy. */
  const stocked = async (account: string, card: string) => {
    const hand = await inAs(account, () => fake.myCards());
    if (!hand.some((h) => h.card === card && h.held > 0)) fake.seed.cards(account, { ...Object.fromEntries(hand.map((h) => [h.card, h.held])), [card]: 1 });
    fake.seed.wallet(account, 500);
  };

  /** A reaction by a character of the cast, as its player: scored, counted and heard by the page like any other. */
  async function react(name: string, post: number, key: string): Promise<void> {
    const act = await actOf(post);
    const done = await inAs(ownerOf(name), () => fake.react(act.id, characterOf(name), key));
    if (!done.ok) throw new Error(`${name}'s ${key} on post ${post} was refused: ${done.error}`);
    mark(`react:${name}:${key}`);
  }

  /** A card cast on a post by a character of the cast, through the backend's own play: a back there catches it or lets it ride as the backend decides. */
  async function cast(name: string, post: number, card: string, config: Readonly<Record<string, unknown>> = {}, message = ''): Promise<Cast> {
    const act = await actOf(post);
    await stocked(ownerOf(name), card);
    const done = await inAs(ownerOf(name), () => fake.playCard(card, characterOf(name), act.id, config, message));
    if (!done.ok) throw new Error(`${name}'s ${card} on post ${post} was refused: ${done.error}`);
    const payload = done.value.payload as { caught?: unknown; rode?: unknown };
    mark(`cast:${name}:${card}`);
    return { play: done.value.id, caught: payload.caught !== undefined, rode: payload.rode !== undefined };
  }

  /** A post's own words, as a rule that reads words reads them: what is outside its real quotes. */
  const ownWords = (body: string): string => body.replace(/\[quote=[^\]]*\][\s\S]*?\[\/quote\]/gi, ' ');
  const bodyOf = (act: Act): string => String((act.currentPayload as { body?: unknown }).body ?? '');

  /**
   * The quoting post that springs a Move waiting on a phrase. The backend does not play a Move from a quote (its stories seed the
   * spring), so the post is written as the composer writes it (the Quote button's text, the whole post in a real quote, then the words, with
   * the quoted post as its `quoting`), and the spring and the card it landed are written as the server's `spring_traps` writes them: a spring
   * on the quoted post's back, and the Move played on the quoting one by the back's setter. A REAL quote springs a back; a forged one does not
   * (`forgedQuote`, below), and the words must say the phrase the back waits for (`CHAIR_PHRASE`).
   */
  async function quoteSprings(name: string, post: number, words: string): Promise<{ readonly post: string; readonly spring: string; readonly play: string }> {
    if (!words.toLowerCase().includes(CHAIR_PHRASE)) throw new Error(`${name}'s words do not say "${CHAIR_PHRASE}", so the chair waiting on post ${post} would not spring`);
    const quoted = await actOf(post);
    const wrote = await inAs(ownerOf(name), () => fake.post(made.thread, characterOf(name), `[quote=${quoted.id}]${bodyOf(quoted)}[/quote]\n${words}`, quoted.id));
    if (!wrote.ok) throw new Error(`${name}'s quote of post ${post} was refused: ${wrote.error}`);
    return { post: wrote.value.id, ...(await springsOn(post, wrote.value.id)) };
  }

  /**
   * The spring and landed Move for a quoting post that already exists (written by the real composer, say): the half of `quoteSprings`
   * after the writing. `quoted` is the number of the post it quotes. The rule the film follows is the database's (0393_forged_quotes.sql, a post
   * whose target is forged is written with no target, so no back springs): a post that quotes with no target, a forged quote, springs nothing,
   * and is refused here; so are words that do not say the back's phrase.
   */
  async function springsOn(quoted: number, quoting: string): Promise<{ readonly spring: string; readonly play: string }> {
    const quotedAct = await actOf(quoted);
    const set = made.sets['steelChair'];
    if (set === undefined) throw new Error('the stage has no Steel Chair set face down');
    const [on] = await fake.acts(made.thread, 1, 1000).then((all) => all.filter((a) => a.id === quoting));
    if (on === undefined) throw new Error(`there is no post ${quoting} in the thread to spring a chair on`);
    if (on.targetActId !== quotedAct.id) throw new Error(`post ${quoting} quotes no post (its quote is forged, or it quotes nothing): a forged quote springs nothing, so no chair is sprung on it`);
    if (!ownWords(bodyOf(on)).toLowerCase().includes(CHAIR_PHRASE)) throw new Error(`post ${quoting} does not say "${CHAIR_PHRASE}" outside its quote, so the chair would not spring`);
    fake.clock.advance(1000);
    const spring = fake.seed.spring(set, { trigger: 'quote' });
    const setter = quotedAct.character;
    if (setter === null) throw new Error(`post ${quoted} has no author to have set the card`);
    const play = fake.seed.card(setter, quoting, 'steel-chair', { layer: 1, message: '', spring, live: true, ends: new Date(Date.now() + 3 * DAY).toISOString() });
    fake.broadcast.rejoin();
    mark('spring');
    return { spring, play };
  }

  /**
   * A FORGED quote of a post, written as the composer writes it: a real quote tag naming the post, the words the post does not hold, then
   * the comment, with the quoted post as its `quoting`. The backend works the verdict out as the database does (`payload.forged`, and no target,
   * so nothing springs). Refuses words that do stand in the post, which would be a real quote. Returns the post's Act, its number and the verdict.
   */
  async function forgedQuote(name: string, post: number, forgedWords: string, comment: string): Promise<{ readonly post: string; readonly seq: number; readonly forged: readonly string[] }> {
    const quoted = await actOf(post);
    if (bodyOf(quoted).includes(forgedWords)) throw new Error(`"${forgedWords}" stands in post ${post}, so a quote of it is a real quote and would not be forged`);
    const wrote = await inAs(ownerOf(name), () => fake.post(made.thread, characterOf(name), `[quote=${quoted.id}]${forgedWords}[/quote]\n${comment}`, quoted.id));
    if (!wrote.ok) throw new Error(`${name}'s forged quote of post ${post} was refused: ${wrote.error}`);
    const forged = (wrote.value.payload as { forged?: readonly string[] }).forged ?? [];
    if (!forged.includes(quoted.id)) throw new Error(`the backend did not judge the quote of post ${post} forged (verdict: ${JSON.stringify(forged)})`);
    mark(`forged:${name}`);
    return { post: wrote.value.id, seq: wrote.value.seq!, forged };
  }

  /**
   * The alert a caught cast writes its caster. The backend's `play_card` writes it (a `trapStruck` on the caught play, 0370); the in-memory
   * backend writes none, so a stage that shows the caster's side of a catch writes what the database would have, on the newest cast of the
   * named character on the post that a back caught. It reaches the caster's page as a toast and a row in the alerts, as any alert does.
   */
  async function told(name: string, post: number): Promise<string> {
    const act = await actOf(post);
    const caught = (await fake.cardsOn(act.id, 30)).filter((a) => a.kind === 'card' && a.character === characterOf(name) && (a.payload as { caught?: unknown }).caught !== undefined).at(-1);
    if (caught === undefined) throw new Error(`${name} has no caught cast on post ${post}: nothing was caught to tell them of`);
    fake.seed.alert(ownerOf(name), { kind: 'trapStruck', act: caught.id });
    mark(`told:${name}`);
    return caught.id;
  }

  /** The name of the cast's character with this id. */
  const nameOf = (character: string): string => {
    const found = Object.entries(made.cast).find(([, id]) => id === character)?.[0];
    if (found === undefined) throw new Error(`character ${character} is not one of the stage's cast`);
    return found;
  };
  /** The post's number in its thread. */
  const seqIn = async (thread: string, post: string): Promise<number> => {
    const found = (await fake.acts(thread, 1, 500)).find((a) => a.id === post);
    if (found?.seq == null) throw new Error(`post ${post} is not in thread ${thread}`);
    return found.seq;
  };
  /** A thread the stage makes later is named in `made.threads` (as the merge's announcements are), for `show('thread:<key>')`. */
  const register = (key: string, thread: string): string => { (made.threads as Record<string, string>)[key] = thread; return key; };
  /** The stage's board with this name (made in its world), or the instance's own General. */
  const slugOf = (board: string): string => {
    const slug = made.lineBoards[board];
    if (slug === undefined) throw new Error(`the stage has no board named "${board}": its boards are ${Object.keys(made.lineBoards).join(', ')}`);
    return slug;
  };
  /** The post `by` writes in a thread: written as the seed writes a post (the other players' words are the video's), dated now. */
  const writes = (thread: string, by: string, words: string): string => { fake.clock.advance(1000); return fake.seed.post(thread, characterOf(by), words); };
  /** A thread on a board of the stage, opened by `by`; returns its id and the opening post's. */
  const opens = (board: string, by: string, title: string, words: string): { thread: string; act: string } => { fake.clock.advance(1000); return fake.seed.thread(slugOf(board), characterOf(by), title, words); };
  const modOf = (mod: ModName): string => made.staff[MODS[mod].key]!;
  /** The board a Mod's opening line names: "…the premise of Help." */
  const boardOf = (line: string): string => {
    const board = /premise of (.+?)\./u.exec(line)?.[1];
    if (board === undefined || made.lineBoards[board] === undefined) throw new Error(`the opening line "${line}" names no board the stage has`);
    return board;
  };
  const OTHERS = ['Serious Deer', 'Human Josh', 'Chadluminum', 'D-Guy', 'Snuckles'];

  /** What every helper that starts a visit returns: where it is on the stage, and the key to `show('thread:<key>')` where it is not in the main thread. */
  interface Where { readonly thread: string; readonly key: string; readonly post: string; readonly seq: number; readonly visit: string; readonly line: string; readonly board: string }

  /**
   * A Mod's visit begun on a post: the `visit` Act as `start_visit` writes it, charged with the premise of the board the opening line names (a patrol), ending
   * in three hours. The backend does not play a Mod's visit, so the part writes what the database's own code would have (as the stories seed it).
   */
  async function begin(mod: ModName, post: string, line: string, board: string, challenge: { readonly kind: 'distraction' } | typeof QUIZ, band: 'minor' | 'moderate' | 'severe' = 'minor'): Promise<string> {
    fake.clock.advance(1000);
    return fake.seed.visit(modOf(mod), post, { endsInMs: 3 * HOUR, line, charges: [{ rule: `the premise of ${board}`, ruleNumber: null, band, cause: 'patrol' }], challenge });
  }
  /** The post a visit is on: the main thread's post `seq`, or (where none is named) a thread of the opening line's board, `by` replying in it. */
  async function placed(board: string, seq: number | null, by: string, key: string): Promise<{ thread: string; key: string; post: string; seq: number }> {
    if (seq !== null) { const act = await actOf(seq); return { thread: made.thread, key: 'main', post: act.id, seq }; }
    const t = BOARD_THREADS[board];
    if (t === undefined) throw new Error(`the stage has no thread for the board "${board}"`);
    const opened = opens(board, t.open[0] === by ? OTHERS.find((n) => n !== by)! : t.open[0], t.title, t.open[1]);
    const post = writes(opened.thread, by, t.reply[1]);
    return { thread: opened.thread, key: register(key, opened.thread), post, seq: await seqIn(opened.thread, post) };
  }

    /**
     * A Mod files a post: the visit, its end with the filing's own words, and the infraction (its points and band, from the log), so the post's author's warn bar rises. `key` is a
     * filing of staff-lines.json (`filingQcHelp`, `filingQcGames`, `filingQcGotcha` for QC-1000; `filingOtThematic`, `filingOtPatience`, `filingOtPalace` for ONTOPIC 5.0). With no
     * `postSeq` the helper writes the post the filing was aimed at: the log's own words, by the cast member the log's poster is recast as (`by` names another, so the film's own
     * character's bar can rise), in a thread on the board the line names. The bar shows on the HUD of the character's player (`as=`). Returns where it is and the infraction's Act.
     */
  async function filing(mod: ModName, postSeq: number | null, key: string, options: { readonly by?: string; readonly hold?: boolean } = {}): Promise<Where & { readonly infraction: string }> {
      const l = lineOf(key);
      if (l.by !== MODS[mod].roster) throw new Error(`"${key}" is ${l.by}'s filing, not ${mod}'s`);
      if (l.post === undefined || l.post === null) throw new Error(`"${key}" is not a filing: it has no post it was aimed at`);
      const aimed = l.post;
      let where: { thread: string; key: string; post: string; seq: number };
      if (postSeq !== null) {
        const act = await actOf(postSeq);
        where = { thread: made.thread, key: 'main', post: act.id, seq: postSeq };
      } else {
        const by = options.by ?? aimed.by;
        const [openBy, openText] = FILING_OPENERS[key] ?? ['Serious Deer', 'Opening a thread.'];
        const opened = opens(aimed.board, openBy === by ? OTHERS.find((n) => n !== by)! : openBy, aimed.thread, openText);
        const post = writes(opened.thread, by, aimed.text);
        where = { thread: opened.thread, key: register(`filing-${key}`, opened.thread), post, seq: await seqIn(opened.thread, post) };
      }
      const opener = Object.keys(LINES).filter((k) => k.startsWith(mod === 'qc' ? 'openerQc' : 'openerOt')).find((k) => boardOf(lineOf(k).text) === aimed.board) ?? MODS[mod].opener;
      const line = lineOf(opener).text;
      const board = boardOf(line);
      const visit = await begin(mod, where.post, line, aimed.board, { kind: 'distraction' }, l.band ?? 'minor');
      /* `hold`: the post is written and the visit is open, and nothing is filed yet (`endFiling(key, visit)` files it, so a film can see the filing arrive and the warn bar rise). */
      if (options.hold === true) { fake.broadcast.rejoin(); return { ...where, visit, line, board, infraction: '' }; }
      const infraction = await endFiling(key, visit);
      return { ...where, visit, line, board, infraction };
    }
    /** The visit `visit` ends in the filing `key` (the log's own words, points and band), and its infraction is written: what `filing` does after the visit begins. Returns the infraction's Act. */
    async function endFiling(key: string, visit: string): Promise<string> {
      const l = lineOf(key);
      fake.clock.advance(1000);
      fake.seed.visitEnd(visit, { outcome: 'filed', line: l.text });
      const infraction = fake.seed.infraction(visit, { points: l.points ?? 2, band: l.band ?? 'minor', ruleNumber: null });
      fake.broadcast.rejoin();
      mark(`staff:filing:${key}`);
      return infraction;
    }

  async function springPass(set: string, visit: string): Promise<string> {
    fake.clock.advance(1000);
    const spring = fake.seed.spring(set, { trigger: 'visit' });
    fake.seed.visitEnd(visit, { outcome: 'trapped', by: spring, line: '' });
    fake.broadcast.rejoin();
    mark('staff:hall-pass');
    return spring;
  }

  /** The Staff's beats, each as the seed writes it where the backend plays none, and the page told to catch up. */
  const staff = {
    /** One of the Boss's memos (FanGaME's own, or one of his memos to a Mod: `orderNoAllowance`, `orderHoneymoon`, `orderQuote`), posted in a thread of the stage (the main one unless `where` names another). */
    async memo(where = 'main', key = 'memo'): Promise<string> {
      const thread = made.threads[where];
      if (thread === undefined) throw new Error(`the stage has no thread "${where}"`);
      fake.clock.advance(1000);
      const id = fake.seed.staffPost(made.staff['fangame']!, thread, lineOf(key).text);
      fake.broadcast.rejoin();
      mark(`staff:memo:${key}`);
      return id;
    },
    /**
     * A member of the Staff posts one of the rehearsal's lines in a thread of the stage, now: \`say('fangame', 'announcements', 'posted')\`. \`who\` is a key of \`made.staff\` (fangame, qc, ontopic), \`where\` a thread
     * the stage names (\`made.threads\`, which a beat's own result adds to) and \`key\` a line of staff-lines.json. A film uses it for a post that must ARRIVE while the camera watches the thread. Returns the post's Act.
     */
    async say(who: string, where: string, key: string): Promise<string> {
      const staffer = made.staff[who];
      if (staffer === undefined) throw new Error(`the stage has no staff member "${who}": they are ${Object.keys(made.staff).join(', ')}`);
      const thread = made.threads[where];
      if (thread === undefined) throw new Error(`the stage has no thread "${where}": its threads are ${Object.keys(made.threads).join(', ')}`);
      fake.clock.advance(1000);
      const id = fake.seed.staffPost(staffer, thread, lineOf(key).text);
      fake.broadcast.rejoin();
      mark(`staff:say:${key}`);
      return id;
    },
    /** The Boss merges the Palace into World -1, with his reason (the rehearsal's) on the move's notice; the closed board links where its threads went. */
    async merge(): Promise<string> {
      const { palace, minus } = made.boards;
      for (const [slug, name, description] of [[palace, 'Plumber Platformer Palace', 'A board for Mario fangames.'], [minus, 'World -1', 'Everything that is not a Mario fangame.']] as const) {
        try { fake.seed.board(slug, name, description); } catch (e) { if (!/already/.test(String(e))) throw e; /* made already: the world's own seed says "there is a board … already" */ }
      }
      fake.clock.advance(1000);
      const move = fake.seed.move('fangame', { board: '', name: '', body: LINES.merged.text, lasting: { kind: 'mergeBoard', params: { board: palace, into: minus } } });
      fake.seed.closeBoard(palace, { mergedInto: minus });
      fake.broadcast.rejoin();
      /* The move's notice is posted in the Staff Announcements thread: the stage can show it (`show('thread:announcements')`). */
      const announcements = (await fake.boardPage('announcements', 1, []))?.threads[0]?.id;
      if (announcements !== undefined) register('announcements', announcements);
      mark('staff:merge');
      return move;
    },
    /** The Boss makes a board, with his reason (the rehearsal's: "The board is arguing whether a fangame is a video game…") on the move's notice in the announcements. Returns the move's Act. */
    async created(name = 'World -1 Annex'): Promise<string> {
      fake.clock.advance(1000);
      const move = fake.seed.move('fangame', { board: '', name: '', body: LINES.created.text, lasting: { kind: 'createBoard', params: { name, premise: 'Everything else.', description: 'Everything that is not a Mario fangame.' } } });
      fake.broadcast.rejoin();
      const announcements = (await fake.boardPage('announcements', 1, []))?.threads[0]?.id;
      if (announcements !== undefined) register('announcements', announcements);
      mark('staff:created');
      return move;
    },
    /** The Boss moves a thread ("Watched the new monster movie last night", on Movies & TV) to World -1, with his reason. Returns the move's Act and the thread. */
    async moved(): Promise<{ readonly move: string; readonly thread: string }> {
      const { minus } = made.boards;
      try { fake.seed.board(minus, 'World -1', 'Everything that is not a Mario fangame.'); } catch (e) { if (!/already/.test(String(e))) throw e; }
      const t = BOARD_THREADS['Movies & TV']!;
      const opened = opens('Movies & TV', 'Human Josh', t.title, t.open[1]);
      fake.clock.advance(1000);
      fake.seed.moveThread(opened.thread, minus);
      const move = fake.seed.move('fangame', { board: '', name: '', body: LINES.moved.text, lasting: { kind: 'moveThread', params: { thread: opened.thread, board: minus } } });
      fake.broadcast.rejoin();
      const announcements = (await fake.boardPage('announcements', 1, []))?.threads[0]?.id;
      if (announcements !== undefined) register('announcements', announcements);
      register('moved', opened.thread);
      mark('staff:moved');
      return { move, thread: opened.thread };
    },
    /** A Mod files Snuckles's first post: its visit, the visit's end and the infraction it wrote. The words are the rehearsal's (an opener and a filing of ONTOPIC 5.0's). */
    async file(post = 1): Promise<string> {
      const act = await actOf(post);
      fake.clock.advance(1000);
      const visit = fake.seed.visit(made.staff['ontopic']!, act.id, { endsInMs: HOUR, line: LINES.openerOtLooking.text });
      fake.seed.visitEnd(visit, { outcome: 'filed', line: LINES.filingOtPatience.text });
      fake.seed.infraction(visit, { points: 3 });
      fake.broadcast.rejoin();
      mark('staff:file');
      return visit;
    },
    /**
     * A Mod's visit opens: its mark on a post, its countdown, the Lens open on its opener, a real line of the rehearsal's (`line`: a key of staff-lines.json, `openerQcHelp` by default for
     * QC-1000 and `openerOtLooking` for ONTOPIC 5.0). With no `postSeq` the visit is on a post of a thread of the board the line names (Help, Movies & TV, ...), the film's own
     * Snuckles (or `by`) the author; `postSeq` names a post of the main thread instead. `quiz` makes the visit's challenge the fixture's quiz (QUIZ), the Lens then shows its choices.
     * The thread is `show('thread:<key>')` where it is not the main one.
     */
    async visit(mod: ModName, postSeq: number | null = null, options: { readonly quiz?: boolean; readonly line?: string; readonly by?: string } = {}): Promise<Where> {
      const key = options.line ?? MODS[mod].opener;
      const line = lineOf(key).text;
      const board = boardOf(line);
      const where = await placed(board, postSeq, options.by ?? 'Snuckles', 'visit');
      const visit = await begin(mod, where.post, line, board, options.quiz ? QUIZ : { kind: 'distraction' });
      fake.broadcast.rejoin();
      mark(`staff:visit:${mod}`);
      return { ...where, visit, line, board };
    },
    /**
     * A Hall Pass springs: the post's author (`by`, Snuckles by default; a character of the cast) sets a real Hall Pass on their own post through the backend's `setCard`, then a Mod's
     * visit begins and the pass springs and ends it. The fake never springs a Hall Pass (its comment: "a Hall Pass never ends a visit"), so the spring and the visit's end are written
     * as `spring_traps` and `end_visit` write them. With no `postSeq` the post is on a board's thread as in `visit`. Returns where it is, the set card's Act and the spring.
     */
    async hallPass(postSeq: number | null = null, options: { readonly mod?: ModName; readonly by?: string; readonly hold?: boolean } = {}): Promise<Where & { readonly set: string; readonly spring: string }> {
      const mod = options.mod ?? 'ontopic';
      const line = lineOf(MODS[mod].opener).text;
      const board = boardOf(line);
      const where = await placed(board, postSeq, options.by ?? 'Snuckles', 'hall');
      const [act] = await fake.acts(where.thread, where.seq, where.seq);
      const name = nameOf(act!.character!);
      await stocked(ownerOf(name), 'hall-pass');
      const done = await inAs(ownerOf(name), () => fake.setCard('hall-pass', characterOf(name), where.post, {}));
      if (!done.ok) throw new Error(`${name}'s Hall Pass on post ${where.seq} was refused: ${done.error}`);
      const set = done.value.id;
      const visit = await begin(mod, where.post, line, board, { kind: 'distraction' });
      /* `hold`: the visit has begun and the pass is set face down, and nothing has sprung yet (`springPass(set, visit)` springs it, so a film can see the back turn over). */
      if (options.hold === true) { fake.broadcast.rejoin(); return { ...where, visit, line, board, set, spring: '' }; }
      const spring = await springPass(set, visit);
      return { ...where, visit, line, board, set, spring };
    },
    /** The Hall Pass `set` springs as the visit `visit` begins, and the visit ends: what `hallPass` does after the visit begins, for a film that held it (`hold`). Returns the spring's Act. */
    springPass,
    filing,
    endFiling,
    /**
     * A report, ready to send: nothing is written. The film's player (`as=name`) is a character that is not the post's author, so the real Report button is on the post; a pointer
     * presses it (the Lens opens on the report form), picks a reason, and presses the send button. Refuses where the film's player is not `name`, or the post is theirs.
     * Returns what to press, in order. The Mod's verdict is not shown: the rehearsal never exercised a report, and the fake answers `dismissed` (`seed.judging`).
     */
    async report(name: string, postSeq: number): Promise<{ readonly seq: number; readonly press: readonly string[] }> {
      if (name !== made.played) throw new Error(`the film's player is ${made.played}: open the stage with as=${name} to report as ${name}`);
      const act = await actOf(postSeq);
      if (act.character === null || act.character === made.cast[name]) throw new Error(`post ${postSeq} is ${name}'s own post: a character reports another's`);
      if (act.character === characterOf(name) || Object.values(made.staff).includes(act.character)) throw new Error(`post ${postSeq} cannot be reported by ${name}`);
      return { seq: postSeq, press: [`#post-${postSeq} button "Report" (the Lens opens: "Report post #${postSeq}")`, 'type a reason in the textarea (the send button stays dashed until there is one)', 'button "Report · 0.25 Aura" sends it'] };
    },
    /**
     * An appeal, ready to make: a Mod's filing against a post of `name`'s own (`as=name`; QC-1000's `filingQcHelp` unless `key` names another) is written as `filing` writes it, so the
     * warn bar has risen and the visit's Lens holds the real Appeal button. A pointer presses the "Filed" mark on the post, then the "Appeal · 0.50 Aura" tile, types a plea and presses the same-named send button.
     * The Mod's ruling is not shown: the rehearsal never exercised an appeal, and the fake answers `upheld` (`seed.judging`).
     */
    async appeal(name: string, key = 'filingQcHelp'): Promise<Where & { readonly infraction: string; readonly press: readonly string[] }> {
      if (name !== made.played) throw new Error(`the film's player is ${made.played}: open the stage with as=${name} to appeal as ${name}`);
      const l = lineOf(key);
      const done = await filing(l.by === 'ontopic' ? 'ontopic' : 'qc', null, key, { by: name });
      return { ...done, press: [`#post-${done.seq} .kb-visit-mark (the "Filed" tab on the post: the Lens opens on the filing)`, 'the "Appeal · 0.50 Aura" tile in the Lens (the form: "Your plea (public)")', 'type a plea in the textarea, then the button "Appeal · 0.50 Aura" sends it'] };
    },
    /** A Mod's star review, posted in a thread of the stage: `stars` (ONTOPIC 5.0's one star, on a thread titled "a") or `fiveStars` (his five, on the Pointless Post Palace). Returns the thread, the review's Act and its key to `show('thread:<key>')`. */
    async review(key: string, options: { readonly hold?: boolean } = {}): Promise<{ readonly thread: string; readonly post: string; readonly key: string }> {
      if (key !== 'stars' && key !== 'fiveStars') throw new Error(`there is no review "${key}": the reviews are stars and fiveStars`);
      const one = key === 'stars';
      const opened = one ? fake.seed.thread('general', characterOf('Snuckles'), 'a', 'a') : opens('Pointless Post Palace', 'Human Josh', 'Describe your day in one word', 'Describe your day in one word. (This might belong on General.)');
      const replies: readonly (readonly [string, string])[] = one
        ? [['D-Guy', 'I have receipts. I will not say for what.'], ['Serious Deer', 'hard disagree'], ['Human Josh', 'bump'], ['Snuckles', 'bookmarked']]
        : [['Serious Deer', 'nobody asked for a point'], ['Snuckles', 'Tuesday, at least.'], ['Chadluminum', 'wrong board, wrong take'], ['D-Guy', 'worst thing I have read today']];
      for (const [by, words] of replies) writes(opened.thread, by, words);
      /* `hold`: the thread and its replies are there and the review is not (`say('ontopic', result.key, key)` posts it while a film watches the thread). */
      if (options.hold === true) { fake.broadcast.rejoin(); return { thread: opened.thread, post: '', key: register(`review-${key}`, opened.thread) }; }
      fake.clock.advance(1000);
      const post = fake.seed.staffPost(made.staff['ontopic']!, opened.thread, lineOf(key).text);
      fake.broadcast.rejoin();
      mark(`staff:review:${key}`);
      return { thread: opened.thread, post, key: register(`review-${key}`, opened.thread) };
    },
    /**
     * The change of Boss: `seed.handover` (FanGaME leaves, QC-1000 takes the seat, with FanGaME's handoff note in the admin queue), and where the season news reads them, in the
     * announcements thread at exactly the handover's instant, FanGaME's farewell (the rehearsal's, "I was Gabe's first ...") and QC-1000's arrival ("QC-1000 has taken the seat ...").
     * FanGaME's long posted farewell and QC-1000's follow-up are already in the stage's `goodbye` thread (`show('thread:goodbye')`).
     */
    async handover(): Promise<{ readonly farewell: string; readonly arrival: string; readonly note: string; readonly thread: string }> {
      const announcements = (await fake.boardPage('announcements', 1, []))?.threads[0]?.id;
      if (announcements === undefined) throw new Error('the stage\'s announcements thread is not there: the Boss\'s moves make it');
      register('announcements', announcements);
      fake.clock.advance(1000);
      const at = fake.clock.now();
      const note = LINES.handoff.text;
      fake.seed.handover({ outgoing: 'fangame', boss: 'quality-control', at, how: 'nomination', bossWas: 'mod', note });
      const farewell = fake.seed.staffPost(made.staff['fangame']!, announcements, LINES.farewell.text, { at });
      const arrival = fake.seed.staffPost(made.staff['qc']!, announcements, LINES.arrival.text, { at });
      fake.broadcast.rejoin();
      mark('staff:handover');
      return { farewell, arrival, note, thread: announcements };
    },
  };

  /** Lands the You Were Saying? the owner cast on the test instance, on the stage's post that is its true pair (`posts.gpt2`, unless `postSeq` names another): the card's real tail types in under it. Returns the play's Act. */
  async function gpt2(postSeq: number = made.posts['gpt2']!): Promise<string> {
    const act = await actOf(postSeq);
    fake.clock.advance(1000);
    const play = fake.seed.card(characterOf('Serious Deer'), act.id, 'you-were-saying', { layer: 1, live: true, message: '', config: { steps: 0 }, ends: new Date(Date.now() + 5 * DAY).toISOString() });
    fake.seed.text(play, act.id, { text: GPT2_TAIL });
    mark('gpt2');
    return play;
  }

  /** The names of node 9's steps, in the order `pile` lands them. */
  const steps = PILE.map((p) => p.what);
  /** The count of each card's plays so far on the pile's post: a stacking card's layers. */
  const layers = new Map<string, number>();
  /** One step of node 9's pile on Snuckles's first post: the play, as the part's seed writes it, live. */
  async function pile(step: number): Promise<string> {
    const p = PILE[step];
    if (p === undefined) throw new Error(`the pile has steps 0 to ${PILE.length - 1}, not ${step}`);
    const first = made.acts['first']!;
    fake.clock.advance(1000);
    const layer = (layers.get(p.card) ?? 0) + 1;
    layers.set(p.card, layer);
    const lasting = rules(p.card)?.lasts !== undefined ? { ends: new Date(Date.now() + (p.lastsMs ?? 5 * DAY)).toISOString() } : {};
    if (p.reach === 'character') {
      fake.seed.reach(characterOf(p.by), 'character', made.target.character, p.card, { post: first, ends: Date.now() + 5 * DAY, message: p.message ?? '', config: p.config, live: true });
    } else {
      const play = fake.seed.card(characterOf(p.by), first, p.card, { layer, live: true, message: p.message ?? '', ...(p.config === undefined ? {} : { config: p.config }), ...lasting });
      /* The old voice's words arrive after its play, and type in as they land. */
      if (p.card === 'you-were-saying') {
        const version = (await actOf(1)).id;
        fake.seed.text(play, version, { text: TAIL });
      }
    }
    mark(p.what);
    return p.what;
  }

  /** The pending Aura the orbs' ghost shows now, signed hundredths: what the film's player's estimate holds. */
  async function forecast(): Promise<number> {
    return pendingOf(await fake.estimate());
  }

  return { react, cast, told, quoteSprings, springsOn, forgedQuote, staff, gpt2, pile, steps, order: FILM_ORDER, forecast, landed, zero: () => { zero = performance.now(); landed.length = 0; layers.clear(); } };
}

export type Playbook = ReturnType<typeof playbook>;
