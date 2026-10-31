/**
 * The quiet tags over a post (docs/plans/2026-10-31-plays-on-a-post-design.md, section 3, as the owner amended it on
 * #97's shots): the top-billed play's tag, with the others stacked behind it, and a button that unstacks them into a
 * list floating over the post, each the same tag that opens its play.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
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

function world() {
  const fake = buildWorld();
  const me = fake.seed.account('me');
  const other = fake.seed.account('other');
  const pipe = fake.seed.character(me, 'Pipewrench', 'heel');
  const spritey = fake.seed.character(other, 'Spritey', 'face');
  const gloomba = fake.seed.character(other, 'Gloomba', 'heel');
  const { thread } = fake.seed.thread('general', spritey, 'A thread', 'post 1');
  const second = fake.seed.post(thread, spritey, 'post 2');
  fake.signInAs(me);
  /* Plays on post 2, a minute apart, each newer than the last: with nothing drawn, the newest is billed first. */
  const play = (character: Id, card = 'whoops', message = '') => {
    fake.clock.advance(60_000);
    return fake.seed.card(character, second, card, { message });
  };
  return { fake, me, other, pipe, spritey, gloomba, thread, second, play };
}
const open = (w: { fake: Fake; thread: Id }, cards?: readonly CardUi[]) =>
  renderIn(w.fake, <ThreadScreen thread={w.thread} />, { path: `/t/${w.thread}`, ...(cards ? { cards } : {}) });
const post2 = () => screen.findByRole('article', { name: /^Post 2 /u });
const tags = async () => within(await post2()).findByRole('list', { name: 'Cards played on this post' });
/** The tags a reader can reach now, in the order they are drawn. */
const reachable = (list: HTMLElement) => within(list).queryAllByRole('button', { name: /Opens the play\.$/u });
const playOf = (el: Element) => el.getAttribute('data-kb-play');
const unstack = (list: HTMLElement) => within(list).getByRole('button', { name: /^Unstack \d+ more cards? played on this post$/u });

describe('the stack of plays over a post', () => {
  test('one play is its tag alone: nothing is stacked behind it and there is nothing to unstack', async () => {
    const w = world();
    w.play(w.spritey);
    open(w);
    const list = await tags();
    expect(reachable(list)).toHaveLength(1);
    expect(list.querySelectorAll('.kb-play-stack-edge')).toHaveLength(0);
    expect(within(list).queryByRole('button', { name: /^Unstack/u })).toBeNull();
  });

  test('stacked, the play that has drawn the most is the one tag reached, with the others\' edges behind it and a button for them', async () => {
    const w = world();
    const a = w.play(w.spritey);
    w.play(w.gloomba, 'stick-around');
    w.play(w.spritey);
    w.fake.seed.react(w.me, w.pipe, a, 'fire');
    open(w);
    const list = await tags();
    await waitFor(() => expect(reachable(list).map(playOf)).toEqual([a]));
    const edges = [...list.querySelectorAll('.kb-play-stack-edge')];
    expect(edges).toHaveLength(2);
    for (const edge of edges) expect(edge.closest('[aria-hidden="true"]')).not.toBeNull();
    const button = unstack(list);
    expect(button).toHaveAccessibleName('Unstack 2 more cards played on this post');
    expect(button).toHaveTextContent('+2');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('at most three edges are stacked behind, however many plays there are, and the button counts them all', async () => {
    const w = world();
    for (let i = 0; i < 6; i++) w.play(i % 2 ? w.gloomba : w.spritey);
    open(w);
    const list = await tags();
    expect(list.querySelectorAll('.kb-play-stack-edge')).toHaveLength(3);
    expect(unstack(list)).toHaveAccessibleName('Unstack 5 more cards played on this post');
  });

  test('unstacked, every play is its own tag, in billing order, and the button stacks them again', async () => {
    const w = world();
    const ids = Array.from({ length: 4 }, (_, i) => w.play(i % 2 ? w.gloomba : w.spritey));
    open(w);
    const list = await tags();
    const button = unstack(list);
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName('Stack the cards played on this post');
    expect(reachable(list).map(playOf)).toEqual([ids[3], ids[2], ids[1], ids[0]]);
    /* The list it floats is the button's to show and hide. */
    expect(button).toHaveAttribute('aria-controls', list.querySelector('.kb-play-unstacked')!.id);
    await userEvent.click(button);
    expect(reachable(list)).toHaveLength(1);
    expect(button).toHaveFocus();
  });

  test('Esc stacks it, and focus goes back to the button', async () => {
    const w = world();
    w.play(w.spritey);
    w.play(w.gloomba);
    open(w);
    const list = await tags();
    await userEvent.click(unstack(list));
    const [, second] = reachable(list);
    second!.focus();
    await userEvent.keyboard('{Escape}');
    expect(reachable(list)).toHaveLength(1);
    expect(within(list).getByRole('button', { name: /^Unstack/u })).toHaveFocus();
  });

  test('a press outside it stacks it', async () => {
    const w = world();
    w.play(w.spritey);
    w.play(w.gloomba);
    open(w);
    const list = await tags();
    await userEvent.click(unstack(list));
    await userEvent.pointer({ keys: '[MouseLeft]', target: document.body });
    expect(reachable(list)).toHaveLength(1);
  });

  test('unstacked, a clear backdrop lies under the list: a press on it stacks the list, and goes no further', async () => {
    const w = world();
    w.play(w.spritey);
    w.play(w.gloomba);
    open(w);
    const list = await tags();
    expect(list.querySelector('.kb-play-backdrop')).toBeNull();
    await userEvent.click(unstack(list));
    const backdrop = list.querySelector('.kb-play-backdrop')!;
    expect(backdrop).toHaveAttribute('aria-hidden', 'true');
    await userEvent.pointer({ keys: '[MouseLeft]', target: backdrop });
    expect(reachable(list)).toHaveLength(1);
    expect(list.querySelector('.kb-play-backdrop')).toBeNull();
  });

  test('unstacked, what it floats over in its post is out of reach until it is stacked: the post\'s footer, its plate and its reactions', async () => {
    const w = world();
    w.play(w.spritey);
    w.play(w.gloomba);
    open(w);
    const list = await tags();
    const post = await post2();
    const under = () => [post.querySelector('footer'), ...post.querySelectorAll('.kb-act-main > :not(.kb-play-tags)')].filter((el): el is HTMLElement => el !== null);
    expect(under().length).toBeGreaterThan(1);
    expect(under().every((el) => !el.hasAttribute('inert'))).toBe(true);
    await userEvent.click(unstack(list));
    expect(under().every((el) => el.hasAttribute('inert'))).toBe(true);
    expect(list.closest('[inert]')).toBeNull();
    await userEvent.keyboard('{Escape}');
    expect(under().every((el) => !el.hasAttribute('inert'))).toBe(true);
  });

  test('Tab past the last tag stacks it and goes on to the post\'s own controls, as Tab leaves a menu; Shift+Tab before the button does too', async () => {
    const w = world();
    w.play(w.spritey);
    w.play(w.gloomba);
    open(w);
    const list = await tags();
    const post = await post2();
    await userEvent.click(unstack(list));
    reachable(list).at(-1)!.focus();
    await userEvent.tab();
    expect(reachable(list)).toHaveLength(1);
    expect(post.contains(document.activeElement)).toBe(true);
    expect(list.contains(document.activeElement)).toBe(false);
    await userEvent.click(unstack(list));
    reachable(list)[0]!.focus();
    await userEvent.tab({ shift: true });
    expect(reachable(list)).toHaveLength(1);
    expect(list.contains(document.activeElement)).toBe(false);
  });

  test('a play\'s panel opened from the list keeps the list unstacked: Esc closes the panel first, and focus goes back to its tag', async () => {
    const w = world();
    w.play(w.spritey);
    w.play(w.gloomba);
    open(w);
    const list = await tags();
    await userEvent.click(unstack(list));
    const lower = reachable(list)[1]!;
    await userEvent.click(lower);
    expect(screen.getByRole('dialog', { name: 'Whoops! by Spritey' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(reachable(list)).toHaveLength(2);
    await waitFor(() => expect(lower).toHaveFocus());
  });

  test('a read of the page stacks it again', async () => {
    const w = world();
    for (let i = 0; i < 25; i++) w.fake.seed.post(w.thread, w.spritey, `more ${i}`);
    w.play(w.spritey);
    w.play(w.gloomba);
    open(w);
    const list = await tags();
    await userEvent.click(unstack(list));
    expect(reachable(list)).toHaveLength(2);
    await userEvent.click(screen.getAllByRole('link', { name: 'Page 2' })[0]!);
    await screen.findByRole('article', { name: /^Post 21 /u });
    await userEvent.click(screen.getAllByRole('link', { name: 'Page 1' })[0]!);
    expect(reachable(await tags())).toHaveLength(1);
  });

  test('each tag is a button named in one sentence that opens the play; it is no link and carries no message or time', async () => {
    const w = world();
    const a = w.play(w.spritey, 'whoops', 'you dropped your ink');
    w.play(w.gloomba);
    w.fake.seed.react(w.me, w.pipe, a, 'fire');
    w.fake.seed.react(w.me, w.pipe, a, 'tea');
    open(w);
    const list = await tags();
    await userEvent.click(unstack(list));
    expect(within(list).getByRole('button', { name: 'Whoops! by Spritey, 2 reactions. Opens the play.' })).toHaveClass('kb-play-tag');
    expect(within(list).getByRole('button', { name: 'Whoops! by Gloomba, no reactions. Opens the play.' })).toHaveClass('kb-play-tag');
    expect(within(list).queryByRole('link')).toBeNull();
    expect(list).not.toHaveTextContent('you dropped your ink');
    expect(list.querySelector('time')).toBeNull();
  });

  test('a tag shows at most three of its reactions, the largest first, in the instance\'s glyphs', async () => {
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
    const tag = reachable(await tags())[0]!;
    await waitFor(() => expect(tag.querySelectorAll('[data-kb-reaction]')).toHaveLength(3));
    expect([...tag.querySelectorAll('[data-kb-reaction]')].map((r) => r.textContent)).toEqual(['E 3', 'F 2', 'T 1']);
    expect(tag).toHaveAccessibleName('Whoops! by Pipewrench, 7 reactions. Opens the play.');
  });

  test('a play with no reactions shows none', async () => {
    const w = world();
    w.play(w.spritey);
    open(w);
    expect(reachable(await tags())[0]!.querySelectorAll('[data-kb-reaction]')).toHaveLength(0);
  });

  test('each tag and each edge takes its card\'s ink from the `tag` hook, else its alignment\'s', async () => {
    const w = world();
    const inked = w.play(w.spritey);
    w.play(w.gloomba, 'stick-around');
    w.play(w.spritey);
    const whoops: CardUi = { key: 'whoops', art: { color: '#000000', ink: '#ffffff' }, describe: () => 'whoops', tag: (play) => (play.id === inked ? '#ff2bd6' : undefined) };
    open(w, [whoops]);
    const list = await tags();
    /* Billed newest first: the inked play is the third, so its edge is the second behind the tag. */
    const edges = [...list.querySelectorAll<HTMLElement>('.kb-play-stack-edge')];
    expect(edges.map((e) => e.style.getPropertyValue('--kb-tag'))).toEqual(['', '#ff2bd6']);
    await userEvent.click(unstack(list));
    const tag = reachable(list).find((t) => playOf(t) === inked)!;
    expect(tag.style.getPropertyValue('--kb-tag')).toBe('#ff2bd6');
    expect(tag).toHaveAttribute('data-kb-tinted', 'true');
    for (const other of reachable(list).filter((t) => t !== tag)) expect(other.style.getPropertyValue('--kb-tag')).toBe('');
  });

  test('a phone stacks and unstacks the same way', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('max-width: 40em'), media: q, addEventListener: () => {}, removeEventListener: () => {},
    }) as unknown as MediaQueryList);
    const w = world();
    w.play(w.spritey);
    w.play(w.gloomba);
    w.play(w.spritey);
    open(w);
    const list = await tags();
    expect(reachable(list)).toHaveLength(1);
    await act(async () => { await userEvent.click(unstack(list)); });
    expect(reachable(list)).toHaveLength(3);
  });
});
