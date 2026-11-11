/**
 * Updates at /updates (the alerts plan, Task 7; the alerts design, section 6, and board 03-updates.html): the instance's developer persona's
 * posts, each a dev-blog post (the persona's avatar, name and tagline; a dated headline; prose; a plain "What changed" list) with an archive
 * beside it. React reacts as the HUD's character, with one plain "React" button; Spin a thread starts a thread on the board with the update
 * in its ORIGIN box. The chips are glass. Everything on the page is what `api.updates()` returned and nothing else: no model is asked.
 */
import fs from 'node:fs';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Fake } from '../data/fake.ts';
import { addressOf, useLocation } from '../router.tsx';
import type { Instance } from '../../rules/types.ts';
import { buildWorld, holdReads, renderIn, testInstance } from '../test-world.tsx';
import { ThreadScreen } from '../thread/Thread.tsx';
import { LoadedUpdates } from '../loaded.tsx';
import { UpdatesScreen } from './Updates.tsx';
import { LoadedThread } from '../loaded.tsx';

const entered = vi.hoisted(() => ({ calls: [] as Element[] }));
vi.mock('motion/react', async (orig) => ({
  ...(await orig<typeof import('motion/react')>()),
  animate: (el: Element) => { entered.calls.push(el); return { then: () => {}, stop: () => {} }; },
}));

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

const gabe = { name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe' };
const instance: Instance = { ...testInstance, developer: gabe };
const AVATARS = { gabe: '/avatars/gabe.png' };
const at = (day: number, hour = 8) => Date.UTC(2026, 10, day, hour);

function world(o: { updates?: number } = {}) {
  const fake = buildWorld(undefined, instance);
  const { seed } = fake;
  const me = seed.account('me');
  const other = seed.account('other');
  const admin = seed.account('admin');
  seed.admin(admin);
  const pipe = seed.character(me, 'Pipewrench', 'heel');
  const spritey = seed.character(other, 'Spritey', 'face');
  const old = seed.update({ title: 'Welcome to playtest', body: 'Hello there.', at: at(1) });
  const mid = seed.update({ title: 'Washes 20% faster', body: 'Because you asked nicely.', changes: [{ label: 'Whoops!', text: 'washes faster.' }], at: at(1, 18) });
  const newest = seed.update({
    title: 'Traps now bite board cards',
    body: 'Somebody played Main Event on a pinned thread.\n\nThe trap was right to be offended.',
    changes: [{ label: 'Card Collector', text: 'can now catch a card played on a thread or a board.' }, { label: 'Fixed:', text: 'the log names what a card was played on.' }, { label: '', text: 'No label on this one.' }],
    at: at(2),
  });
  for (let i = 0; i < (o.updates ?? 0); i++) seed.update({ title: `Older ${i}`, body: 'x', at: at(1) - (i + 1) * 3_600_000 });
  fake.signInAs(me);
  return { fake, me, other, admin, pipe, spritey, old, mid, newest };
}

const show = (fake: Fake, path = '/updates') => renderIn(fake, <LoadedUpdates />, { path, instance, avatars: AVATARS });
const article = () => screen.getByRole('article');

describe('the persona\'s picture', () => {
  test('is drawn pixelated, so a sprite stays crisp', () => {
    const css = fs.readFileSync('engine/ui/updates/persona.css', 'utf8');
    const rule = /\.kb-updates-ava img\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/image-rendering:\s*pixelated/u);
  });
});

describe('the page', () => {
  test('the open update\'s Realtime channel is subscribed once across a re-render of the page', async () => {
    const w = world({ updates: 22 });
    const sub = vi.spyOn(w.fake, 'subscribeThread');
    show(w.fake);
    await screen.findByRole('navigation', { name: 'All updates' });
    await waitFor(() => expect(sub).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier updates' }));
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'All updates' })).getAllByRole('link')).toHaveLength(25));
    await new Promise((r) => setTimeout(r, 50));
    expect(sub).toHaveBeenCalledTimes(1);
  });

  test('is whole in its first render, from its document: the articles, the archive, the open update\'s reactions, and nothing read', async () => {
    const w = world();
    must(await w.fake.react(w.newest, w.pipe, 'tea'));
    const boot = await w.fake.boot();
    const doc = await w.fake.updatesPage(null, null, null);
    const read = holdReads(w.fake, ['session']);
    renderIn(w.fake, <UpdatesScreen doc={doc} />, { path: '/updates', instance, avatars: AVATARS, boot });
    expect(screen.getByRole('article', { name: 'Traps now bite board cards' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'All updates' })).getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Tea, 1, including yours/u })).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(read).toEqual([]);
  });

  test('reads one updatesPage for the address and none of its old reads; the admin is boot\'s', async () => {
    const w = world();
    const page = vi.spyOn(w.fake, 'updatesPage');
    const own = ['updates', 'tallies', 'myReactions', 'isAdmin', 'adminQueue'] as const;
    const spies = own.map((n) => vi.spyOn(w.fake, n));
    renderIn(w.fake, <LoadedUpdates />, { path: '/updates?update=' + w.mid, instance, avatars: AVATARS, boot: await w.fake.boot() });
    await screen.findByRole('article', { name: 'Washes 20% faster' });
    expect(page).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledWith(w.mid, null, null);
    expect(spies.map((spy) => spy.mock.calls.length)).toEqual(own.map(() => 0));
  });

  test('a handover address asks for its season in the same read', async () => {
    const w = world();
    const page = vi.spyOn(w.fake, 'updatesPage');
    renderIn(w.fake, <LoadedUpdates />, { path: '/updates?write=handover&season=2', instance, avatars: AVATARS });
    await screen.findByRole('article', { name: 'Traps now bite board cards' });
    expect(page).toHaveBeenCalledWith(null, null, 2);
  });

  test('an older update opened after Show earlier updates is not the one the document read reactions for, so its own are read', async () => {
    const w = world({ updates: 22 });
    const ancient = w.fake.seed.update({ title: 'Ancient', body: 'x', at: at(1) - 100 * 3_600_000 });
    must(await w.fake.react(ancient, w.pipe, 'tea'));
    show(w.fake);
    await screen.findByRole('navigation', { name: 'All updates' });
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier updates' }));
    await userEvent.click(await screen.findByRole('link', { name: /Ancient/u }));
    expect(await screen.findByRole('article', { name: 'Ancient' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Tea, 1, including yours/u })).toBeInTheDocument();
  });

  test('beside it, the archive (all updates, the open one included) lists every update newest first with its date; the open one is the current page', async () => {
    const w = world();
    show(w.fake);
    const nav = await screen.findByRole('navigation', { name: 'All updates' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Traps now bite board cardsNov 2', 'Washes 20% fasterNov 1', 'Welcome to playtestNov 1']);
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(links[1]).not.toHaveAttribute('aria-current');
    expect(links[1]).toHaveAttribute('href', `/updates?update=${encodeURIComponent(w.mid)}`);
  });

  test('an archive link opens that update in the article, and an address names one', async () => {
    const w = world();
    function Where() { return <p data-testid="where">{addressOf(useLocation())}</p>; }
    renderIn(w.fake, <><LoadedUpdates /><Where /></>, { path: '/updates', instance, avatars: AVATARS });
    await userEvent.click(await screen.findByRole('link', { name: /Washes 20% faster/u }));
    expect(await screen.findByRole('article', { name: 'Washes 20% faster' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(`/updates?update=${w.mid}`);
    expect(within(article()).queryByRole('heading', { level: 3, name: 'What changed' })).toBeInTheDocument();
    expect(within(article()).getByText('Because you asked nicely.')).toBeInTheDocument();
  });

  test('an address naming an update that is not there opens the newest, and an update with no changes has no list', async () => {
    const w = world();
    show(w.fake, '/updates?update=nope');
    expect(await screen.findByRole('article', { name: 'Traps now bite board cards' })).toBeInTheDocument();
    document.body.innerHTML = '';
    show(w.fake, `/updates?update=${w.old}`);
    const post = await screen.findByRole('article', { name: 'Welcome to playtest' });
    expect(within(post).queryByRole('heading', { name: 'What changed' })).toBeNull();
    expect(within(post).queryByRole('list')).toBeNull();
  });

  test('shows words as words: markup in an update is not run', async () => {
    const w = world();
    w.fake.seed.update({ title: 'Markup', body: '<script>window.__ran = 1</script><img src=x onerror="window.__ran = 2">', changes: [{ label: '<b>', text: '<i>text</i>' }], at: at(3) });
    show(w.fake);
    const post = await screen.findByRole('article', { name: 'Markup' });
    expect(post.querySelector('script, img[onerror]')).toBeNull();
    expect(post).toHaveTextContent('<script>window.__ran = 1</script>');
    expect(post.querySelector('ul.kb-updates-changes')).toHaveTextContent('<b> <i>text</i>');
    expect((window as unknown as { __ran?: number }).__ran).toBeUndefined();
  });

  test('the persona is the engine\'s plain one where the instance gave none', async () => {
    const fake = buildWorld();
    const me = fake.seed.account('me');
    fake.seed.update({ title: 'Plain', body: 'Words.', at: at(2) });
    fake.signInAs(me);
    renderIn(fake, <LoadedUpdates />, { path: '/updates' });
    const post = await screen.findByRole('article', { name: 'Plain' });
    expect(within(post).getByText('The developers')).toBeInTheDocument();
    expect(post.querySelector('img')).toBeNull();
    expect(screen.getByText(/The voice is The developers'; every fact in it is true\./u)).toBeInTheDocument();
  });

  test('with no update yet it says so plainly, and a visitor is asked to sign in', async () => {
    const fake = buildWorld(undefined, instance);
    fake.signInAs(fake.seed.account('me'));
    renderIn(fake, <LoadedUpdates />, { path: '/updates', instance });
    expect(await screen.findByText(/Nothing here yet/u)).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
    document.body.innerHTML = '';
    fake.signInAs(null);
    renderIn(fake, <LoadedUpdates />, { path: '/updates', instance });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  test('earlier updates come a page at a time, from the oldest read', async () => {
    const w = world({ updates: 22 });
    show(w.fake);
    const nav = await screen.findByRole('navigation', { name: 'All updates' });
    expect(within(nav).getAllByRole('link')).toHaveLength(20);
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier updates' }));
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(25));
    expect(screen.queryByRole('button', { name: 'Show earlier updates' })).toBeNull();
  });

  test('Show earlier updates is busy until its page lands, and only the rows it adds enter', async () => {
    const w = world({ updates: 22 });
    const orig = w.fake.updates.bind(w.fake);
    let land!: () => void;
    vi.spyOn(w.fake, 'updates').mockImplementation((...a) => new Promise((resolve) => { land = () => resolve(orig(...a)); }));
    show(w.fake);
    const nav = await screen.findByRole('navigation', { name: 'All updates' });
    entered.calls.length = 0;
    await userEvent.click(screen.getByRole('button', { name: 'Show earlier updates' }));
    expect(screen.getByRole('button', { name: 'Show earlier updates' })).toHaveAttribute('aria-busy', 'true');
    expect(entered.calls).toHaveLength(0);
    land();
    await waitFor(() => expect(within(nav).getAllByRole('link')).toHaveLength(25));
    await waitFor(() => expect(entered.calls).toHaveLength(5));
    expect(entered.calls).toEqual(within(nav).getAllByRole('listitem').slice(20));
    expect(nav.querySelector('[data-kb-entering]')).toBeNull();
  });
});

describe('React and Spin a thread', () => {
  test('React is one plain button that reacts as the HUD\'s character; the reactions are meta tiles', async () => {
    const w = world();
    /* The player's characters are the frame's (boot), so the HUD's character is there when the page is drawn. */
    renderIn(w.fake, <LoadedUpdates />, { path: '/updates', instance, avatars: AVATARS, boot: await w.fake.boot() });
    const post = await screen.findByRole('article', { name: 'Traps now bite board cards' });
    const reactions = post.querySelector('.kb-reactions')!;
    expect(reactions).toHaveAttribute('data-kb-over-ink');
    expect(post.querySelector('[data-kb-look]')).toBeNull();
    const button = within(post).getByRole('button', { name: 'React' });
    expect(button).toHaveClass('kb-meta-tile');
    expect(within(post).queryByRole('button', { name: /React as/u })).toBeNull();
    await userEvent.click(button);
    const picker = await screen.findByRole('dialog', { name: /^React to / });
    await userEvent.click(within(picker).getByRole('button', { name: /Fire/u }));
    await waitFor(() => expect(within(post).getByRole('button', { name: /Fire, 1, including yours/u })).toBeInTheDocument());
    const chips = post.querySelector('ul.kb-reaction-list')!;
    expect(chips.closest('.kb-reactions')).toHaveAttribute('data-kb-over-ink');
    expect(within(chips as HTMLElement).getAllByRole('listitem')).toHaveLength(1);
    expect((await w.fake.tallies([w.newest]))[w.newest]).toEqual({ fire: 1 });
    expect((await w.fake.myReactions([w.newest])).map((r) => [r.kind, r.character])).toEqual([['fire', w.pipe]]);
  });

  test('says plainly that a reaction here pays no one and a spun thread opens on the board with the update in its origin box', async () => {
    const w = world();
    show(w.fake);
    const post = await screen.findByRole('article', { name: 'Traps now bite board cards' });
    expect(within(post).getByText(/Reactions here pay no one\. A spun thread opens on the board with this update in its origin box\./u)).toBeInTheDocument();
  });

  test('another update\'s reactions are its own: the tally follows the open update', async () => {
    const w = world();
    must(await w.fake.react(w.mid, w.pipe, 'tea'));
    show(w.fake);
    await screen.findByRole('article', { name: 'Traps now bite board cards' });
    expect(screen.queryByRole('button', { name: /Tea, 1/u })).toBeNull();
    await userEvent.click(screen.getByRole('link', { name: /Washes 20% faster/u }));
    expect(await screen.findByRole('button', { name: /Tea, 1, including yours/u })).toBeInTheDocument();
  });

  test('Spin a thread opens the spin form for the update, as the HUD\'s character, and goes to the new thread, whose origin is the update', async () => {
    const w = world();
    function Where() { return <p data-testid="where">{useLocation().path}</p>; }
    renderIn(w.fake, <><LoadedUpdates /><Where /></>, { path: '/updates', instance, avatars: AVATARS });
    const post = await screen.findByRole('article', { name: 'Traps now bite board cards' });
    await userEvent.click(within(post).getByRole('button', { name: 'Spin a thread on the board' }));
    const form = await screen.findByRole('form', { name: /^Spin a thread from the update/u });
    expect(within(form).getByText('Pipewrench').tagName).toBe('STRONG');
    await userEvent.type(within(form).getByLabelText('Thread title'), 'Pinned forever');
    await userEvent.click(within(form).getByRole('button', { name: 'Spin thread' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/t\//u));
    const spun = await w.fake.spunFrom(w.newest);
    expect(spun).toHaveLength(1);
    expect(spun[0]).toMatchObject({ title: 'Pinned forever', originActId: w.newest, origin: { kind: 'update', act: w.newest, title: 'Traps now bite board cards' } });
    expect(screen.getByTestId('where')).toHaveTextContent(`/t/${spun[0]!.id}`);
    expect((await w.fake.boards()).find((b) => b.id === spun[0]!.board)!.isSystem).toBe(false);
  });

  test('Spin a thread is a toggle: pressed again it closes the form', async () => {
    const w = world();
    show(w.fake);
    const post = await screen.findByRole('article', { name: 'Traps now bite board cards' });
    const toggle = within(post).getByRole('button', { name: 'Spin a thread on the board' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(screen.queryByRole('form')).toBeNull();
  });

  test('a player with no character can read, and is told why there is no React button; spinning says the same', async () => {
    const fake = buildWorld(undefined, instance);
    fake.seed.update({ title: 'Quiet', body: 'x', at: at(2) });
    fake.signInAs(fake.seed.account('nobody'));
    renderIn(fake, <LoadedUpdates />, { path: '/updates', instance });
    const post = await screen.findByRole('article', { name: 'Quiet' });
    expect(within(post).queryByRole('button', { name: 'React' })).toBeNull();
    await userEvent.click(within(post).getByRole('button', { name: 'Spin a thread on the board' }));
    expect(screen.getByText(/None of your characters can post yet/u)).toBeInTheDocument();
  });
});

describe('a thread spun from an update', () => {
  test('shows the update in its ORIGIN box, with its words and What changed, and links back to the Updates page, not to a thread the board never lists', async () => {
    const w = world();
    Element.prototype.scrollIntoView = vi.fn();
    const spun = must(await w.fake.spin(w.newest, w.pipe, 'Pinned forever', 'Argue.'));
    renderIn(w.fake, <LoadedThread thread={spun.thread.id} />, { path: `/t/${spun.thread.id}`, instance });
    const origin = await screen.findByRole('group', { name: 'Origin' });
    await waitFor(() => expect(within(origin).getByText('Traps now bite board cards')).toBeInTheDocument());
    expect(within(origin).getByText('The trap was right to be offended.')).toBeInTheDocument();
    expect(within(origin).getByRole('list', { name: 'What changed' })).toHaveTextContent('Card Collector can now catch a card played on a thread or a board.');
    expect(await within(origin).findByText('Gabe')).toBeInTheDocument();
    const back = within(origin).getByRole('link', { name: 'the update “Traps now bite board cards”' });
    expect(back).toHaveAttribute('href', `/updates?update=${encodeURIComponent(w.newest)}`);
    expect(within(origin).queryByRole('link', { name: /#\d+ in Updates/u })).toBeNull();
  });
});

describe('the admin\'s form', () => {
  test('only an admin is offered Write an update', async () => {
    const w = world();
    show(w.fake);
    await screen.findByRole('article', { name: 'Traps now bite board cards' });
    expect(screen.queryByRole('button', { name: 'Write an update' })).toBeNull();
    document.body.innerHTML = '';
    w.fake.signInAs(w.admin);
    show(w.fake);
    await screen.findByRole('article', { name: 'Traps now bite board cards' });
    expect(await screen.findByRole('button', { name: 'Write an update' })).toBeInTheDocument();
  });

  test('a posted update opens at once, newest, and is in the archive', async () => {
    const w = world();
    w.fake.signInAs(w.admin);
    w.fake.clock.advance(30 * 24 * 3_600_000);
    show(w.fake);
    await screen.findByRole('article', { name: 'Traps now bite board cards' });
    await userEvent.click(await screen.findByRole('button', { name: 'Write an update' }));
    const form = await screen.findByRole('form', { name: 'Write an update' });
    await userEvent.type(within(form).getByLabelText('Title'), 'Brand new');
    await userEvent.type(within(form).getByLabelText('Words'), 'It is new.');
    await userEvent.click(within(form).getByRole('button', { name: 'Post update' }));
    expect(await screen.findByRole('article', { name: 'Brand new' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'All updates' })).getAllByRole('link')[0]).toHaveTextContent('Brand new');
    expect((await w.fake.updates())[0]!.title).toBe('Brand new');
  });
});

function must<T>(a: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!a.ok) throw new Error(a.error);
  return a.value;
}

describe('opened from a handover to-do', () => {
  const handedOver = () => {
    const w = world();
    w.fake.seed.staff('old-boss', 'Old Boss', 'boss');
    w.fake.seed.staff('comptroller', 'Comptroller', 'mod');
    w.fake.seed.handover({ outgoing: 'old-boss', boss: 'comptroller', at: at(3), bossWas: 'mod', outgoingOffice: 'member' });
    /* The page's clock is past the handover, as a real one is, so an update posted now is posted after it. */
    w.fake.clock.advance(Math.max(0, at(3) + 3_600_000 - w.fake.clock.now()));
    w.fake.signInAs(w.admin);
    return w;
  };

  test('?write=handover&season=2 opens the writer with the handover\'s facts, for an admin', async () => {
    show(handedOver().fake, '/updates?write=handover&season=2');
    const form = await screen.findByRole('form', { name: 'Write an update' });
    expect(within(form).getByLabelText('Title')).toHaveValue('Season 2 opens with Comptroller');
    expect(within(form).getByLabelText('Words')).toHaveValue('Season 2: The Boss is Comptroller (was a Moderator).\n\nOld Boss is now a member.\n\nThe Boss was chosen by the roster\'s rotation.');
  });

  test('the draft says the role in the instance\'s word', async () => {
    renderIn(handedOver().fake, <LoadedUpdates />, { path: '/updates?write=handover&season=2', instance, avatars: AVATARS, copy: { roleWord: 'The Champ' } });
    const form = await screen.findByRole('form', { name: 'Write an update' });
    expect(within(form).getByLabelText('Words')).toHaveValue('Season 2: The Champ is Comptroller (was a Moderator).\n\nOld Boss is now a member.\n\nThe Champ was chosen by the roster\'s rotation.');
  });

  test('a season with no to-do opens the empty writer and says the to-do is already cleared', async () => {
    show(handedOver().fake, '/updates?write=handover&season=9');
    const form = await screen.findByRole('form', { name: 'Write an update' });
    expect(within(form).getByLabelText('Title')).toHaveValue('');
    expect(screen.getByText(/no to-do for season 9/u)).toBeInTheDocument();
  });

  test('a to-do list that could not be read fails the page, which the glass says plainly and reads again', async () => {
    const w = handedOver();
    vi.spyOn(w.fake, 'updatesPage').mockRejectedValueOnce(new Error('offline'));
    show(w.fake, '/updates?write=handover&season=2');
    expect(await screen.findByRole('heading', { name: 'The page cannot be displayed' })).toBeInTheDocument();
    expect(screen.queryByText(/no to-do for season/u)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('form', { name: 'Write an update' })).toBeInTheDocument();
  });

  test.each(['abc', '0', '-1', '3.5'])('season=%s says plainly that the address names no season', async (bad) => {
    show(handedOver().fake, `/updates?write=handover&season=${bad}`);
    expect(await screen.findByText(/names no season/u)).toBeInTheDocument();
    expect(screen.queryByText(/no to-do for season/u)).toBeNull();
  });

  test('a player who is not an admin gets no writer from the address', async () => {
    const w = handedOver();
    w.fake.signInAs(w.me);
    show(w.fake, '/updates?write=handover&season=2');
    await screen.findByRole('article');
    expect(screen.queryByRole('form', { name: 'Write an update' })).toBeNull();
  });

  test('posting the announcement clears the to-do', async () => {
    const w = handedOver();
    show(w.fake, '/updates?write=handover&season=2');
    const form = await screen.findByRole('form', { name: 'Write an update' });
    const words = within(form).getByLabelText('Words');
    await userEvent.clear(words);
    await userEvent.type(words, 'Comptroller has the seat.');
    await userEvent.click(within(form).getByRole('button', { name: 'Post update' }));
    await waitFor(async () => expect((await w.fake.adminQueue()).todos).toEqual([]));
  });
});
