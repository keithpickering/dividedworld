/**
 * Laugh Track on a thread, as stories for the owner's word (docs/plans/2026-11-11-laugh-track-plan.md, Task 13; the point-and-hear rule is docs/plans/2026-11-12-laugh-track-point-plan.md, Task 4):
 * the bench's thread (docs/research/2026-11-11-laugh-track-bench/01-bench.html), a post in which "Luigi" is booed twice, a phrase is cheered and another is
 * laughed at, on the Main board and at 390 wide, the Phone one. `Main` and `Phone` show the thread at rest, no cue marked. `NearMain` and `NearPhone` scroll the
 * first "Luigi" onto the reading line: its dotted underline is at full in Salty's ink and nothing has been heard. `HeardMain` and `HeardPhone` then click it:
 * it is heard and stays underlined at full. The story route renders no play function, so e2e/laugh-track.spec.ts does the scrolling and the clicking itself.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { waitFor } from 'storybook/test';
import { Frame } from '../../../../engine/ui/frame/Frame.tsx';
import { LoadedThread } from '../../../../engine/ui/loaded.tsx';
import type { World } from '../../../../engine/ui/story.tsx';

/** The thread the world seeded: a story's world is made before it renders. */
let thread = '';

const CUES = [{ phrase: 'Luigi', sound: 'boo' }, { phrase: 'the greatest game ever made', sound: 'cheer' }, { phrase: 'we came in first', sound: 'laugh' }];

const world: World = (fake, instance) => {
  const [first, second] = instance.classes;
  const player = fake.seed.account('story-player', { seasoned: true });
  const spritey = fake.seed.character(player, 'Spritey', first!.key);
  const gloomba = fake.seed.character(fake.seed.account('gloomba'), 'Gloomba', (second ?? first)!.key);
  const kooper = fake.seed.character(fake.seed.account('kooper'), 'Kooper Trooper', first!.key);
  const board = instance.boards.find((b) => !b.system)!.slug;
  const made = fake.seed.thread(board, kooper, 'Ranking every Mario Kart', 'Ranking every Mario Kart, worst to best. Number one is Double Dash, and I will not be taking questions.');
  fake.seed.post(made.thread, kooper, 'Number two is the Wii one, mostly for the bikes. Number three is 8 Deluxe, which is fine, it is just fine.\n\nAnd before anyone starts: no, the blue shell is not "skill expression". It is a punishment for being good at the game.');
  const post = fake.seed.post(made.thread, gloomba, [
    'This is a good list and I agree with most of it, except for one thing that I need to address at length.',
    'The best driver in the entire series is Luigi. I will not be taking questions. He has the death stare. He has the moustache. He has the quiet confidence of a man who knows he is better than his brother.',
    'Some people will tell you Luigi is a meme. Those people have never lost a race to him on Rainbow Road at two in the morning.',
    'Anyway, Double Dash is still the greatest game ever made, and I would die on that hill.',
    'Also my cat walked on the controller during the final lap once and we came in first. True story.',
    'That is all. Thank you for coming to my talk.',
  ].join('\n\n'));
  fake.seed.post(made.thread, kooper, 'lol\n\n(For the record, the cat is the best driver.)');
  fake.seed.card(spritey, post, 'laugh-track', { layer: 1, live: true, config: { cues: CUES, seed: 7 }, message: 'Laugh Track' });
  fake.signInAs(player);
  thread = made.thread;
};

function Thread() {
  return <Frame><LoadedThread thread={thread} /></Frame>;
}

const meta: Meta<typeof Thread> = {
  title: 'Boards/21 Laugh Track',
  component: Thread,
  parameters: { world, layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof Thread>;
const phone = { viewport: { value: 'glassPhone390', isRotated: false } };

/** The line's place in the window, as the card's default reads it (laughTrack.line: 40% of the way down the space above the HUD). A cue scrolled to it is as near as it gets, so its mark is full. */
async function toTheLine(canvasElement: HTMLElement): Promise<HTMLElement | null> {
  /* jsdom, where the stories are swept for accessibility (web/a11y.test.tsx), has no layout and no IntersectionObserver, so the watcher
     registers nothing and no mark could show; there the story shows the thread at rest, and the near and heard screens are held in a browser by
     e2e/a11y.spec.ts and e2e/laugh-track.spec.ts. */
  if (typeof IntersectionObserver === 'undefined') return null;
  const cue = await waitFor(() => {
    const found = canvasElement.querySelector<HTMLElement>('.dw-lt-cue');
    if (!found) throw new Error('the first cue is not drawn yet');
    return found;
  });
  const hud = Number.parseFloat(document.documentElement.style.getPropertyValue('--kb-hud-measured')) || 0;
  const line = ((window.innerHeight - hud) * 40) / 100;
  const box = cue.getBoundingClientRect();
  window.scrollBy(0, box.top + box.height / 2 - line);
  await waitFor(() => { if (cue.style.getPropertyValue('--dw-lt-near') !== '1') throw new Error('the cue is not marked yet'); }, { timeout: 4000 });
  return cue;
}

/** Brings the first cue to the line and clicks it: it is heard. */
async function heard(canvasElement: HTMLElement): Promise<void> {
  const cue = await toTheLine(canvasElement);
  if (!cue) return;
  cue.click();
  await waitFor(() => { if (!cue.classList.contains('dw-lt-fired')) throw new Error('the cue has not been heard'); }, { timeout: 4000 });
}

/** The thread on the Main board: no cue is marked. */
export const Main: Story = {};
/** The thread on the Phone board. */
export const Phone: Story = { globals: phone };
/** The first "Luigi" is on the line: its dotted underline is at full, and nothing has been heard. */
export const NearMain: Story = { name: 'Near, main', play: async ({ canvasElement }) => { await toTheLine(canvasElement); } };
/** The same on the Phone board. */
export const NearPhone: Story = { name: 'Near, phone 390', globals: phone, play: async ({ canvasElement }) => { await toTheLine(canvasElement); } };
/** The first "Luigi" was then clicked: it is heard and stays underlined. */
export const HeardMain: Story = { name: 'Heard, main', play: async ({ canvasElement }) => { await heard(canvasElement); } };
/** The same on the Phone board. */
export const HeardPhone: Story = { name: 'Heard, phone 390', globals: phone, play: async ({ canvasElement }) => { await heard(canvasElement); } };
