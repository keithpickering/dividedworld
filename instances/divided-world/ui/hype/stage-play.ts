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
import { pendingOf } from './forecast.ts';
import type { Made } from './stage-world.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** What the Mod's visit to a post said when it came, and when it filed (round 1's stage: ONTOPIC 5.0's, kept word for word). */
export const VISIT_LINE = 'A question about boards, asked on a board. I will allow that this is efficient.';
export const FILED_LINE = 'Two stars. Filed.';

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
  { what: 'laugh-track', by: 'Serious Deer', card: 'laugh-track', config: { cues: [{ phrase: 'walk cycle', sound: 'laugh' }], seed: 7 }, message: 'Laugh Track' },
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

/** The words You Were Saying? runs on with, which type in as the play lands (the old voice's own, at the length of one step: a made-up sentence for a made-up model). */
const TAIL = ' and then, honestly, the walk cycle just keeps going, because a sprite that stops walking is only a sprite, and nobody should be only a sprite.';

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

  /**
   * The quoting post that springs a Move waiting on a phrase. The backend does not play a Move from a quote (its stories seed the
   * spring), so the post is written as the player writes it, quoting the post, and the spring and the card it landed are written as the
   * server's `spring_traps` writes them: a spring on the quoted post's back, and the Move played on the quoting one by the back's setter.
   */
  async function quoteSprings(name: string, post: number, words: string): Promise<{ readonly post: string; readonly spring: string; readonly play: string }> {
    const quoted = await actOf(post);
    const wrote = await inAs(ownerOf(name), () => fake.post(made.thread, characterOf(name), words, quoted.id));
    if (!wrote.ok) throw new Error(`${name}'s quote of post ${post} was refused: ${wrote.error}`);
    return { post: wrote.value.id, ...(await springsOn(post, wrote.value.id)) };
  }

  /**
   * The spring and the landed Move for a quoting post that already exists (written by the real composer, say): the half of `quoteSprings`
   * after the writing. `quoted` is the number of the post it quotes.
   */
  async function springsOn(quoted: number, quoting: string): Promise<{ readonly spring: string; readonly play: string }> {
    const quotedAct = await actOf(quoted);
    const set = made.sets['steelChair'];
    if (set === undefined) throw new Error('the stage has no Steel Chair set face down');
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
   * The alert a caught cast writes its caster. The backend's `play_card` writes it (a `trapStruck` on the caught play, 0370); the in-memory
   * backend writes none, so a stage that shows the caster's side of a catch writes what the database would have, on the newest cast of the
   * named character on the post that a back caught. It reaches the caster's page as a toast and a row in the alerts, as any alert does.
   */
  async function told(name: string, post: number): Promise<string> {
    const act = await actOf(post);
    const caught = (await fake.postPlays([act.id])).plays.filter((a) => a.kind === 'card' && a.character === characterOf(name) && (a.payload as { caught?: unknown }).caught !== undefined).at(-1);
    if (caught === undefined) throw new Error(`${name} has no caught cast on post ${post}: nothing was caught to tell them of`);
    fake.seed.alert(ownerOf(name), { kind: 'trapStruck', act: caught.id });
    mark(`told:${name}`);
    return caught.id;
  }

  /** The Staff's three beats, each as the seed writes it where the backend plays none, and the page told to catch up. */
  const staff = {
    /** FanGaME's memo, posted in a thread of the stage (the main one unless `where` names another). */
    async memo(where = 'main'): Promise<string> {
      const thread = made.threads[where];
      if (thread === undefined) throw new Error(`the stage has no thread "${where}"`);
      fake.clock.advance(1000);
      const id = fake.seed.staffPost(made.staff['fangame']!, thread, LINES.memo.text);
      fake.broadcast.rejoin();
      mark('staff:memo');
      return id;
    },
    /** The Boss merges the Palace into World -1, with his reason (round 1's rehearsal line) on the move's notice; the closed board links where its threads went. */
    async merge(): Promise<string> {
      const { palace, minus } = made.boards;
      for (const [slug, name, description] of [[palace, 'Plumber Platformer Palace', 'A board for Mario fangames.'], [minus, 'World -1', 'Everything that is not a Mario fangame.']] as const) {
        try { fake.seed.board(slug, name, description); } catch (e) { if (!/already/.test(String(e))) throw e; /* made already: the world's own seed says "there is a board … already" */ }
      }
      fake.clock.advance(1000);
      const move = fake.seed.move('fangame', { board: '', name: '', body: LINES.merged.text, lasting: { kind: 'mergeBoard', params: { board: palace, into: minus } } });
      fake.seed.closeBoard(palace, { mergedInto: minus });
      fake.broadcast.rejoin();
      /* The move opens a thread of its own on the Staff Announcements board (the board's newest): the stage can show it (`show('thread:announcements')`). */
      const announcements = (await fake.boardPage('announcements', 1, []))?.threads[0]?.id;
      if (announcements !== undefined) (made.threads as Record<string, string>)['announcements'] = announcements;
      mark('staff:merge');
      return move;
    },
    /** A Mod files Snuckles's first post: its visit, the visit's end and the infraction it wrote. */
    async file(post = 1): Promise<string> {
      const act = await actOf(post);
      fake.clock.advance(1000);
      const visit = fake.seed.visit(made.staff['ontopic']!, act.id, { endsInMs: HOUR, line: VISIT_LINE });
      fake.seed.visitEnd(visit, { outcome: 'filed', line: FILED_LINE });
      fake.seed.infraction(visit, { points: 3 });
      fake.broadcast.rejoin();
      mark('staff:file');
      return visit;
    },
  };

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

  return { react, cast, told, quoteSprings, springsOn, staff, pile, steps, order: FILM_ORDER, forecast, landed, zero: () => { zero = performance.now(); landed.length = 0; layers.clear(); } };
}

export type Playbook = ReturnType<typeof playbook>;
