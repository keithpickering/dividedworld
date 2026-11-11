/**
 * Jimmy Wails's drive as stories for the owner's word (docs/plans/2026-11-03-jimmy-wails-plan.md, Task 9): a new post of the Main board's moment
 * with the plays and gifts each case calls for, read by a new signed-in account with a wallet of its own. (The story lives under ui/, where
 * Storybook and the story route look; the card's screens are in cards/jimmy-wails/.)
 *
 * - `blue-short`, `blue-long`, `close-short`, `close-long`, `dark-short`, `dark-long`: one plate each, with a short appeal and with one of 200 characters.
 * - `three`: a drive of three appeals, one on each plate, at its first banner; press Next, or a dot, to see another. With `reduced` the rotation is
 *   off and the swap has no fade.
 * - `wall`: three appeals and 26 gifts, so the wall holds its latest 20 and says "and 6 more".
 * - `closed`: two appeals and 11 gifts, its appeals a week and a day old: no buttons, "This drive has ended."
 * - `earlier`: a closed drive and, after it, a new drive of one appeal; the closed one is a collapsed line that opens its banners.
 * - `origin`: a thread spun from the post, whose ORIGIN box shows the banners and the totals and no buttons.
 * - `short`: one appeal with a wallet of 0.20 Aura, so only the smallest gift can be given and the others are disabled.
 *
 * Each case has a Light, a Dark and a Phone twin at 390 by 844 (the others at 1440 by 1120). The gifts are seeded through the fake's own `donate`,
 * from accounts of their own, so the drive's totals and wall are what the database's answers would make.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { useKayfa } from '../../../../engine/ui/context.tsx';
import type { Fake } from '../../../../engine/ui/data/fake.ts';
import { useLocation } from '../../../../engine/ui/router.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';

type Case = 'blue-short' | 'blue-long' | 'close-short' | 'close-long' | 'dark-short' | 'dark-long' | 'three' | 'wall' | 'closed' | 'earlier' | 'origin' | 'short';

interface Args {
  readonly shown: Case;
  readonly mode: 'light' | 'dark';
  readonly reduced: boolean;
}

const POST = 'I have spent three years on this tileset, and I am told that is "too long". Here it is, and I hope somebody likes it.';
const SHORT = ['Please, a few Aura keep the Mushroom Kingdom online.', 'The Thwomps are very tired and so am I.', 'Chip in, or I will rewrite the physics again.'];
/** Exactly 200 characters. */
const LONG = 'Every year I ask, and every year the Mushroom Kingdom answers with a polite silence. This year I only need enough Aura to keep the lights on, the pipes warm and the Goombas fed, so, please, read this.';
const DONORS = ['Gloomba', 'Spritey', 'Toadette', 'Mrs. Hooligan', 'Wiggler', 'Koopa Kid', 'Blooper', 'Lakitu Jr.', 'Bob-omb', 'Thwomp', 'Shy Guy', 'Boo Hoo', 'Pokey', 'Chain Chomp', 'Cheep Cheep', 'Fuzzy', 'Podoboo', 'Rex', 'Dry Bones', 'Monty Mole', 'Birdo', 'Petey', 'Hammer Bro', 'Piranha', 'Amazing Flyin', 'Magikoopa'];
const PLATE_KEYS = ['blue-shirt', 'close-up', 'dark-logo'] as const;
const DAY = 86_400_000;

const SINGLE: Partial<Record<Case, { readonly plate: number; readonly long: boolean }>> = {
  'blue-short': { plate: 0, long: false }, 'blue-long': { plate: 0, long: true },
  'close-short': { plate: 1, long: false }, 'close-long': { plate: 1, long: true },
  'dark-short': { plate: 2, long: false }, 'dark-long': { plate: 2, long: true },
};

/** What was seeded for a thread of an api, so a story rendered twice (strict mode) seeds once. */
const seededFor = new WeakMap<object, Map<string, Promise<string>>>();

async function seedCase(fake: Fake, thread: string, shown: Case, instanceClass: string): Promise<string> {
  const { seed } = fake;
  /* The page judges a drive's close by the real clock, so the fake's is brought to it (a closed drive's plays are dated a week and a day back, and the clock returns). */
  const back = shown === 'closed' || shown === 'earlier' ? 8 * DAY : 0;
  fake.clock.advance(Date.now() - back - fake.clock.now());
  const found = await Promise.all([41, 42, 43, 44].map(async (n) => (await fake.acts(thread, n, n))[0]?.character ?? null));
  const author = found[0];
  const casters = found.slice(1).filter((c): c is string => c !== null);
  if (!author || casters.length === 0) throw new Error('the boards fixture has no #41 to #44');
  const caster = (n: number) => casters[n % casters.length]!;
  const post = seed.post(thread, author, POST);
  const play = (n: number, message: string, at?: number) => seed.card(caster(n), post, 'jimmy-wails', { layer: n + 1, live: true, message, drawn: PLATE_KEYS[n % PLATE_KEYS.length]!, ...(at === undefined ? {} : { at }) });

  /* The reader, last signed in: a new account that wrote none of the thread, with the wallet the case calls for. */
  const reader = seed.account('story-reader', { seasoned: true });
  const readerCharacter = seed.character(reader, 'Story reader', instanceClass);
  const gifts = async (drive: string, n: number) => {
    for (let i = 0; i < n; i += 1) {
      const donor = seed.account(`story-donor-${drive.slice(0, 6)}-${i}`, { seasoned: true });
      const mask = seed.character(donor, DONORS[i % DONORS.length]!, instanceClass);
      seed.wallet(donor, 500);
      fake.signInAs(donor);
      const answer = await fake.donate(mask, drive, [10, 25, 50, 100][(i * 7) % 4]!);
      if (!answer.ok) throw new Error(`a seeded gift was refused: ${answer.error}`);
    }
  };

  const single = SINGLE[shown];
  let shownThread = thread;
  let wallet = 500;
  if (single) {
    play(single.plate, single.long ? LONG : SHORT[single.plate]!);
  } else if (shown === 'three' || shown === 'wall') {
    const first = play(0, SHORT[0]!);
    play(1, SHORT[1]!);
    play(2, LONG);
    if (shown === 'wall') await gifts(first, 26);
    else await gifts(first, 3);
  } else if (shown === 'closed') {
    const first = play(0, SHORT[0]!);
    play(2, SHORT[2]!);
    await gifts(first, 11);
    fake.clock.advance(back);
  } else if (shown === 'earlier') {
    const first = play(1, SHORT[1]!);
    play(0, LONG);
    await gifts(first, 7);
    fake.clock.advance(back);
    play(2, SHORT[2]!);
  } else if (shown === 'origin') {
    const first = play(0, SHORT[0]!);
    play(1, SHORT[1]!);
    await gifts(first, 4);
    fake.signInAs(reader);
    const spun = await fake.spin(post, readerCharacter, 'A thread about that appeal', 'Is it a real appeal? I have questions.');
    if (!spun.ok) throw new Error(`the spin was refused: ${spun.error}`);
    shownThread = spun.value.thread.id;
  } else {
    play(0, SHORT[0]!);
    wallet = 20;
  }
  seed.wallet(reader, wallet);
  fake.signInAs(reader);
  return shownThread;
}

function Appealing({ shown, mode, reduced }: Args) {
  const { api, instance } = useKayfa();
  const thread = /^\/t\/([^/]+)/u.exec(useLocation().path)?.[1] ?? null;
  /* The thread is drawn once the plays and gifts are seeded: its page is read once, so a play seeded after the read is never drawn. */
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-kb-mode', mode);
    root.setAttribute('data-kb-motion', reduced ? 'reduce' : 'full');
    return () => { root.removeAttribute('data-kb-mode'); root.removeAttribute('data-kb-motion'); };
  }, [mode, reduced]);
  useEffect(() => {
    if (thread === null) return;
    let live = true;
    const done = seededFor.get(api) ?? new Map<string, Promise<string>>();
    seededFor.set(api, done);
    /* Once per case: spinning moves the address to the spun thread, and the effect must not seed that one again. */
    const key = shown;
    const seeded = done.get(key) ?? seedCase(api as Fake, thread, shown, instance.classes[0]!.key);
    done.set(key, seeded);
    seeded.then((t) => { if (live) setReady(t); }).catch((e: unknown) => { console.error('the Jimmy Wails story could not be seeded', e); });
    return () => { live = false; };
  }, [api, instance, thread, shown]);
  return <Frame>{ready ? <LoadedThread thread={ready} /> : <div aria-busy="true" />}</Frame>;
}

const meta: Meta<typeof Appealing> = {
  title: 'Boards/21 Jimmy Wails',
  component: Appealing,
  parameters: { moment: '01-main', layout: 'fullscreen' },
  args: { shown: 'blue-short', mode: 'light', reduced: false },
};
export default meta;

type Story = StoryObj<typeof Appealing>;
const phone = { parameters: { moment: '02-phone' } } as const;

export const BlueShortLight: Story = { args: { shown: 'blue-short', mode: 'light' } };
export const BlueShortDark: Story = { args: { shown: 'blue-short', mode: 'dark' } };
export const BlueShortPhone: Story = { args: { shown: 'blue-short', mode: 'light' }, ...phone };
export const BlueShortPhoneDark: Story = { args: { shown: 'blue-short', mode: 'dark' }, ...phone };
export const BlueLongLight: Story = { args: { shown: 'blue-long', mode: 'light' } };
export const BlueLongDark: Story = { args: { shown: 'blue-long', mode: 'dark' } };
export const BlueLongPhone: Story = { args: { shown: 'blue-long', mode: 'light' }, ...phone };
export const BlueLongPhoneDark: Story = { args: { shown: 'blue-long', mode: 'dark' }, ...phone };

export const CloseShortLight: Story = { args: { shown: 'close-short', mode: 'light' } };
export const CloseShortDark: Story = { args: { shown: 'close-short', mode: 'dark' } };
export const CloseShortPhone: Story = { args: { shown: 'close-short', mode: 'light' }, ...phone };
export const CloseShortPhoneDark: Story = { args: { shown: 'close-short', mode: 'dark' }, ...phone };
export const CloseLongLight: Story = { args: { shown: 'close-long', mode: 'light' } };
export const CloseLongDark: Story = { args: { shown: 'close-long', mode: 'dark' } };
export const CloseLongPhone: Story = { args: { shown: 'close-long', mode: 'light' }, ...phone };
export const CloseLongPhoneDark: Story = { args: { shown: 'close-long', mode: 'dark' }, ...phone };

export const DarkShortLight: Story = { args: { shown: 'dark-short', mode: 'light' } };
export const DarkShortDark: Story = { args: { shown: 'dark-short', mode: 'dark' } };
export const DarkShortPhone: Story = { args: { shown: 'dark-short', mode: 'light' }, ...phone };
export const DarkShortPhoneDark: Story = { args: { shown: 'dark-short', mode: 'dark' }, ...phone };
export const DarkLongLight: Story = { args: { shown: 'dark-long', mode: 'light' } };
export const DarkLongDark: Story = { args: { shown: 'dark-long', mode: 'dark' } };
export const DarkLongPhone: Story = { args: { shown: 'dark-long', mode: 'light' }, ...phone };
export const DarkLongPhoneDark: Story = { args: { shown: 'dark-long', mode: 'dark' }, ...phone };

export const ThreeLight: Story = { args: { shown: 'three', mode: 'light' } };
export const ThreeDark: Story = { args: { shown: 'three', mode: 'dark' } };
export const ThreePhone: Story = { args: { shown: 'three', mode: 'light' }, ...phone };
export const ThreePhoneDark: Story = { args: { shown: 'three', mode: 'dark' }, ...phone };
export const StillLight: Story = { args: { shown: 'three', mode: 'light', reduced: true } };
export const StillDark: Story = { args: { shown: 'three', mode: 'dark', reduced: true } };
export const StillPhone: Story = { args: { shown: 'three', mode: 'light', reduced: true }, ...phone };
export const StillPhoneDark: Story = { args: { shown: 'three', mode: 'dark', reduced: true }, ...phone };

export const WallLight: Story = { args: { shown: 'wall', mode: 'light' } };
export const WallDark: Story = { args: { shown: 'wall', mode: 'dark' } };
export const WallPhone: Story = { args: { shown: 'wall', mode: 'light' }, ...phone };
export const WallPhoneDark: Story = { args: { shown: 'wall', mode: 'dark' }, ...phone };

export const ClosedLight: Story = { args: { shown: 'closed', mode: 'light' } };
export const ClosedDark: Story = { args: { shown: 'closed', mode: 'dark' } };
export const ClosedPhone: Story = { args: { shown: 'closed', mode: 'light' }, ...phone };
export const ClosedPhoneDark: Story = { args: { shown: 'closed', mode: 'dark' }, ...phone };

export const EarlierLight: Story = { args: { shown: 'earlier', mode: 'light' } };
export const EarlierDark: Story = { args: { shown: 'earlier', mode: 'dark' } };
export const EarlierPhone: Story = { args: { shown: 'earlier', mode: 'light' }, ...phone };
export const EarlierPhoneDark: Story = { args: { shown: 'earlier', mode: 'dark' }, ...phone };

export const OriginLight: Story = { args: { shown: 'origin', mode: 'light' } };
export const OriginDark: Story = { args: { shown: 'origin', mode: 'dark' } };
export const OriginPhone: Story = { args: { shown: 'origin', mode: 'light' }, ...phone };
export const OriginPhoneDark: Story = { args: { shown: 'origin', mode: 'dark' }, ...phone };

export const ShortLight: Story = { args: { shown: 'short', mode: 'light' } };
export const ShortDark: Story = { args: { shown: 'short', mode: 'dark' } };
export const ShortPhone: Story = { args: { shown: 'short', mode: 'light' }, ...phone };
export const ShortPhoneDark: Story = { args: { shown: 'short', mode: 'dark' }, ...phone };
