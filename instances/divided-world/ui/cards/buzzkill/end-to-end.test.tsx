/**
 * Buzzkill, end to end on the fake with the real instance and the real thread page (docs/plans/2026-11-21-buzzkill-plan.md, Task 9): it is offered
 * where a Gimmick is up and nowhere else, it ends the one the form lists, the sign, the Lens and both logs say so, a Sugar Coat turns it away where a
 * Force Field does not, and an admin's end of it brings the Gimmick back. The tests name no owner of the Gimmick: the offer and the refusal are the same whoever set it.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Act, Refusal } from '../../../../../engine/ui/data/api.ts';
import { createFake } from '../../../../../engine/ui/data/fake.ts';
import { waysOn } from '../../../../../engine/ui/cards/land.ts';
import { playOf } from '../../../../../engine/ui/cards/plays.ts';
import { logRows, type LogData, type Words } from '../../../../../engine/ui/log/lines.ts';
import { LoadedThread } from '../../../../../engine/ui/loaded.tsx';
import { renderIn } from '../../../../../engine/ui/test-world.tsx';
import { Frame } from '../../../../../engine/ui/frame/Frame.tsx';
import { hudKey } from '../../../../../engine/ui/player.tsx';
import { instance } from '../../../index.ts';
import { instanceUi } from '../../index.ts';

const must = <T,>(a: { ok: true; value: T } | Refusal): T => {
  if (!a.ok) throw new Error(`refused: ${a.error}`);
  return a.value;
};
const rulesOf = (key: string) => { const c = instance.cards.find((x) => x.key === key); if (!c) throw new Error(`no card ${key}`); return c; };

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  document.documentElement.setAttribute('data-kb-motion', 'reduce');
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) as unknown as MediaQueryList);
});
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-kb-motion'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function setup() {
  const fake = createFake({ instance });
  /* The page reads the real clock where the fake's starts in October: the fake is brought up to it, so a Gimmick's seven days run on both. */
  fake.clock.advance(Date.now() - fake.now());
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const boss = fake.seed.account('boss', { admin: true });
  const anaFace = fake.seed.character(ana, 'Ana Face', instance.classes[0]!.key);
  const boFace = fake.seed.character(bo, 'Bo Face', instance.classes[0]!.key);
  const { thread } = fake.seed.thread('general', anaFace, 'Hello', 'Ana here.');
  const kicked = fake.seed.post(thread, boFace, 'Bo, with a Kick Me.');
  const bare = fake.seed.post(thread, boFace, 'Bo, with nothing up.');
  const warded = fake.seed.post(thread, boFace, 'Bo, with a ward.');
  fake.seed.cards(ana, { buzzkill: 4 });
  fake.seed.wallet(ana, 500);
  fake.seed.cards(bo, { 'kick-me': 1, 'sugar-coat': 1, 'force-field': 1 });
  return { fake, ana, bo, boss, anaFace, boFace, thread, kicked, bare, warded };
}
type World = ReturnType<typeof setup>;

const playsOn = async (fake: World['fake'], post: string) => (await fake.postPlays([post])).plays.flatMap((a: Act) => playOf(a) ?? []);
/** Whether the ghost mark offers Buzzkill on a post, as the page asks the rules (`waysOn`), from the plays the post holds. */
const offered = async (w: World, post: string) => {
  const act = (await w.fake.actsById([post]))[0]!;
  return waysOn(rulesOf('buzzkill'), act, await playsOn(w.fake, post), { postEffects: 8, cards: instance.cards, own: false, now: w.fake.now() }).cast;
};
const logOf = async (w: World, who: string) => {
  w.fake.signInAs(who);
  const page = await w.fake.logPage(null);
  const words: Words = { instance, ui: instanceUi, postsPerPage: 20, economy: {}, now: w.fake.now() };
  const data: LogData = { log: page.log, mine: await w.fake.myCharacters(), estimate: null, standings: page.standings, season: page.season, turns: [], nextSettlement: null, acts: new Map(page.acts.map((a) => [a.id, a])), names: new Map(page.people.map((c) => [c.id, c.name])), titles: new Map(), states: new Map() };
  return logRows(data, words, 600, null);
};
const wordsOf = (rows: ReturnType<typeof logRows>, kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.details.join(''));
/** The thread page, as a reader sees it; the sign is the Kick Me's drawing. */
const showThread = async (w: World, as: string) => {
  w.fake.signInAs(as);
  renderIn(w.fake, <LoadedThread thread={w.thread} />, { path: `/t/${w.thread}`, instance, cards: instanceUi.cards });
  await screen.findAllByRole('article');
};
const signs = () => document.querySelectorAll('[role="img"][aria-label^="Kick Me sign"]');
const lensText = async (post: string, mark: RegExp) => {
  const article = await screen.findByRole('article', { name: new RegExp(`^Post ${post} `, 'u') });
  await userEvent.click(await within(article).findByRole('button', { name: mark }));
  const lens = screen.getByRole('dialog', { name: 'Cards on this post' });
  await userEvent.click(within(lens).getByRole('button', { name: /^\d+ plays? · / }));
  return lens.textContent ?? '';
};

describe('a Buzzkill ends a Gimmick early, and an admin can bring it back', () => {
  test('it is offered where a Gimmick is up, ends the Kick Me, and the sign, the Lens and both logs say so', async () => {
    const w = setup();
    const { fake, bo, boFace, anaFace, ana, kicked, bare } = w;

    // 1. Bo's Kick Me is up; Ana's ghost mark offers Buzzkill there, and not on the post with no Gimmick.
    fake.signInAs(bo);
    const kick = must(await fake.useCard('kick-me', boFace, kicked, {}, ''));
    fake.seed.card(boFace, kicked, 'whoops', { message: 'a Move, no Gimmick' });
    fake.signInAs(ana);
    expect(await offered(w, kicked)).toBe(true);
    expect(await offered(w, bare)).toBe(false);
    await showThread(w, bo);
    expect(await screen.findAllByRole('img', { name: /^Kick Me sign/u })).toHaveLength(1);
    cleanup();

    // 2. She plays it through the form on the rendered thread: arm the card, press its ghost mark on the Kick Me's post (and find none on the bare one),
    // see the form list the Kick Me by name and not the Whoops! beside it, choose it, and play.
    fake.signInAs(ana);
    localStorage.setItem(hudKey(ana), anaFace);
    renderIn(fake, <Frame><LoadedThread thread={w.thread} /></Frame>, { path: `/t/${w.thread}`, instance, cards: instanceUi.cards });
    const user = userEvent.setup();
    await screen.findByRole('article', { name: /^Post 3 /u });
    await user.click(await screen.findByRole('button', { name: /^Hand, \d postcards?/u }));
    await user.click(within(screen.getByRole('dialog', { name: 'Your hand' })).getAllByRole('button', { name: /^Buzzkill, /u })[0]!);
    const onKicked = document.getElementById('post-2')!;
    await user.click(await within(onKicked).findByRole('button', { name: 'Play Buzzkill on post 2' }));
    expect(within(document.getElementById('post-3')!).queryByRole('button', { name: 'Play Buzzkill on post 3' })).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: /Buzzkill/u });
    const picks = within(dialog).getAllByRole('radio');
    expect(picks).toHaveLength(1);
    expect(picks[0]!.closest('label')!.textContent).toContain('Kick Me');
    expect(dialog.textContent).not.toContain('Whoops');
    await user.click(picks[0]!);
    fake.clock.advance(3_600_000);
    await user.click(within(dialog).getByRole('button', { name: /^Play\b/u }));
    await waitFor(async () => expect((await fake.postPlays([kicked])).plays.some((a) => a.payload.card === 'buzzkill')).toBe(true));
    cleanup();
    const buzz = (await fake.postPlays([kicked])).plays.find((a) => a.payload.card === 'buzzkill')!;
    expect(buzz.payload).toMatchObject({ card: 'buzzkill', instant: true, cut: { play: kick.id, card: 'kick-me' } });

    // The sign is gone; the Lens rows say what ended what.
    await showThread(w, ana);
    expect(signs()).toHaveLength(0);
    expect(await lensText('2', /^Kick Me, \d plays?/u)).toContain('Ended early by a Buzzkill');
    cleanup();
    await showThread(w, ana);
    expect(await lensText('2', /^Buzzkill, \d plays?/u)).toContain('Ended the Kick Me here early');
    cleanup();

    // A's log says what it ended; B's says what ended it, at the Buzzkill's time and not the Kick Me's own.
    expect((await logOf(w, ana)).flatMap((r) => r.details.join('')).some((l) => l.includes(' It ended the Kick Me there.'))).toBe(true);
    const rows = await logOf(w, bo);
    expect(wordsOf(rows, 'gimmickEnded').some((l) => l.includes('A Buzzkill ended it early.'))).toBe(true);
    const ended = rows.find((r) => r.kind === 'gimmickEnded' && r.key === `gimmickEnded:${kick.id}`)!;
    expect(Date.parse(ended.at)).toBe(Date.parse(buzz.createdAt));
  });

  test('a Sugar Coat turns a Buzzkill away in its words; a Force Field does not, and the Buzzkill ends it', async () => {
    const w = setup();
    const { fake, bo, boFace, anaFace, ana, warded } = w;
    fake.signInAs(bo);
    const coat = must(await fake.useCard('sugar-coat', boFace, warded, {}, ''));
    fake.signInAs(ana);
    const turned = await fake.playCard('buzzkill', anaFace, warded, { play: coat.id }, '');
    expect(turned.ok).toBe(false);
    if (!turned.ok) expect(turned.error).toBe("this post's Sugar Coat turns away Salty cards");

    // With the Sugar Coat gone and a Force Field up in its place, the Buzzkill lands on the Force Field.
    fake.signInAs(w.boss);
    must(await fake.reverseCard(coat.id));
    fake.signInAs(bo);
    const field = must(await fake.useCard('force-field', boFace, warded, {}, ''));
    fake.signInAs(ana);
    const cut = must(await fake.playCard('buzzkill', anaFace, warded, { play: field.id }, ''));
    expect(cut.payload.cut).toEqual({ play: field.id, card: 'force-field' });
  });

  test('an admin who ends the Buzzkill brings the Kick Me back, up until its time, and its player is told', async () => {
    const w = setup();
    const { fake, bo, boFace, anaFace, ana, boss, kicked } = w;
    fake.signInAs(bo);
    const kick = must(await fake.useCard('kick-me', boFace, kicked, {}, ''));
    fake.signInAs(ana);
    fake.clock.advance(3_600_000);
    const buzz = must(await fake.playCard('buzzkill', anaFace, kicked, { play: kick.id }, ''));
    await showThread(w, ana);
    expect(signs()).toHaveLength(0);
    cleanup();

    fake.signInAs(boss);
    must(await fake.reverseCard(buzz.id));
    await showThread(w, bo);
    expect(signs()).toHaveLength(1);
    cleanup();

    const until = (await fake.actsById([kick.id]))[0]!.payload.ends as string;
    const said = wordsOf(await logOf(w, bo), 'ended');
    expect(said.some((l) => /Your Kick Me is back up until .* UTC\./u.test(l))).toBe(true);
    const t = new Date(until);
    expect(said.join(' ')).toContain(`${t.getUTCDate()} · ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')} UTC`);
  });
});
