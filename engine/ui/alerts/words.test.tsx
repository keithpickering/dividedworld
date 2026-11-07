/**
 * The words of an Alerts row (words.ts; the alerts plan, Task 9): each kind's line, detail and ways, from the row and the Acts it names, in plain
 * words that name no caster and no reactor.
 */
import { describe, expect, test } from 'vitest';
import type { Act, Alert } from '../data/api.ts';
import { batchWords, plainText, targetKey, wordsFor, type WordsContext } from './words.ts';

const AT = '2026-11-02T09:41:00.000Z';
const act = (id: string, o: Partial<Act> = {}): Act => ({
  id, character: 'cBo', kind: 'post', thread: 't1', targetActId: null, seq: 1, createdAt: AT, payload: {}, currentPayload: {}, editedAt: null, shownEditedAt: null, ...o,
});
const row = (o: Partial<Alert> & Pick<Alert, 'kind'>): Alert => ({ sub: null, act: null, character: null, at: AT, thread: 't1', name: null, title: null, count: null, ...o });

function ctx(acts: readonly Act[] = [], o: Partial<WordsContext> = {}): WordsContext {
  return {
    instance: { cards: [{ key: 'whoops', name: 'Whoops!' }, { key: 'glitter', name: 'Glitter Bomb' }, { key: 'main', name: 'Main Event' }] } as unknown as WordsContext['instance'],
    ui: { copy: { siteName: 'T', siteTagline: 't', roleWord: 'The Boss', staffWord: 'The staff', gameWord: 'the game', staffBoardTag: 'Staff post here; you react and spin', shopName: 'S', reducedMotionCard: 'x' } },
    acts: new Map(acts.map((a) => [a.id, a])),
    reading: null,
    startedBy: new Map(),
    perPage: 20,
    newestSettlement: null,
    ...o,
  };
}
const said = (r: Alert, c: WordsContext) => { const s = wordsFor(r, c); return { line: plainText(s.line), detail: plainText(s.detail), ways: s.ways, who: s.who }; };

describe('a quote', () => {
  const quoting = act('q', { seq: 43 });
  const r = row({ kind: 'quote', act: 'q', character: 'c1', name: 'Pipewrench', title: 'who keeps splatting my posts' });
  test('says the character\'s post was quoted, names its thread, and links the quoting post', () => {
    expect(said(r, ctx([quoting]))).toEqual({
      line: 'Pipewrench\'s post was quoted', detail: 'In who keeps splatting my posts, post #43.',
      ways: [{ text: 'Go to the post', to: '/t/t1?page=3#post-43' }], who: 'Pipewrench',
    });
  });
  test('sets the title in italics, and links the thread when the post could not be read', () => {
    expect(wordsFor(r, ctx([quoting])).detail).toContainEqual({ em: 'who keeps splatting my posts' });
    expect(said(r, ctx()).ways).toEqual([{ text: 'Go to the thread', to: '/t/t1' }]);
  });
});

describe('a framed alert', () => {
  const quoting = act('q', { seq: 43 });
  const r = row({ kind: 'framed', act: 'q', character: 'c1', name: 'Pipewrench', title: 'who keeps splatting my posts' });
  test('says someone put words in the character\'s mouth, plainly, with the thread and the post as a quote\'s', () => {
    expect(said(r, ctx([quoting]))).toEqual({
      line: 'Someone put words in Pipewrench\'s mouth', detail: 'In who keeps splatting my posts, post #43.',
      ways: [{ text: 'Go to the post', to: '/t/t1?page=3#post-43' }], who: 'Pipewrench',
    });
  });
  test('falls back to the thread when the post could not be read', () => {
    expect(said(r, ctx()).ways).toEqual([{ text: 'Go to the thread', to: '/t/t1' }]);
  });
});

describe('a card on yours', () => {
  test('on a post: the card, the post and its number, the post as the way', () => {
    const play = act('p', { kind: 'card', targetActId: 'post4', payload: { card: 'whoops', reach: 'post' } });
    const s = said(row({ kind: 'cardOnYours', act: 'p', character: 'c1', name: 'Pipewrench', title: 'Hobbies' }), ctx([play, act('post4', { seq: 4 })]));
    expect(s).toEqual({ line: 'Whoops! was played on Pipewrench\'s post #4', detail: 'In Hobbies.', ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-4' }], who: 'Pipewrench' });
  });
  test('on a character: its public name from the play, the profile as the way', () => {
    const play = act('p', { kind: 'card', targetActId: 'x', payload: { card: 'glitter', reach: 'character', character: 'c9', targetName: 'Spritey' } });
    const s = said(row({ kind: 'cardOnYours', act: 'p', character: 'c9', name: 'Spritey renamed' }), ctx([play]));
    expect(s.line).toBe('Glitter Bomb was played on Spritey');
    expect(s.detail).toBe('It was played on your character, not on a post.');
    expect(s.ways).toEqual([{ text: 'Go to Spritey', to: '/c/c9' }]);
  });
  test('on a thread: its title as the play named it, in italics, the thread as the way', () => {
    const play = act('p', { kind: 'card', payload: { card: 'main', reach: 'thread', thread: 't7', targetName: 'Thwomp appreciation' } });
    const s = wordsFor(row({ kind: 'cardOnYours', act: 'p', character: 'c1', name: 'Pipewrench' }), ctx([play]));
    expect(s.line).toEqual(['Main Event was played on ', { em: 'Thwomp appreciation' }]);
    expect(plainText(s.detail)).toBe('Your character started this thread.');
    expect(s.ways).toEqual([{ text: 'Go to the thread', to: '/t/t7?page=1' }]);
  });
  test('a card the instance does not list is "A card"; and nothing names who played it', () => {
    const play = act('p', { kind: 'card', character: 'cBo', targetActId: 'post4', payload: { card: 'mystery', reach: 'post' } });
    const s = said(row({ kind: 'cardOnYours', act: 'p', character: 'c1', name: 'Pipewrench' }), ctx([play, act('post4', { seq: 4 })]));
    expect(s.line).toBe('A card was played on Pipewrench\'s post #4');
    expect(JSON.stringify(s)).not.toMatch(/cBo/u);
  });
  test('cards on one target share a key, a different target or reach does not, and a row not told about has none', () => {
    const on = (id: string, target: string, card = 'whoops') => act(id, { kind: 'card', targetActId: target, payload: { card, reach: 'post' } });
    const c = ctx([on('p1', 'post4'), on('p2', 'post4', 'glitter'), on('p3', 'post5'),
      act('ch', { kind: 'card', payload: { card: 'glitter', reach: 'character', character: 'c9' } }), act('post4', { seq: 4 })]);
    const k = (a: string) => targetKey(row({ kind: 'cardOnYours', act: a, character: 'c1' }), c);
    expect(k('p1')).toBe(k('p2'));
    expect(k('p1')).not.toBe(k('p3'));
    expect(k('ch')).not.toBe(k('p1'));
    expect(k('ch')).not.toBeNull();
    expect(k('missing')).toBeNull();
    expect(targetKey(row({ kind: 'quote', act: 'p1' }), c)).toBeNull();
  });
  test('a batch is "<newest card> and N more" on the one target, with its way', () => {
    const on = (id: string, card: string) => act(id, { kind: 'card', targetActId: 'post4', payload: { card, reach: 'post' } });
    const c = ctx([on('p1', 'glitter'), on('p2', 'whoops'), on('p3', 'whoops'), act('post4', { seq: 4 })]);
    const rows = ['p1', 'p2', 'p3'].map((a) => row({ kind: 'cardOnYours', act: a, character: 'c1', name: 'Pipewrench', title: 'Hobbies' }));
    const s = batchWords(rows, c);
    expect(plainText(s.line)).toBe('Glitter Bomb and 2 more were played on Pipewrench\'s post #4');
    expect(plainText(s.detail)).toBe('3 cards in all. In Hobbies.');
    expect(s.ways).toEqual([{ text: 'Go to the post', to: '/t/t1?page=1#post-4' }]);
    expect(s.who).toBe('Pipewrench');
  });
});

describe('a trap', () => {
  test('struck: the post and the card that struck it, no setter', () => {
    const struck = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'glitter', spring: 'sp' } });
    const s = said(row({ kind: 'trapStruck', act: 's', character: 'c1', name: 'Pipewrench', title: 'Hobbies' }), ctx([struck, act('post43', { seq: 43 })]));
    expect(s).toEqual({ line: 'A trap struck Pipewrench\'s post #43', detail: 'It laid Glitter Bomb on it. In Hobbies.', ways: [{ text: 'Go to the post', to: '/t/t1?page=3#post-43' }], who: 'Pipewrench' });
  });
  test('sprang: your trap and the post it sprang on', () => {
    const spring = act('sp', { kind: 'card', targetActId: 'post9', payload: { card: 'whoops', trigger: 'cast' } });
    const s = said(row({ kind: 'trapSprang', act: 'sp', character: 'c1', name: 'Pipewrench', title: 'Hobbies' }), ctx([spring, act('post9', { seq: 9 })]));
    expect(s).toEqual({ line: 'Your trap sprang', detail: 'The trap was Whoops!, in Hobbies.', ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-9' }], who: 'Pipewrench' });
  });
});

describe('a card an admin ended', () => {
  const end = act('e', { character: null, kind: 'card_end', seq: null, targetActId: 'k', payload: { why: 'reversed', by: 'admin' } });
  const play = (payload: Record<string, unknown>, o: Partial<Act> = {}) => act('k', { kind: 'card', seq: null, targetActId: 'post4', payload: { card: 'whoops', ...payload }, ...o });
  const r = row({ kind: 'cardEnded', act: 'e', character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
  const names = new Map([['cG', 'Gizmo']]);
  test('says an admin ended the card, on whose post, with the way to it', () => {
    const s = said(r, ctx([end, play({}), act('post4', { character: 'cG', seq: 4 })], { names }));
    expect(s).toEqual({
      line: 'An admin ended your Whoops! on Gizmo\'s post.', detail: 'Its cost and the card are not refunded. In Hobbies.',
      ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-4' }], who: 'Pipewrench',
    });
  });
  test('a post of the caster\'s own is said as theirs, and one that could not be read as a post', () => {
    expect(said(r, ctx([end, play({}), act('post4', { character: 'c1', seq: 4 })], { names })).line).toBe('An admin ended your Whoops! on your post.');
    expect(said(r, ctx([end, play({})])).line).toBe('An admin ended your Whoops! on a post.');
  });
  test('a play beyond a post names its target', () => {
    expect(said(r, ctx([end, play({ reach: 'character', character: 'cG', targetName: 'Gizmo' })])).line).toBe('An admin ended your Whoops! on Gizmo.');
    expect(said(r, ctx([end, play({ reach: 'thread', thread: 't9', targetName: 'Hobbies' })])).line).toBe('An admin ended your Whoops! on the thread Hobbies.');
    expect(said(r, ctx([end, play({ reach: 'board', board: 'b1', targetName: 'Lobby' })])).line).toBe('An admin ended your Whoops! on the Lobby board.');
  });
  test('says it plainly when the play could not be read', () => {
    expect(said(r, ctx([end])).line).toBe('An admin ended your card.');
    expect(said(r, ctx()).line).toBe('An admin ended your card.');
  });
});

describe('a hint and a ruling', () => {
  const r = row({ kind: 'hint', sub: 'leading:excitedNegative', act: 'post4', character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
  const c = ctx([act('post4', { seq: 4 })]);
  test('a hint is said plainly when the instance has no words for it', () => {
    expect(said(r, c)).toEqual({
      line: 'A pattern in the reactions to Pipewrench\'s post', detail: 'Counted from the reaction counts anyone can see on the post. In Hobbies.',
      ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-4' }], who: 'Pipewrench',
    });
  });
  test('a hint is said in the instance\'s words where it has them, by its pattern', () => {
    const own: WordsContext = { ...c, ui: { copy: { ...c.ui.copy, alerts: { hint: (p) => (p === 'leading:excitedNegative' ? { line: 'Your post is picking up heat', detail: 'The crowd is into it.' } : undefined) } } } };
    expect(said(r, own)).toMatchObject({ line: 'Your post is picking up heat', detail: 'The crowd is into it.' });
    expect(said({ ...r, sub: 'thunder' }, own).line).toBe('A pattern in the reactions to Pipewrench\'s post');
  });
  test('the instance is told whether the hint is about a card play, so a card is not called a post', () => {
    const seen: [string, boolean][] = [];
    const spy: WordsContext = { ...ctx([act('post4', { seq: 4 }), act('play', { kind: 'card', targetActId: 'post4', payload: { card: 'whoops', reach: 'post' } })]), ui: { copy: { siteName: 'T', siteTagline: 't', roleWord: 'The Boss', staffWord: 'The staff', gameWord: 'the game', staffBoardTag: 'Staff post here; you react and spin', shopName: 'S', reducedMotionCard: 'x', alerts: { hint: (p, about) => { seen.push([p, about.card]); return undefined; } } } } };
    wordsFor(r, spy);
    wordsFor({ ...r, act: 'play', sub: 'thunder' }, spy);
    expect(seen).toEqual([['leading:excitedNegative', false], ['thunder', true]]);
  });
  test('a ruling is said generically, so a later build need only add its sub', () => {
    expect(said(row({ kind: 'ruling', sub: 'whatever', act: 'post4', character: 'c1', name: 'Pipewrench', title: 'Hobbies' }), c)).toEqual({
      line: 'A ruling landed on Pipewrench', detail: 'The ruling is public, on the board. In Hobbies.',
      ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-4' }], who: 'Pipewrench',
    });
  });
});

describe('a settlement', () => {
  const r = (sub: string, count: number | null) => row({ kind: 'settlement', sub, count, thread: null });
  test('the newest opens its summary', () => {
    expect(said(r('5', 2), ctx([], { newestSettlement: '5' }))).toEqual({ line: 'A settlement is in', detail: 'It moved 2 of your characters.', ways: [{ text: 'Open the summary', to: '/log/settlement' }], who: 'All yours' });
  });
  test('an older one opens in My log on its row, since the summary shows the newest', () => {
    expect(said(r('4', 1), ctx([], { newestSettlement: '5' })).ways).toEqual([{ text: 'Open it in My log', to: '/log', state: { open: 4 } }]);
    expect(said(r('4', 1), ctx([], { newestSettlement: '5' })).detail).toBe('It moved 1 of your characters.');
  });
});

describe('a followed thread', () => {
  const r = (count: number | null) => row({ kind: 'followed', thread: 't1', title: 'best ink color', count });
  test('counts the new posts, and links the first unread post', () => {
    const s = wordsFor(r(4), ctx([], { reading: { t1: 51 } }));
    expect(s.line).toEqual(['4 new posts in ', { em: 'best ink color' }]);
    expect(plainText(s.detail)).toBe('Since you last read it.');
    expect(s.ways).toEqual([{ text: 'First unread post', to: '/t/t1?page=3#post-52' }]);
    expect(s.who).toBe('Followed');
  });
  test('a thread one of the player\'s characters started is tagged with that character and says why it is followed', () => {
    const s = wordsFor(r(4), ctx([], { reading: { t1: 51 }, startedBy: new Map([['t1', 'Spritey']]) }));
    expect(s.who).toBe('Spritey');
    expect(plainText(s.detail)).toBe('Since you last read it. You follow it because Spritey started it.');
  });
  test('one is "1 new post", and a count at the cap is "100+"', () => {
    expect(plainText(wordsFor(r(1), ctx()).line)).toBe('1 new post in best ink color');
    expect(plainText(wordsFor(r(100), ctx()).line)).toBe('100+ new posts in best ink color');
  });
  test('a thread never read starts at its first post, and one whose place could not be read goes to the thread', () => {
    expect(wordsFor(r(3), ctx([], { reading: {} })).ways).toEqual([{ text: 'First unread post', to: '/t/t1?page=1#post-1' }]);
    expect(wordsFor(r(3), ctx([], { reading: null })).ways).toEqual([{ text: 'Go to the thread', to: '/t/t1' }]);
  });
});

describe('every player\'s news', () => {
  test('an update names its persona and title and opens in Updates', () => {
    expect(said(row({ kind: 'update', act: 'u1', name: 'Gabe', title: 'Traps now bite board cards' }), ctx())).toEqual({
      line: 'New update from Gabe: “Traps now bite board cards”', detail: '', ways: [{ text: 'Read it in Updates', to: '/updates?update=u1' }], who: 'Everyone',
    });
    expect(said(row({ kind: 'update', act: 'u2', title: 'Hello' }), ctx()).line).toBe('New update: “Hello”');
  });
  test('season news links the News tab: results, a tally, the Boss arriving and leaving', () => {
    const news = (sub: string, o: Partial<Alert> = {}) => said(row({ kind: 'seasonNews', sub, ...o }), ctx());
    const way = [{ text: 'Read it on the Season page', to: '/season?tab=news' }];
    expect(news('results', { count: 12 })).toEqual({ line: 'The season\'s results are in', detail: '12 characters ranked.', ways: way, who: 'Everyone' });
    expect(news('tally', { count: 3 })).toMatchObject({ line: 'New debuts and Turns are in', detail: '3 characters are named.', ways: way });
    expect(news('bossArrived', { name: 'Gloomba Prime' })).toMatchObject({ line: 'A new Boss has arrived: Gloomba Prime', ways: way });
    expect(news('bossLeft', { name: 'Gloomba Prime' })).toMatchObject({ line: 'The Boss, Gloomba Prime, has left', ways: way });
    expect(news('bossArrived').line).toBe('A new Boss has arrived');
    expect(news('somethingNew').line).toBe('There is news for the season');
  });
  test('the instance\'s words for season news are used where it gives them, by sub and row, with the engine\'s way', () => {
    const base = ctx();
    const own: WordsContext = { ...base, ui: { copy: { ...base.ui.copy, alerts: { seasonNews: (sub, r) => (sub === 'bossArrived' ? { line: `${r.name} takes the chair`, detail: 'Mind the stapler.' } : undefined) } } } };
    const arrived = said(row({ kind: 'seasonNews', sub: 'bossArrived', name: 'Gloomba Prime' }), own);
    expect(arrived).toMatchObject({ line: 'Gloomba Prime takes the chair', detail: 'Mind the stapler.', ways: [{ text: 'Read it on the Season page', to: '/season?tab=news' }], who: 'Everyone' });
    expect(said(row({ kind: 'seasonNews', sub: 'results', count: 12 }), own).line).toBe('The season\'s results are in');
  });
});
