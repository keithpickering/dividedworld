/**
 * The quiet tags over a post (docs/plans/2026-10-31-plays-on-a-post-design.md, section 3): the top-billed play as a
 * one-line tag with its top reactions small, the rest as chips in their card's color, up to three on a desktop and
 * none on a phone, then "+N more". Each is a button that opens its play.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Id } from '../data/api.ts';
import type { Fake } from '../data/fake.ts';
import { buildWorld, renderIn } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import type { CardUi } from './types.ts';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A window as narrow as a phone, or as wide as a desktop, as matchMedia answers the thread's 40em breakpoint. */
function width(phone: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: phone && q.includes('max-width: 40em'), media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }) as unknown as MediaQueryList);
}

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
  const { thread, act: first } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  fake.signInAs(me);
  /* Plays on post 2, a minute apart, each newer than the last: with nothing drawn, the newest is billed first. */
  const play = (character: Id, card = 'whoops', message = '') => {
    fake.clock.advance(60_000);
    return fake.seed.card(character, second, card, { message });
  };
  return { fake, me, other, pipe, spritey, gloomba, thread, first, second, play };
}
const open = (w: { fake: Fake; thread: Id }, cards?: readonly CardUi[]) =>
  renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}`, ...(cards ? { cards } : {}) });
const tags = async () => within(await screen.findByRole('article', { name: /^Post 2 /u })).findByRole('list', { name: 'Cards played on this post' });
const tagOf = (list: HTMLElement) => list.querySelectorAll<HTMLElement>('.kb-play-tag');
const chipsOf = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>('.kb-play-chip')];
const playOf = (el: Element) => el.closest('[data-kb-play]')?.getAttribute('data-kb-play');

describe('the tags over a post', () => {
  test('follow billing: the play that has drawn the most is the tag, and the chips follow in billing order', async () => {
    width(false);
    const w = world();
    const a = w.play(w.spritey);
    const b = w.play(w.gloomba, 'stick-around');
    const c = w.play(w.spritey);
    w.fake.seed.react(w.me, w.pipe, a, 'fire');
    open(w);
    const list = await tags();
    await waitFor(() => expect(tagOf(list)).toHaveLength(1));
    expect(playOf(tagOf(list)[0]!)).toBe(a);
    expect(chipsOf(list).map(playOf)).toEqual([c, b]);
  });

  test('one play draws one tag and no chips, and no "+N more"', async () => {
    width(false);
    const w = world();
    w.play(w.spritey);
    open(w);
    const list = await tags();
    expect(tagOf(list)).toHaveLength(1);
    expect(chipsOf(list)).toHaveLength(0);
    expect(within(list).queryByRole('button', { name: /^Show \d+ more/u })).toBeNull();
  });

  test('five plays on a desktop draw one tag, three chips and "+1 more"', async () => {
    width(false);
    const w = world();
    for (let i = 0; i < 5; i++) w.play(i % 2 ? w.gloomba : w.spritey);
    open(w);
    const list = await tags();
    expect(tagOf(list)).toHaveLength(1);
    expect(chipsOf(list)).toHaveLength(3);
    expect(within(list).getByRole('button', { name: 'Show 1 more card played on this post' })).toHaveTextContent('+1 more');
  });

  test('on a phone there are no chips, and "+N more" counts every play but the first', async () => {
    width(true);
    const w = world();
    for (let i = 0; i < 5; i++) w.play(i % 2 ? w.gloomba : w.spritey);
    open(w);
    const list = await tags();
    expect(tagOf(list)).toHaveLength(1);
    expect(chipsOf(list)).toHaveLength(0);
    expect(within(list).getByRole('button', { name: 'Show 4 more cards played on this post' })).toHaveTextContent('+4 more');
  });

  test('"+N more" is a disclosure that shows the rest in place', async () => {
    width(true);
    const w = world();
    const ids = Array.from({ length: 5 }, (_, i) => w.play(i % 2 ? w.gloomba : w.spritey));
    open(w);
    const list = await tags();
    const more = within(list).getByRole('button', { name: 'Show 4 more cards played on this post' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(chipsOf(list).map(playOf)).toEqual([ids[3], ids[2], ids[1], ids[0]]);
    const fewer = within(list).getByRole('button', { name: 'Show fewer cards played on this post' });
    expect(fewer).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(fewer);
    expect(chipsOf(list)).toHaveLength(0);
  });

  test('each tag and chip is a button named in one sentence that opens the play; the tag is no link', async () => {
    width(false);
    const w = world();
    const a = w.play(w.spritey, 'whoops', 'you dropped your ink');
    w.play(w.gloomba);
    w.fake.seed.react(w.me, w.pipe, a, 'fire');
    w.fake.seed.react(w.me, w.pipe, a, 'tea');
    open(w);
    const list = await tags();
    expect(within(list).getByRole('button', { name: 'Whoops! by Spritey, 2 reactions. Opens the play.' })).toHaveClass('kb-play-tag');
    expect(within(list).getByRole('button', { name: 'Whoops! by Gloomba, no reactions. Opens the play.' })).toHaveClass('kb-play-chip');
    expect(within(list).queryByRole('link')).toBeNull();
    /* The message and the time are the panel's now. */
    expect(list).not.toHaveTextContent('you dropped your ink');
    expect(list.querySelector('time')).toBeNull();
  });

  test('a tag shows at most three of its reactions, the largest first, in the instance\'s glyphs', async () => {
    width(false);
    const w = world();
    const a = w.play(w.pipe);
    /* tea 3, fire 2, tomato 1, zzz 1: zzz is the fourth, and loses the tie to tomato, which comes first in the instance's order. Each from a player of its own. */
    let fans = 0;
    const fan = (kind: string) => {
      const account = w.fake.seed.account(`fan${++fans}`);
      w.fake.seed.react(account, w.fake.seed.character(account, `Fan ${fans}`, 'face'), a, kind);
    };
    for (const kind of ['tea', 'tea', 'tea', 'fire', 'fire', 'zzz', 'tomato']) fan(kind);
    open(w);
    const list = await tags();
    const tag = tagOf(list)[0]!;
    await waitFor(() => expect(tag.querySelectorAll('[data-kb-reaction]')).toHaveLength(3));
    expect([...tag.querySelectorAll('[data-kb-reaction]')].map((r) => r.textContent)).toEqual(['E 3', 'F 2', 'T 1']);
    expect(tag).toHaveAccessibleName('Whoops! by Pipewrench, 7 reactions. Opens the play.');
  });

  test('a play with no reactions shows none', async () => {
    width(false);
    const w = world();
    w.play(w.spritey);
    open(w);
    const tag = tagOf(await tags())[0]!;
    expect(tag.querySelectorAll('[data-kb-reaction]')).toHaveLength(0);
  });

  test('a chip\'s ink is the card\'s `tag` hook\'s, else its alignment\'s', async () => {
    width(false);
    const w = world();
    const inked = w.play(w.spritey);
    w.play(w.gloomba, 'stick-around');
    w.play(w.spritey);
    const whoops: CardUi = { key: 'whoops', art: { color: '#000000', ink: '#ffffff' }, describe: () => 'whoops', tag: (play) => (play.id === inked ? '#ff2bd6' : undefined) };
    open(w, [whoops]);
    const list = await tags();
    const chips = chipsOf(list);
    const chip = chips.find((c) => playOf(c) === inked)!;
    expect(chip.style.getPropertyValue('--kb-tag')).toBe('#ff2bd6');
    expect(chip).toHaveAttribute('data-kb-tinted', 'true');
    for (const other of chips.filter((c) => c !== chip)) expect(other.style.getPropertyValue('--kb-tag')).toBe('');
  });
});
