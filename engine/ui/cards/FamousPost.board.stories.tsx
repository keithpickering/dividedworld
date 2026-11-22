/**
 * A famous post, as a stress test of the marks and the Lens (docs/plans/2026-10-31-marks-and-the-lens-design.md): one post that
 * people have come back to for three years, with 85 plays of sixteen kinds on it. Most have long since run their time; the same
 * cards were played again and again as each ran out; an admin ended two; a handful are up now; the post's first three Whoops!
 * drew the board's reactions and so top its billing. It asks how the strip, the "+N", the Lens's tabs and its Who rows read when
 * a post has far more plays than a page draws in full (docs/plans/2026-11-21-post-plays-design.md).
 *
 * The fake reads what the database reads: the plays in force, each kind's newest and most-drawn play, and its count
 * (docs/plans/2026-11-21-post-plays-design.md, section 1).
 *
 * Left out, each because it ends nothing on its own and would hide what the story looks at: Below the Fold folds the post for
 * good, and Stick Around's takeover holds every visit to it.
 *
 * The thread is the story's own, written into the boards fixture's world three years before the page's clock: an opening post
 * (the famous one, #1) and its replies, months apart. No board draws these. Open each at 1440 by 1120, and its `Phone` twin at
 * 390 by 844.
 *
 * The cards are named by key, each with how many times it was played, so a card the instance lacks fails the story by its key.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { spanMs } from '../../rules/cards.ts';
import { useKayfa } from '../context.tsx';
import type { Fake } from '../data/fake.ts';
import type { Id } from '../data/api.ts';
import { Frame } from '../frame/Frame.tsx';
import { LoadedThread } from '../loaded.tsx';
import { useLocation, useNavigate } from '../router.tsx';
import { cardOf } from '../story.tsx';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

/** The post's age when the page reads it. */
const AGE = 3 * YEAR;

/**
 * Each card played on the post, by key, how many times, and any settings its plays carry. A card with `lasts` runs its time and is
 * played again; Whoops! (`early`) was played to its stack of three in the post's first week and is still on it. A card that `inks` is
 * played in its own color, read from the instance's art for it (`CardArt.color`), since the engine names no color (tools/check-ui-tokens.mjs).
 */
const PLAYED: readonly { readonly key: string; readonly times: number; readonly config?: Readonly<Record<string, unknown>>; readonly early?: boolean; readonly inks?: true }[] = [
  { key: 'whoops', times: 3, early: true, inks: true },
  { key: 'sugar-coat', times: 14 },
  { key: 'last-word', times: 11 },
  { key: 'force-field', times: 9 },
  { key: 'hype-up', times: 7 },
  { key: 'whodunnit', times: 6 },
  { key: 'toll', times: 6 },
  { key: 'blind-study', times: 5 },
  { key: 'overreaction', times: 3 },
  { key: 'mooch', times: 4 },
  { key: 'steel-chair', times: 4 },
  { key: 'required-reading', times: 3 },
  { key: 'card-collector', times: 3 },
  { key: 'feelin-fab', times: 3 },
  { key: 'hot-box', times: 2 },
  { key: 'rope-break', times: 2 },
];

/** Who plays on it: four players' masks, one name long enough to test a Who row's wrap. */
const CAST: readonly (readonly string[])[] = [
  ['Gloombette', 'Pipe Dream', 'Shy Guy Fieri'],
  ['Koopa Troopa Supreme', 'The Honorable Judge Bobomb Koopenheimer III', 'Lakitu Larry'],
  ['Mushroom Mom', 'Boo Radley', 'Thwimp'],
  ['Cheep Cheep Charlie', 'Bullet Bill Nye', 'Hammer Sister'],
];

/** What a few plays said, by the play's place in the story's order: the anniversaries and the grudges. */
const MESSAGES = ['happy anniversary to the post that started it all', 'still the best post on this board', 'I was here', 'not again', 'every year', 'you know what you did', 'pilgrimage'];

/** A small fixed sequence, so the plays fall at the same times on every open: no randomness reaches a board. */
function sequence(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Writes the famous thread, three years old, and every play on its opening post. Returns the thread. */
async function seedFamous(fake: Fake, me: readonly Id[], cards: readonly { readonly key: string; readonly lasts?: Parameters<typeof spanMs>[0] }[], looks: readonly { readonly key: string; readonly art?: { readonly color: string } }[]): Promise<Id> {
  const { seed } = fake;
  /* The page reads its own clock (onPageClock); the fake's is brought up to it, so a play up now is up on the page and an admin can end it. */
  if (fake.now() > fake.clock.now()) fake.clock.advance(fake.now() - fake.clock.now());
  const now = fake.clock.now();
  const born = now - AGE;
  const crowd = CAST.flatMap((names, i) => {
    const account = seed.account(`famous-${i + 1}`, { email: `famous-${i + 1}@boards.test`, seasoned: true });
    return names.map((name, j) => ({ account, character: seed.character(account, name, ['heel', 'face', 'jabroni', 'lurker'][(i + j) % 4]!, { at: born - DAY * (10 + i) }) }));
  });
  const casters = crowd.map((c) => c.character);
  const author = casters[0]!;
  const opened = seed.thread('general', author, 'The post', [
    'I have been lurking here for six years and I am finally going to say it.',
    'The water levels were never the problem. The problem was that nobody ever read the sign at the start of the level.',
    'That is all. Do with this what you will.',
  ].join('\n\n'), { at: born });
  /* Replies months apart, so the post is the page's first and the page is quiet around it. */
  const replies = [
    [DAY, 'what sign'],
    [40 * DAY, 'I have read this post every week since it went up'],
    [YEAR, 'one year of the post'],
    [YEAR + 3 * DAY, 'who keeps playing cards on this'],
    [2 * YEAR, 'two years. the sign is still there.'],
    [2 * YEAR + 100 * DAY, 'I showed this to my mom'],
    [YEAR + 40 * DAY, 'bump'],
  ] as const;
  replies.forEach(([after, body], i) => { seed.post(opened.thread, casters[(i * 5 + 2) % casters.length]!, body, { at: born + after }); });

  /* Every play, then sorted by time so the layers count up as the plays were made. */
  const next = sequence(20231120);
  const plays: { at: number; key: string; config?: Readonly<Record<string, unknown>> }[] = [];
  for (const p of PLAYED) {
    const rules = cardOf(cards, p.key);
    const lasts = rules.lasts ? spanMs(rules.lasts) : null;
    const ink = p.inks ? cardOf(looks, p.key).art?.color : undefined;
    if (p.inks && ink === undefined) throw new Error(`the card "${p.key}" has no art to take its ink from`);
    const config = ink === undefined ? p.config : { ...p.config, color: ink, seed: 20231120 };
    for (let i = 0; i < p.times; i++) {
      let at: number;
      if (p.early) at = born + HOUR * (2 + i * 30);
      /* The last of each card that lasts is up now, for the six most played; the rest fall over the three years, heaviest at each anniversary. */
      else if (lasts !== null && i === p.times - 1 && p.times >= 6) at = now - Math.min(lasts / 2, DAY * (1 + next()));
      else {
        const year = Math.floor(next() * 3);
        const near = next() < 0.5;
        at = born + year * YEAR + (near ? next() * 10 * DAY : next() * YEAR);
        at = Math.min(at, now - (lasts ?? DAY) - HOUR);
      }
      plays.push({ at, key: p.key, ...(config ? { config } : {}) });
    }
  }
  plays.sort((a, b) => a.at - b.at);
  const layers = new Map<string, number>();
  const ids: { id: Id; key: string; caster: Id }[] = [];
  plays.forEach((p, i) => {
    const rules = cardOf(cards, p.key);
    const layer = (layers.get(p.key) ?? 0) + 1;
    layers.set(p.key, layer);
    /* The reader's own masks play now and then, so some rows are "yours". */
    const caster = i % 11 === 4 && me.length > 0 ? me[i % me.length]! : casters[(i * 7 + 3) % casters.length]!;
    const message = i % 9 === 0 ? MESSAGES[(i / 9) % MESSAGES.length]! : '';
    const id = fake.seed.card(caster, opened.act, p.key, {
      at: p.at, layer, message,
      ...(p.config ? { config: p.config } : {}),
      ...(rules.lasts ? { ends: new Date(p.at + spanMs(rules.lasts)).toISOString() } : {}),
    });
    ids.push({ id, key: p.key, caster });
  });

  /* Why it is famous: the post and its first Whoops! drew the board, so those plays top the billing over three years of newer ones. */
  /* A player's masks never react to each other, so a reactor skips what its own player wrote or played (and the reader's masks' plays, whose player is not in the crowd). */
  const ownerOf = new Map(crowd.map((c) => [c.character, c.account]));
  const whose = new Map(ids.map((p) => [p.id, p.caster]));
  crowd.forEach(({ account, character }, i) => {
    if (ownerOf.get(author) !== account) seed.react(account, character, opened.act, ['fire', 'hundred-points', 'laughing'][i % 3]!);
    ids.filter((p) => p.key === 'whoops').forEach((p, j) => {
      const by = ownerOf.get(whose.get(p.id)!);
      if (by !== undefined && by !== account && (i + j) % 4 !== 3) seed.react(account, character, p.id, ['laughing', 'tomato', 'fire'][(i + j) % 3]!);
    });
  });

  /* An admin ended two of the plays up now (a Last Word and a Force Field): the reader is an admin for the moment it takes, as the Lens's "End this card" would. */
  const account = (await fake.session()).account;
  if (account === null) throw new Error('the story needs a signed-in reader to end a play as an admin');
  seed.admin(account);
  for (const key of ['last-word', 'force-field']) {
    const up = ids.filter((p) => p.key === key).at(-1);
    if (!up) throw new Error(`no play of "${key}" to end`);
    const answer = await fake.reverseCard(up.id);
    if (!answer.ok) throw new Error(answer.error);
  }
  seed.admin(account, false);
  return opened.thread;
}

type Open = 'none' | 'first' | 'busiest' | 'more' | 'who' | 'kinds';

/** Opens the famous post's Lens as a reader would: from its first mark, from its busiest kind's tab, or from its "+N"; then unfolds Who. `who` is the busiest kind with one ended row expanded, and `kinds` the first kind with the All button pressed. */
function Opener({ open }: { readonly open: Open }) {
  useEffect(() => {
    if (open === 'none') return;
    let step = 0;
    const timer = setInterval(() => {
      const article = document.getElementById('post-1');
      if (step === 0) {
        const mark = open === 'more' ? article?.querySelector<HTMLElement>('.kb-mark-more') : article?.querySelector<HTMLElement>('.kb-mark[data-kb-card]');
        if (!mark) return;
        mark.click();
        step = 1;
      } else if (step === 1) {
        if (open === 'busiest' || open === 'who') {
          const tab = [...document.querySelectorAll<HTMLElement>('.kb-lens [role="tab"]')].find((t) => /Sugar Coat/u.test(t.getAttribute('aria-label') ?? t.textContent ?? ''));
          if (!tab) return;
          tab.click();
        }
        step = 2;
      } else if (open === 'kinds') {
        const all = document.querySelector<HTMLElement>('.kb-lens-all');
        if (!all) return;
        clearInterval(timer);
        if (all.getAttribute('aria-expanded') === 'false') all.click();
      } else {
        const fold = document.querySelector<HTMLElement>('.kb-lens-fold');
        if (!fold) return;
        if (fold.getAttribute('aria-expanded') === 'false') { fold.click(); return; }
        if (open === 'who') {
          const row = document.querySelectorAll<HTMLElement>('.kb-lens-row[data-kb-ended] .kb-lens-compact')[1];
          if (!row) return;
          if (row.getAttribute('aria-expanded') === 'false') row.click();
        }
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [open]);
  return null;
}

function Famous({ open }: { readonly open: Open }) {
  const { api, instance, ui } = useKayfa();
  const navigate = useNavigate();
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  const [famous, setFamous] = useState<Id | null>(null);
  useEffect(() => {
    if (famous !== null) return;
    let live = true;
    void (async () => {
      const fake = api as Fake;
      for (const c of instance.cards) await api.meetCard(c.key);
      const me = (await api.myCharacters()).map((c) => c.id);
      const made = await seedFamous(fake, me, instance.cards, ui.cards);
      if (!live) return;
      setFamous(made);
      navigate(`/t/${made}`);
    })().catch((e: unknown) => { console.error('the famous post story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, ui, famous, navigate]);
  return (
    <Frame>
      {famous !== null && thread === famous ? <><Opener open={open} /><LoadedThread thread={famous} /></> : <div aria-busy="true" />}
    </Frame>
  );
}

const meta: Meta<typeof Famous> = {
  title: 'Boards/01 Marks, a famous post',
  component: Famous,
  parameters: { moment: '01-main', layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Famous>;
const phone = { parameters: { moment: '02-phone' } } as const;

/** The famous post quiet: its strip of four marks and "+12". */
export const Strip: Story = { args: { open: 'none' } };
/** Its Lens on its first kind (Whoops!, the three that made it famous), Who unfolded. */
export const LensFirst: Story = { args: { open: 'first' } };
/** Its Lens on its busiest kind (Sugar Coat, fourteen plays over three years), Who unfolded. */
export const LensBusiest: Story = { args: { open: 'busiest' } };
/** Its Lens from "+N": the first kind the strip has no room for, the tab row scrolled to it. */
export const LensFromMore: Story = { args: { open: 'more' } };
export const StripPhone: Story = { args: { open: 'none' }, ...phone };
export const LensFirstPhone: Story = { args: { open: 'first' }, ...phone };
export const LensBusiestPhone: Story = { args: { open: 'busiest' }, ...phone };
export const LensFromMorePhone: Story = { args: { open: 'more' }, ...phone };
/** Its Lens on Sugar Coat with Who unfolded and one ended row expanded under its compact siblings. */
export const UnfoldedWho: Story = { args: { open: 'who' } };
export const UnfoldedWhoPhone: Story = { args: { open: 'who' }, ...phone };
/** Its Lens with the All button pressed: every kind of card in a grid. */
export const AllKinds: Story = { args: { open: 'kinds' } };
export const AllKindsPhone: Story = { args: { open: 'kinds' }, ...phone };
