/**
 * The stage's world and parts (Stage.board.stories.tsx, stage-world.ts, stage-play.ts; docs/plans/2026-11-21-commentary-video-plan.md, Task 4),
 * held to what the commentary video's shots rely on: who is whose mask, what is face down on which post, and that a cast, a reaction and a
 * spring are the backend's own and not a staging of their outcome. A vitest file, since the nodes and the camera draw.
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createFake, type Fake } from '../../../../engine/ui/data/fake.ts';
import { instance } from '../../index.ts';
import { Camera, levelBoard, turnBoard } from './Camera.tsx';
import { Nodes, nodes } from './Nodes.tsx';
import { pendingOf } from './forecast.ts';
import { chairId, FILM_ORDER, PILE, playbook } from './stage-play.ts';
import { postTarget, type CardEffect, type CardTarget } from '../../../../engine/rules/cards.ts';
import { buildStage } from './stage-world.ts';
import { objectOf } from '../steel-chair/objects.ts';
import { Mini } from '../../../../engine/ui/mini.tsx';

/** The stage, seeded and ready, with the film's player signed in as `as` (Snuckles's player when none). */
async function stage(as: string | null = null) {
  const fake: Fake = createFake({ instance });
  const made = buildStage(fake, instance, { skin: 'default', as, view: 'thread', sheet: false });
  await made.ready;
  return { fake, made, play: playbook(fake, instance, made) };
}

/** What a player's characters are, by name, as that player sees them. */
async function classesOf(fake: Fake, account: string) {
  fake.signInAs(account);
  return Object.fromEntries((await fake.myCharacters()).map((c) => [c.name, c.class]));
}

/** How many of a card the player the page is signed in as holds. */
async function held(fake: Fake, account: string, card: string) {
  fake.signInAs(account);
  return (await fake.myCards()).find((c) => c.card === card)?.held ?? 0;
}

describe('the seats', () => {
  test('D-Guy and Chadluminum are one player\'s masks, a Heel and a Face; Snuckles and Human Josh the film\'s first player\'s; Serious Deer a third\'s', async () => {
    const { fake, made } = await stage();
    const o = made.owners;
    expect(o['D-Guy']).toBe(o['Chadluminum']);
    expect(o['Snuckles']).toBe(o['Human Josh']);
    expect(o['Serious Deer']).not.toBe(o['Snuckles']);
    expect(o['Serious Deer']).not.toBe(o['D-Guy']);
    expect(o['Snuckles']).not.toBe(o['D-Guy']);
    expect(await classesOf(fake, o['D-Guy']!)).toEqual({ 'D-Guy': 'heel', Chadluminum: 'face' });
    expect((await classesOf(fake, o['Snuckles']!))['Snuckles']).toBe('jabroni');
  });

  test('`as=` signs in that character\'s player and makes that character the one the HUD plays', async () => {
    localStorage.clear();
    const { made } = await stage('D-Guy');
    expect(made.viewer).toBe(made.owners['D-Guy']);
    expect(made.played).toBe('D-Guy');
    expect(localStorage.getItem(`kb-hud:${made.viewer}`)).toBe(made.cast['D-Guy']);
    const plain = await stage();
    expect(plain.made.viewer).toBe(plain.made.owners['Snuckles']);
    expect(plain.made.played).toBe('Snuckles');
  });

  test('Human Josh has no picture (his source could not be licensed), and the stage draws his initial where a face would be, the others keeping theirs', async () => {
    const { fake, made } = await stage();
    const ids = Object.values(made.cast);
    const faces = Object.fromEntries((await fake.characters(ids)).map((c) => [c.name, c]));
    expect(faces['Human Josh']!.avatarSquare).toBeNull();
    expect(faces['Human Josh']!.avatarPortrait).toBeNull();
    for (const name of ['Snuckles', 'Chadluminum', 'Serious Deer', 'D-Guy']) expect(faces[name]!.avatarSquare, name).not.toBeNull();
    const { container } = render(<Mini character={faces['Human Josh']} name="Human Josh" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.kb-mini-none')).toHaveTextContent('H');
  });

  test('a name the cast has not is refused, naming the cast', async () => {
    const fake = createFake({ instance });
    expect(() => buildStage(fake, instance, { skin: 'default', as: 'Nobody', view: 'thread', sheet: false })).toThrow(/no character named "Nobody"[\s\S]*D-Guy/);
  });
});

describe('the thread', () => {
  test('the words the shots wait on are in it: the review, the kind post, "walk cycle" in Snuckles\'s first post, and the dressed posts at the foot', async () => {
    const { fake, made } = await stage();
    const body = async (seq: number) => ((await fake.acts(made.thread, seq, seq))[0]!.currentPayload as { body: string }).body;
    expect(await body(made.posts['first']!)).toContain('walk cycle');
    expect(await body(made.posts['review']!)).toContain('2/10');
    expect(await body(made.posts['review']!)).toContain('twelve frames and none of them are walking');
    expect(await body(made.posts['kind']!)).toContain('wonderful');
    const authors = new Map((await fake.acts(made.thread, 1, 30)).map((a) => [a.seq, a.character]));
    expect(authors.get(made.posts['review']!)).toBe(made.cast['D-Guy']);
    expect(authors.get(made.posts['kind']!)).toBe(made.cast['Chadluminum']);
    /* Round 1's posts are where its shots left them. */
    expect(made.scenes).toEqual({ kind: 7, recount: 8, review: 9, joke: 10, appeal: 11, filed: 12, friends: 13 });
    for (const key of ['hotBox', 'glitter', 'fab', 'graffiti', 'autocorrect']) expect(made.posts[key]).toBeGreaterThan(made.posts['review']!);
  });

  test('each of the five dressed posts wears its one live effect', async () => {
    const { fake, made } = await stage();
    const on = async (key: string) => (await fake.postPlays([made.acts[key]!])).plays.filter((a) => a.kind === 'card').map((a) => (a.payload as { card: string }).card);
    expect(await on('hotBox')).toEqual(['hot-box']);
    expect(await on('fab')).toEqual(['feelin-fab']);
    expect(await on('graffiti')).toEqual(['graffiti']);
    expect(await on('autocorrect')).toEqual(['autocorrect']);
    /* Glitter Bomb sits on its author, and shows on the author's post. */
    const reach = await fake.effectsAbove([made.cast['Nosebleeds']!], made.thread, null);
    expect(reach.map((r) => (r.act.payload as { card: string }).card)).toEqual(['glitter-bomb']);
  });
});

describe('what is face down before the camera runs', () => {
  test('Rope Break on Snuckles\'s first post, 4D Chess on D-Guy\'s review, a Steel Chair on Chadluminum\'s kind post, each its setter\'s alone to read', async () => {
    const { fake, made } = await stage();
    const back = async (account: string, set: string) => (await (fake.signInAs(account), fake.myFaceDown([set])))[set];
    const targetOf = async (post: string, set: string) => (await fake.postPlays([post])).plays.some((a) => a.id === set && a.kind === 'set');
    const o = made.owners;
    expect(await back(o['Snuckles']!, made.sets['ropeBreak']!)).toBe('rope-break');
    expect(await back(o['D-Guy']!, made.sets['fourDChess']!)).toBe('4d-chess');
    expect(await back(o['Chadluminum']!, made.sets['steelChair']!)).toBe('steel-chair');
    expect(await targetOf(made.acts['first']!, made.sets['ropeBreak']!)).toBe(true);
    expect(await targetOf(made.acts['review']!, made.sets['fourDChess']!)).toBe(true);
    expect(await targetOf(made.acts['kind']!, made.sets['steelChair']!)).toBe(true);
    /* Every back looks the same: another player is told none of the three. */
    expect(await back(o['Serious Deer']!, made.sets['ropeBreak']!)).toBeUndefined();
  });

  test('the Steel Chair waits for the phrase "to be fair"', async () => {
    const { fake, made } = await stage();
    fake.signInAs(made.owners['Chadluminum']!);
    const row = (await fake.log()).cards.find((c) => c.act === made.sets['steelChair']);
    expect(row?.phrase).toBe('to be fair');
  });
});

describe('a real cast', () => {
  test('D-Guy\'s Whoops! on Snuckles\'s first post is caught by the Rope Break, and Snuckles\'s player then holds the Whoops!', async () => {
    const { fake, made, play } = await stage('D-Guy');
    const before = await held(fake, made.owners['Snuckles']!, 'whoops');
    fake.signInAs(made.viewer);
    const cast = await play.cast('D-Guy', made.posts['first']!, 'whoops', { color: '#3d77ff' });
    expect(cast.caught).toBe(true);
    expect(cast.rode).toBe(false);
    expect(await held(fake, made.owners['Snuckles']!, 'whoops')).toBe(before + 1);
    /* The cast was D-Guy's player's own whoops: it is gone from their hand, and no ink landed on the post. */
    expect(await held(fake, made.owners['D-Guy']!, 'whoops')).toBe(0);
    const plays = (await fake.postPlays([made.acts['first']!])).plays.filter((a) => a.kind === 'card');
    expect(plays.every((a) => (a.payload as { caught?: unknown }).caught !== undefined)).toBe(true);
    /* The page is signed in as it was. */
    expect((await fake.session()).account).toBe(made.viewer);
  });

  test('told() writes the caster the trapStruck alert the backend writes for a caught cast, and says nothing where none was caught', async () => {
    const { fake, made, play } = await stage('D-Guy');
    await expect(play.told('D-Guy', made.posts['first']!)).rejects.toThrow(/no caught cast/);
    await play.cast('D-Guy', made.posts['first']!, 'whoops', { color: '#3d77ff' });
    expect((await fake.alertsPage(null)).alerts.some((a) => a.kind === 'trapStruck')).toBe(false);
    await play.told('D-Guy', made.posts['first']!);
    expect((await fake.alertsPage(null)).alerts.some((a) => a.kind === 'trapStruck')).toBe(true);
  });

  test('Snuckles\'s Whoops! on D-Guy\'s review lands (an ink play is on it), and the spring there says it rode, naming the quadrant', async () => {
    const { fake, made, play } = await stage();
    const cast = await play.cast('Snuckles', made.posts['review']!, 'whoops', { color: '#ff2bd6' });
    expect(cast.rode).toBe(true);
    expect(cast.caught).toBe(false);
    const there = (await fake.postPlays([made.acts['review']!])).plays;
    const ink = there.filter((a) => a.kind === 'card' && (a.payload as { card?: string }).card === 'whoops');
    expect(ink).toHaveLength(1);
    expect((ink[0]!.payload as { caught?: unknown }).caught).toBeUndefined();
    const spring = there.find((a) => a.kind === 'spring');
    expect(spring?.payload).toMatchObject({ card: '4d-chess', did: 'rode', quadrant: 'excitedNegative' });
  });

  test('a spring on a quote lands the chair on the quoting post, and says so', async () => {
    const { fake, made, play } = await stage();
    const quoted = await play.quoteSprings('Human Josh', made.posts['kind']!, 'to be fair, it is a good walk cycle.');
    const on = (await fake.postPlays([quoted.post])).plays;
    expect(on.filter((a) => a.kind === 'card').map((a) => (a.payload as { card: string }).card)).toEqual(['steel-chair']);
    expect((await fake.postPlays([made.acts['kind']!])).plays.find((a) => a.kind === 'spring')?.payload).toMatchObject({ card: 'steel-chair', trigger: 'quote', did: 'landed' });
  });
});

describe('a call that throws', () => {
  test('a part\'s call that throws leaves the film\'s player signed in, not the other player the call was made as', async () => {
    const { fake, made, play } = await stage('D-Guy');
    const original = fake.react.bind(fake);
    fake.react = (() => { throw new Error('the backend threw'); }) as typeof fake.react;
    await expect(play.react('Snuckles', made.posts['review']!, 'tomato')).rejects.toThrow(/the backend threw/);
    expect((await fake.session()).account, 'the page is the film\'s player again').toBe(made.viewer);
    fake.react = original;
  });

  test('so does the world\'s own setting of a card face down: a throw there leaves the film\'s player signed in', async () => {
    const fake: Fake = createFake({ instance });
    const set = fake.setCard.bind(fake);
    fake.setCard = ((card: string, ...rest: Parameters<typeof fake.setCard> extends [string, ...infer R] ? R : never) => { if (card === '4d-chess') throw new Error('the backend threw'); return set(card, ...rest); }) as typeof fake.setCard;
    const made = buildStage(fake, instance, { skin: 'default', as: null, view: 'thread', sheet: false });
    await expect(made.ready).rejects.toThrow(/the backend threw/);
    expect((await fake.session()).account).toBe(made.viewer);
  });

  test('the merge makes a board that is not there and skips one that is, and says nothing of any other failure', async () => {
    const { fake, made, play } = await stage();
    fake.seed.board(made.boards.palace, 'Plumber Platformer Palace', 'A board for Mario fangames.');
    await expect(play.staff.merge()).resolves.toBeTypeOf('string');
    const seeded = fake.seed.board.bind(fake.seed);
    fake.seed.board = () => { throw new Error('the database is gone'); };
    await expect(play.staff.merge()).rejects.toThrow(/the database is gone/);
    fake.seed.board = seeded;
  });
});

describe('a spring on a post written another way', () => {
  test('a quoting post the composer wrote gets the chair and the spring, as one `quoteSprings` writes', async () => {
    const { fake, made, play } = await stage('Human Josh');
    const quoted = (await fake.acts(made.thread, made.posts['kind']!, made.posts['kind']!))[0]!;
    fake.signInAs(made.viewer);
    const wrote = await fake.post(made.thread, made.cast['Human Josh']!, 'to be fair, it is a good walk cycle.', quoted.id);
    if (!wrote.ok) throw new Error(wrote.error);
    const sprang = await play.springsOn(made.posts['kind']!, wrote.value.id);
    expect((await fake.postPlays([wrote.value.id])).plays.filter((a) => a.kind === 'card').map((a) => (a.payload as { card: string }).card)).toEqual(['steel-chair']);
    expect((await fake.postPlays([made.acts['kind']!])).plays.find((a) => a.id === sprang.spring)?.payload).toMatchObject({ card: 'steel-chair', trigger: 'quote', did: 'landed' });
  });

  test('chairId passes over ids that roll something else: a ladder\'s and a trash can\'s are drawn and skipped, a chair\'s is kept', () => {
    const drawn = ['play-2', 'play-6', 'play-0'];
    const spy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => drawn.shift() as `${string}-${string}-${string}-${string}-${string}`);
    try {
      expect(chairId()).toBe('play-0');
      expect(drawn).toEqual([]);
    } finally { spy.mockRestore(); }
  });

  test('every Steel Chair the stage seeds rolls a chair: the pile\'s three on Snuckles\'s first post, and the one a quote springs', async () => {
    const { fake, made, play } = await stage();
    for (const what of FILM_ORDER.n11.chairs) await play.pile(PILE.findIndex((p) => p.what === what));
    const chairsOnFirst = (await fake.postPlays([made.acts['first']!])).plays.filter((a) => a.kind === 'card' && (a.payload as { card: string }).card === 'steel-chair');
    expect(chairsOnFirst).toHaveLength(3);
    expect(chairsOnFirst.map((a) => objectOf(a.id))).toEqual(['chair', 'chair', 'chair']);
    fake.signInAs(made.viewer);
    const quoted = (await fake.acts(made.thread, made.posts['kind']!, made.posts['kind']!))[0]!;
    const wrote = await fake.post(made.thread, made.cast['Human Josh']!, 'to be fair, it is a good walk cycle.', quoted.id);
    if (!wrote.ok) throw new Error(wrote.error);
    const sprang = await play.springsOn(made.posts['kind']!, wrote.value.id);
    expect(objectOf(sprang.play)).toBe('chair');
  });
});

describe('the heap', () => {
  /**
   * Replays plays in the order the film lands them, each decided by the card's own `canApply` against the effects already on the post
   * (or on the character, for a card that reaches one) at that moment, and the plays that are allowed added to them as the page holds them.
   */
  async function allowed(order: readonly string[]) {
    const { fake, made } = await stage();
    const first = (await fake.acts(made.thread, 1, 1))[0]!;
    const body = (first.currentPayload as { body: string }).body;
    const now = new Date(Date.now() + 1000);
    const far = new Date(now.getTime() + 5 * 86_400_000).toISOString();
    const post: CardEffect[] = [], character: CardEffect[] = [];
    const verdicts: { what: string; ok: boolean; why?: string }[] = [];
    for (const what of order) {
      const step = PILE.find((p) => p.what === what)!;
      const rules = instance.cards.find((c) => c.key === step.card)!;
      const target: CardTarget = step.reach === 'character' ? { reach: 'character', character: made.target.character } : postTarget(made.acts['first']!, 'post', body, undefined, undefined, made.cast['Snuckles']);
      const verdict = rules.canApply(target, step.reach === 'character' ? character : post, step.config, now);
      verdicts.push({ what, ok: verdict.ok, ...(verdict.ok ? {} : { why: verdict.why }) });
      if (verdict.ok) (step.reach === 'character' ? character : post).push({ card: step.card, act: what, ...(step.reach === 'character' ? { reach: 'character' as const } : {}), ...(rules.lasts !== undefined || step.reach === 'character' ? { ends: far } : {}), ...(rules.gimmick ? { gimmick: rules.gimmick } : {}) });
    }
    return verdicts;
  }

  test('every play of the heap is one the rules allow, in the order the film lands them', async () => {
    for (const [take, order] of [['node 9', FILM_ORDER.n09], ['node 11 (the chairs, then the heap, on one page)', [...FILM_ORDER.n11.chairs, ...FILM_ORDER.n11.heap]]] as const) {
      const verdicts = await allowed(order);
      expect(verdicts.filter((v) => !v.ok), `${take}: ${JSON.stringify(verdicts.filter((v) => !v.ok))}`).toEqual([]);
    }
    /* At least three Whoops! and three Steel Chairs, and no play the order does not name. */
    expect(FILM_ORDER.n09.filter((w) => w.startsWith('whoops'))).toHaveLength(3);
    expect(FILM_ORDER.n09.filter((w) => w.startsWith('steel-chair'))).toHaveLength(3);
    expect([...FILM_ORDER.n09].sort()).toEqual(PILE.map((p) => p.what).sort());
  });

  test('the rules do refuse a fourth Whoops!, a second Laugh Track and a play on a post that has no words to continue: the replay is not vacuous', async () => {
    const verdicts = await allowed([...FILM_ORDER.n09, 'whoops-1', 'laugh-track']);
    expect(verdicts.slice(-2).map((v) => v.ok)).toEqual([false, false]);
    expect(verdicts.at(-2)!.why).toMatch(/already carries 3/);
  });

  test('the Rope Break face down on post 1 would catch the heap\'s first Salty cast, so the film springs it before the heap: a real cast is caught once, and the next lands', async () => {
    const { fake, made, play } = await stage('D-Guy');
    const caught = await play.cast('D-Guy', made.posts['first']!, 'whoops', { color: '#3d77ff' });
    expect(caught.caught).toBe(true);
    const lands = await play.cast('Serious Deer', made.posts['first']!, 'whoops', { color: '#19e3ff', seed: 202 });
    expect(lands.caught).toBe(false);
    expect(lands.rode).toBe(false);
    expect((await fake.session()).account).toBe(made.viewer);
  });
});

describe('the Staff\'s beats', () => {
  test('the memo is FanGaME\'s own words, posted in the thread', async () => {
    const { fake, made, play } = await stage();
    const id = await play.staff.memo();
    const posts = await fake.acts(made.thread, 1, 40);
    const memo = posts.find((a) => a.id === id)!;
    expect(memo.character).toBe(made.staff['fangame']);
    expect((memo.currentPayload as { body: string }).body).toContain('FanGaME here, writing per my own initiative, as nobody asked');
  });

  test('the merge closes the Palace into World -1 and the Boss\'s move carries his reason', async () => {
    const { fake, made, play } = await stage();
    const move = await play.staff.merge();
    const page = await fake.boardPage(made.boards.palace, 1, []);
    expect(page?.closed?.mergedInto?.slug).toBe(made.boards.minus);
    const announced = (await fake.acts((await fake.boardPage('announcements', 1, []))!.threads[0]!.id, 1, 60)).find((a) => a.id === move)!;
    expect(announced.kind).toBe('move');
    expect(made.threads['announcements']).toBe((await fake.boardPage('announcements', 1, []))!.threads[0]!.id);
    expect(JSON.stringify(announced.payload)).toContain('Nobody posted on my board anyway');
  });

  test('a Mod files Snuckles\'s first post: its visit ends filed, and a warning lands on him', async () => {
    const { fake, made, play } = await stage();
    const visit = await play.staff.file();
    const story = await fake.visitStory(made.thread, visit, made.acts['first']!);
    expect(story.end?.outcome).toBe('filed');
    expect(story.infraction?.points).toBe(3);
    expect(story.warnPoints).toBe(9);
  });
});

describe('the forecast', () => {
  test('excited-negative reactions raise a Heel\'s forecast, one by one, and a calm-positive one lowers it', async () => {
    const { fake, made, play } = await stage('D-Guy');
    const review = made.posts['review']!;
    const forecast = async () => pendingOf(await fake.estimate());
    let last = await forecast();
    expect(last).toBe(0);
    for (const [name, key] of [['Snuckles', 'tomato'], ['Serious Deer', 'tomato'], ['Ringside', 'tomato'], ['Front Row', 'tomato'], ['Nosebleeds', 'vomiting']] as const) {
      await play.react(name, review, key);
      const now = await forecast();
      expect(now, `${name}'s ${key}`).toBeGreaterThan(last);
      last = now;
    }
    await play.react('Aisle Seat', review, 'thumbs-up');
    const after = await forecast();
    expect(after).toBeLessThan(last);
    expect((await fake.session()).account).toBe(made.viewer);
  });

  test('the counts the world seeded on its posts are its backdrop: the first player\'s forecast starts at nothing', async () => {
    const { fake } = await stage();
    expect(pendingOf(await fake.estimate())).toBe(0);
  });

  test('the same tomato on the Face\'s post moves nothing: the pay is by class, and a Face is not paid by heat', async () => {
    const { fake, made, play } = await stage('Chadluminum');
    const before = pendingOf(await fake.estimate());
    await play.react('Snuckles', made.posts['kind']!, 'tomato');
    expect(pendingOf(await fake.estimate())).toBe(before);
  });
});

describe('the nodes', () => {
  afterEach(() => { nodes.clear(); });

  test('there are none until a shot hangs one: the default page draws no node at all', () => {
    const { container } = render(<Nodes />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Commentary node' })).toBeNull();
  });

  test('a node is a named button that starts when pressed and stops when pressed again', async () => {
    render(<Nodes />);
    act(() => { nodes.add(120, 340); });
    const button = screen.getByRole('button', { name: 'Commentary node' });
    expect(button).toHaveStyle({ left: '120px', top: '340px' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('data-started');
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    act(() => { nodes.clear(); });
    expect(screen.queryByRole('button', { name: 'Commentary node' })).toBeNull();
  });
});

describe('the camera', () => {
  test('at rest the wrapper has no style at all; a turn sets perspective and a transform, and level takes every trace off, black behind and all', () => {
    document.body.style.background = 'rgb(10, 20, 30)';
    render(<Camera><p>the board</p></Camera>);
    const outer = document.getElementById('kb-camera')!, plane = document.getElementById('kb-plane')!;
    expect(outer.getAttribute('style')).toBeNull();
    expect(plane.getAttribute('style')).toBeNull();
    act(() => { turnBoard({ ry: 25, rx: 10, z: 40, scale: 0.9 }); });
    expect(outer.style.perspective).not.toBe('');
    expect(plane.style.transform).toBe('rotateX(10deg) rotateY(25deg) rotateZ(0deg) translateZ(40px) scale(0.9)');
    act(() => { turnBoard({ x: -30, y: 12, scale: 1.4 }); });
    expect(plane.style.transform).toBe('translate(-30px, 12px) rotateX(0deg) rotateY(0deg) rotateZ(0deg) translateZ(0px) scale(1.4)');
    expect(document.documentElement.style.background).toContain('rgb(0, 0, 0)');
    expect(plane.style.backgroundColor).toBe('rgb(10, 20, 30)');
    act(() => { levelBoard(); });
    expect(outer.getAttribute('style')).toBeNull();
    expect(plane.getAttribute('style')).toBeNull();
    expect(plane.hasAttribute('data-kb-turned')).toBe(false);
    expect(document.body.style.background).toContain('rgb(10, 20, 30)');
    document.body.style.background = '';
  });
});
