import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { ThreadSummary } from '../data/api.ts';
import { cardOf, type World } from '../story.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { SpinForm } from './SpinForm.tsx';
import { LoadedThread } from '../loaded.tsx';

const TITLE = 'Where it began';
/** The card played on the first post, for the spin from a play. */
const PLAYED = '4d-chess';
/** The card that reaches a character, cast from the first post and spun from. */
const REACHING = 'class-clown';

/** The thread with this title, once the world has it. */
function useThread(title: string): ThreadSummary | null {
  const { api } = useKayfa();
  const [found, setFound] = useState<ThreadSummary | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      /* The world's spin may still be under way when the story first reads: look again a few times. */
      for (let attempt = 0; attempt < 20 && live; attempt++) {
        for (const board of await api.boards()) {
          const hit = (await api.threads(board.id, { offset: 0, limit: 50 })).threads.find((t) => t.title === title);
          if (hit) { if (live) setFound(hit); return; }
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    })();
    return () => { live = false; };
  }, [api, title]);
  return found;
}

/** The thread spun from the first post of "Where it began", opened on its ORIGIN box. */
function SpunThread() {
  const spun = useThread('Spun from the start');
  return spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />;
}

/** The thread spun from a card play on the first post, opened on its ORIGIN box. */
function PlaySpunThread() {
  const spun = useThread('Spun from the play');
  return spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />;
}

/** The thread spun from the mark of a card on a character, on a post by that character, opened on its ORIGIN box. */
function PressedSpunThread() {
  const spun = useThread('Spun at the shine');
  return spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />;
}

/** The thread spun from the same card with no post pressed (as every such spin was made before), opened on its ORIGIN box. */
function LandedSpunThread() {
  const spun = useThread('Spun from the shine');
  return spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />;
}

/** The first post's spin form, open under it. */
function OpenForm() {
  const first = useThread(TITLE);
  return first?.firstAct ? <SpinForm origin={first.firstAct} label="post 1" onClose={() => undefined} /> : <div aria-busy="true" />;
}

/** The move that bars the character in the apology story's world, which the world sets and the story reads. */
let apologyMove = '';
/** The apology form for the move that bars the character from the board it opens on. */
function ApologyForm() {
  return <SpinForm origin={apologyMove} label={null} onClose={() => undefined} apology={{ to: 'the Boss' }} />;
}

const meta: Meta = { title: 'Spin/Spin' };
export default meta;

const world: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', (instance.classes[1] ?? instance.classes[0]!).key);
  const general = instance.boards.find((b) => !b.system)!.slug;
  const t = fake.seed.thread(general, other, TITLE, 'A post worth a thread of its own.');
  fake.seed.post(t.thread, mine, 'An answer.');
  /* The fake does its work before it answers, so the spun thread is there when the story reads. */
  fake.signInAs(me);
  void fake.spin(t.act, mine, 'Spun from the start', 'Carrying on over here.');
  const play = fake.seed.card(other, t.act, cardOf(instance.cards, PLAYED).key, { message: 'Oops.' });
  void fake.spin(play, mine, 'Spun from the play', 'About that card.');
};

/** Pipewrench barred by the Boss for a day from one of two player boards (the instance's second, or one added). Returns the move. */
const barredWorld = (fake: Parameters<World>[0], instance: Parameters<World>[1], board: 'other' | 'general'): string => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', (instance.classes[1] ?? instance.classes[0]!).key);
  const open = instance.boards.filter((b) => !b.system).map((b) => b.slug);
  const general = open[0]!;
  const elsewhere = open[1] ?? 'elsewhere';
  if (open.length < 2) fake.seed.board(elsewhere, 'Elsewhere');
  fake.seed.thread(general, other, TITLE, 'A post worth a thread of its own.');
  fake.seed.staff('story-boss', 'The Boss', 'boss');
  fake.signInAs(me);
  return fake.seed.groupMove('story-boss', { character: mine, group: GROUP, board: board === 'general' ? general : elsewhere, expiresAt: fake.clock.now() + 86_400_000 });
};

/**
 * A card that reaches a character, named by key, cast from the first post of one thread, and two threads
 * spun from it: one pressed on a later post by that character, one with no post pressed.
 */
const reachWorld: World = (fake, instance) => {
  const me = fake.seed.account('story-player');
  const mine = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', (instance.classes[1] ?? instance.classes[0]!).key);
  const general = instance.boards.find((b) => !b.system)!.slug;
  const card = cardOf(instance.cards, REACHING);
  const cast = fake.seed.thread(general, other, 'Where the card was cast', 'The post the card was cast from.');
  const shiny = fake.seed.thread(general, mine, 'Why are my posts shiny', 'A post of mine.');
  const pressed = fake.seed.post(shiny.thread, other, 'The post it was pressed on.');
  fake.signInAs(me);
  const play = fake.seed.reach(mine, 'character', other, card.key, { post: cast.act });
  void fake.spin(play, mine, 'Spun at the shine', 'About that post.', undefined, pressed);
  void fake.spin(play, mine, 'Spun from the shine', 'About that card.');
};

/** The small form under a post that starts a thread from it. */
export const SpinFormOpen: StoryObj = { render: () => <OpenForm />, parameters: { world } };

/** The Board field under a post, starting on the board the post is on, with another board offered. */
export const BoardField: StoryObj = { render: () => <OpenForm />, parameters: { world } };

/** The Board field with a board the character is barred from: a disabled option that says until when. */
export const BoardFieldWithBarredBoard: StoryObj = { render: () => <OpenForm />, parameters: { world: ((fake, instance) => { barredWorld(fake, instance, 'other'); }) satisfies World } };

/** An apology: the board the character is barred from is choosable, and the apology goes onto it. */
export const BoardFieldInApology: StoryObj = { render: () => <ApologyForm />, parameters: { world: ((fake, instance) => { apologyMove = barredWorld(fake, instance, 'general'); }) satisfies World } };

/** A spun thread, opening on its ORIGIN box: the Act it came from, live, with a link back. */
export const OriginBox: StoryObj = { render: () => <SpunThread />, parameters: { world } };

/** A thread spun from a card play on a post: its head names the card and the post it landed on, linked. */
export const OriginBoxFromPlay: StoryObj = { render: () => <PlaySpunThread />, parameters: { world } };

/** A thread spun from a card on a character, pressed on one of its posts: the post as it was spun, the card's effect still, and a head that links the post and the one the card was cast from. */
export const OriginBoxFromCharacterAtPost: StoryObj = { render: () => <PressedSpunThread />, parameters: { world: reachWorld } };

/** A thread spun from a card on a character with no post pressed: the cast-from post as it landed, on one line. */
export const OriginBoxFromCharacterLanded: StoryObj = { render: () => <LandedSpunThread />, parameters: { world: reachWorld } };

const GENERAL = (instance: Parameters<World>[1]) => instance.boards.find((b) => !b.system)!.slug;

/** One staff member, the reported post's thread, and a player with an asker; each exchange story spins its own thread from the ask or the answer. */
const exchangeWorld = (cases: readonly { readonly title: string; readonly make: (f: Parameters<World>[0], mod: string, asker: string, post: string) => { ask: string; answer: string } }[]): World => (fake, instance) => {
  const me = fake.seed.account('story-player');
  const asker = fake.seed.character(me, 'Pipewrench', instance.classes[0]!.key);
  const other = fake.seed.character(fake.seed.account('story-other'), 'Spritey', (instance.classes[1] ?? instance.classes[0]!).key);
  const mod = fake.seed.staff('story-mod', 'Kassie', 'mod');
  const t = fake.seed.thread(GENERAL(instance), other, TITLE, 'A post someone reported.');
  fake.signInAs(me);
  for (const c of cases) {
    const made = c.make(fake, mod, asker, t.act);
    void fake.spin(c.title.endsWith('answer') ? made.answer : made.ask, asker, c.title, 'About this.');
  }
};

/** The thread titled `title`, opened on its ORIGIN box. */
function SpunExchange({ title }: { readonly title: string }) {
  const spun = useThread(title);
  return spun ? <LoadedThread thread={spun.id} /> : <div aria-busy="true" />;
}

/** The ORIGIN box, held to a mode, so the board's light and dark are each a story. */
function InMode({ mode, title }: { readonly mode: 'light' | 'dark'; readonly title: string }) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    return () => root.removeAttribute('data-kb-mode');
  }, [mode]);
  return <SpunExchange title={title} />;
}

const reportMade = (verdict: 'visit' | 'dismissed' | 'backfire', line: string) => (f: Parameters<World>[0], mod: string, asker: string, post: string) => {
  const ask = f.seed.report(asker, post, 'This post is not in the spirit of the game.');
  return { ask, answer: f.seed.verdict(ask, mod, verdict, { line, ...(verdict === 'visit' ? { visit: f.seed.visit(mod, post, {}) } : {}) }) };
};
const appealMade = (punishing: 'infraction' | 'ban' | 'move', verdict: 'overturned' | 'upheld' | 'reduced' | 'increased', line: string) => (f: Parameters<World>[0], mod: string, asker: string, post: string) => {
  const infraction = f.seed.infraction(f.seed.visit(mod, post, {}));
  const target = punishing === 'infraction' ? infraction
    : punishing === 'ban' ? f.seed.ban(asker, f.clock.now() + 5 * 86_400_000, { infraction })
    : f.seed.groupMove('story-mod', { character: asker, group: GROUP });
  const ask = f.seed.appeal(asker, target, 'I was only joking.');
  return { ask, answer: f.seed.ruling(ask, mod, verdict, { line, ...(punishing === 'infraction' ? {} : { until: f.clock.now() + 86_400_000 }) }) };
};
/** A group the instance confers, named by key as every story names what it draws. */
const GROUP = 'trialMembers';

/** A Boss's ruling: the stamp the fake's staff seed gives a Boss, so the byline names the Boss's role. */
const bossRuling = (f: Parameters<World>[0], _mod: string, asker: string, post: string) => {
  const boss = f.seed.staff('story-boss', 'The Boss', 'boss');
  const ask = f.seed.appeal(asker, f.seed.infraction(f.seed.visit(boss, post, {})), 'I was only joking.');
  return { ask, answer: f.seed.ruling(ask, boss, 'overturned', { line: 'Fine. Go.' }) };
};

const exchangeCases = [
  { title: 'Boss ruling, spun from the answer', make: bossRuling },
  { title: 'Dismissed report, spun from the answer', make: reportMade('dismissed', 'Nothing to see here.') },
  { title: 'Report visit, spun from the answer', make: reportMade('visit', 'I will take a look.') },
  { title: 'Backfire, spun from the answer', make: reportMade('backfire', 'You, however, were rude.') },
  { title: 'Upheld infraction appeal, spun from the answer', make: appealMade('infraction', 'upheld', 'It stays.') },
  { title: 'Reduced ban appeal, spun from the answer', make: appealMade('ban', 'reduced', 'Shorter, then.') },
  { title: 'Overturned move appeal, spun from the answer', make: appealMade('move', 'overturned', 'Undone.') },
  { title: 'Unanswered report, spun from the ask', make: (f: Parameters<World>[0], _m: string, asker: string, post: string) => ({ ask: f.seed.report(asker, post, 'Is anyone there?'), answer: '' }) },
] as const;
const exchanges = exchangeWorld(exchangeCases);

const exchangeStory = (title: string, mode: 'light' | 'dark'): StoryObj => ({ render: () => <InMode mode={mode} title={title} />, parameters: { world: exchanges } });

/** A dismissed report, spun from the Mod's verdict: the asker's reason, the Mod's words and the plain line. */
export const ExchangeDismissedLight = exchangeStory('Dismissed report, spun from the answer', 'light');
export const ExchangeDismissedDark = exchangeStory('Dismissed report, spun from the answer', 'dark');
/** A report heard as a visit. */
export const ExchangeVisitLight = exchangeStory('Report visit, spun from the answer', 'light');
export const ExchangeVisitDark = exchangeStory('Report visit, spun from the answer', 'dark');
/** A report that backfired. */
export const ExchangeBackfireLight = exchangeStory('Backfire, spun from the answer', 'light');
export const ExchangeBackfireDark = exchangeStory('Backfire, spun from the answer', 'dark');
/** An appeal of an infraction, upheld. */
export const ExchangeInfractionRulingLight = exchangeStory('Upheld infraction appeal, spun from the answer', 'light');
export const ExchangeInfractionRulingDark = exchangeStory('Upheld infraction appeal, spun from the answer', 'dark');
/** An appeal of a ban, reduced. */
export const ExchangeBanRulingLight = exchangeStory('Reduced ban appeal, spun from the answer', 'light');
export const ExchangeBanRulingDark = exchangeStory('Reduced ban appeal, spun from the answer', 'dark');
/** An appeal of a move, overturned. */
export const ExchangeMoveRulingLight = exchangeStory('Overturned move appeal, spun from the answer', 'light');
export const ExchangeMoveRulingDark = exchangeStory('Overturned move appeal, spun from the answer', 'dark');
/** An appeal ruled on by the Boss: the byline carries the Boss's role. */
export const ExchangeBossRulingLight = exchangeStory('Boss ruling, spun from the answer', 'light');
export const ExchangeBossRulingDark = exchangeStory('Boss ruling, spun from the answer', 'dark');
/** A report no one has answered: "Not answered yet." */
export const ExchangeUnansweredLight = exchangeStory('Unanswered report, spun from the ask', 'light');
export const ExchangeUnansweredDark = exchangeStory('Unanswered report, spun from the ask', 'dark');
