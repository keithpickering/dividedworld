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
    instance: { cards: [{ key: 'whoops', name: 'Whoops!' }, { key: 'trap', name: 'Card Collector' }, { key: 'pass', name: 'Hall Pass' }, { key: 'glitter', name: 'Glitter Bomb' }, { key: 'main', name: 'Main Event' }] } as unknown as WordsContext['instance'],
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
  const DAY = 86_400_000;
  const set = (o: Partial<Act> = {}) => act('set1', { kind: 'set', character: 'cPipe', targetActId: 'post9', seq: null, createdAt: '2026-10-31T09:41:00.000Z', ...o });
  const spring = (o: Partial<Act> = {}) => act('sp', { kind: 'spring', character: 'cPipe', targetActId: 'post9', seq: null, createdAt: '2026-11-02T09:41:00.000Z', payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'set1', by: 'post43' }, ...o });
  const names = new Map([['cPipe', 'Pipewrench']]);

  test('struck by a quote: the setter\'s character, the face-down card, how long before, and that the quote set it off', () => {
    const laid = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'whoops', spring: 'sp', reach: 'post' } });
    const s = said(row({ kind: 'trapStruck', act: 's', character: 'c1', name: 'Spritey', title: 'Hobbies' }), ctx([laid, spring(), set(), act('post43', { seq: 43 }), act('post9', { seq: 9 })], { names }));
    expect(s).toEqual({
      line: 'Pipewrench\'s face-down Whoops! struck Spritey\'s post #43',
      detail: 'Pipewrench set it face down two days before your quote set it off. It laid Whoops! on it. In Hobbies.',
      ways: [{ text: 'Go to the post', to: '/t/t1?page=3#post-43' }], who: 'Spritey',
    });
  });
  describe('passed: a pierce got the cast past a card set face down', () => {
    const cast = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'whoops', reach: 'post', pierce: { by: 'pc', card: 'pass' } } });
    const r = row({ kind: 'trapStruck', sub: 'passed', act: 's', character: 'c1', name: 'Spritey', title: 'Hobbies' });
    test('the engine\'s words name the pierce and the cast, say nothing of the back, and link the cast\'s post', () => {
      expect(said(r, ctx([cast, act('post43', { seq: 43 })]))).toEqual({
        line: 'Your Hall Pass got your Whoops! past a card set face down',
        detail: 'It stays face down and didn\'t spring, and whoever set it isn\'t told. In Hobbies.',
        ways: [{ text: 'Go to the post', to: '/t/t1?page=3#post-43' }], who: 'Spritey',
      });
    });
    test('the instance\'s voice is asked first with how: passed, and no setter, span or back card', () => {
      const seen: unknown[] = [];
      const ui = { copy: { ...ctx().ui.copy, alerts: { trapStruck: (f: unknown) => { seen.push(f); return { line: 'L', detail: 'D' }; } } } } as unknown as WordsContext['ui'];
      expect(said(r, ctx([cast, act('post43', { seq: 43 })], { ui }))).toMatchObject({ line: 'L', detail: 'D' });
      expect(seen).toEqual([{ how: 'passed', setter: null, card: 'Hall Pass', laid: 'Whoops!', span: null, setterStaff: false }]);
    });
  });
  test('struck by a quote that met conditions: the matched ones, shortened, and never an Anyone-but list', () => {
    const laid = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'whoops', spring: 'sp' } });
    const passage = 'the punchline that goes on and on and on past forty characters of a long joke';
    const sp = spring({ payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'set1', by: 'post43', when: { passage, says: 'nice try' }, for: 'c1' } });
    const s = said(row({ kind: 'trapStruck', act: 's', character: 'c1', name: 'Spritey', title: 'Hobbies' }), ctx([laid, sp, set(), act('post43', { seq: 43 }), act('post9', { seq: 9 })], { names }));
    expect(s.detail).toBe('Pipewrench set it face down two days before your quote of “the punchline that goes on and on and on…” saying “nice try” set it off. It laid Whoops! on it. In Hobbies.');
    expect(s.detail).not.toContain('past forty');
  });
  test('the instance voice is handed the shortened conditions', () => {
    const laid = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'whoops', spring: 'sp' } });
    const seen: unknown[] = [];
    const ui = { copy: { ...ctx().ui.copy, alerts: { trapStruck: (f: unknown) => { seen.push(f); return { line: 'L', detail: 'D' }; } } } } as unknown as WordsContext['ui'];
    const sp = spring({ payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'set1', by: 'post43', when: { says: 'nice try' } } });
    said(row({ kind: 'trapStruck', act: 's', character: 'c1', name: 'Spritey' }), ctx([laid, sp, set(), act('post43', { seq: 43 })], { names, ui }));
    expect(seen[0]).toMatchObject({ how: 'quote', says: '“nice try”', passage: null });
  });
  test('sprang (yours) names the matched conditions', () => {
    const r = row({ kind: 'trapSprang', act: 'sp', character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
    const sp = spring({ payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'set1', by: 'post43', when: { passage: 'the punchline' } } });
    expect(said(r, ctx([sp, act('post9', { seq: 9 })])).detail).toBe('A quote of “the punchline” set it off, and it landed. In Hobbies.');
  });
  test('struck by a quote, without what could not be read: the card and the span fall away, never a bluff', () => {
    const laid = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'glitter', spring: 'sp' } });
    const s = said(row({ kind: 'trapStruck', act: 's', character: 'c1', name: 'Spritey' }), ctx([laid, act('post43', { seq: 43 })]));
    expect(s.line).toBe('A face-down card struck Spritey\'s post #43');
    expect(s.detail).toBe('Your quote set it off. It laid Glitter Bomb on it.');
  });
  test('struck by a quote with no setter readable: the passage and the phrase it said, in the struck player\'s own words', () => {
    const laid = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'whoops', spring: 'sp' } });
    const sp = spring({ character: null, payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'gone', by: 'post43', when: { passage: 'p', says: 's' } } });
    const s = said(row({ kind: 'trapStruck', act: 's', character: 'c1', name: 'Spritey' }), ctx([laid, sp, act('post43', { seq: 43 })]));
    expect(s.line).toBe('A face-down Whoops! struck Spritey\'s post #43');
    expect(s.detail).toBe('Your quote of \u201cp\u201d saying \u201cs\u201d set it off. It laid Whoops! on it.');
  });
  test('a spring\'s `for` id is printed in no alert or toast words', () => {
    const FOR = 'cFOR-ID-7';
    const laid = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'whoops', spring: 'sp' } });
    const sp = spring({ payload: { card: 'whoops', trigger: 'quote', did: 'landed', set: 'set1', by: 'post43', for: FOR, when: { passage: 'p', says: 's' } } });
    const c = ctx([laid, sp, set(), act('post43', { seq: 43 }), act('post9', { seq: 9 })], { names });
    for (const r of [row({ kind: 'trapStruck', act: 's', character: 'c1', name: 'Spritey', title: 'Hobbies' }), row({ kind: 'trapSprang', act: 'sp', character: 'c1', name: 'Pipewrench', title: 'Hobbies' })]) {
      expect(JSON.stringify(wordsFor(r, c))).not.toContain(FOR);
      expect(JSON.stringify(batchWords([r], c))).not.toContain(FOR);
    }
  });
  test('a caught caster: a trap named their exact card, and it is now the setter\'s; the setter\'s character, never an account', () => {
    const caught = act('k', { kind: 'card', character: 'c1', targetActId: 'post9', seq: null, payload: { card: 'whoops', caught: 'set1' } });
    const s = said(row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' }), ctx([caught, set(), act('post9', { seq: 9, character: 'cPipe' })], { names }));
    expect(s).toEqual({
      line: 'Pipewrench\'s face-down trap caught your Whoops!',
      detail: 'Pipewrench set it face down two days before you cast it, and it was waiting for Whoops!. Your Whoops! is now Pipewrench\'s. In Hobbies.',
      ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-9' }], who: 'Spritey',
    });
    expect(JSON.stringify(s)).not.toMatch(/account|owner|player/iu);
  });
  test('a staff setter takes nothing: the caught card is spent, never "now theirs"', () => {
    const caught = act('k', { kind: 'card', character: 'c1', targetActId: 'post9', seq: null, payload: { card: 'whoops', caught: 'set1' } });
    const c = ctx([caught, set(), act('post9', { seq: 9, character: 'cPipe' })], { names, staff: new Set(['cPipe']) });
    const s = said(row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' }), c);
    expect(s.detail).toBe('Pipewrench set it face down two days before you cast it, and it was waiting for Whoops!. Your Whoops! is spent. In Hobbies.');
    expect(s.detail).not.toMatch(/now Pipewrench/u);
  });
  test('the instance may give either a voice; it is handed the facts and nothing private', () => {
    const laid = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'whoops', spring: 'sp' } });
    const caught = act('k', { kind: 'card', character: 'c1', targetActId: 'post9', seq: null, payload: { card: 'whoops', caught: 'set1' } });
    const seen: unknown[] = [];
    const ui = { copy: { ...ctx().ui.copy, alerts: { trapStruck: (f: unknown) => { seen.push(f); return { line: 'L', detail: 'D' }; } } } } as unknown as WordsContext['ui'];
    const c = ctx([laid, caught, spring(), set(), act('post43', { seq: 43 })], { names, ui });
    expect(said(row({ kind: 'trapStruck', act: 's', character: 'c1', name: 'Spritey' }), c)).toMatchObject({ line: 'L', detail: 'D' });
    expect(said(row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey' }), c)).toMatchObject({ line: 'L', detail: 'D' });
    expect(seen).toEqual([
      { how: 'quote', setter: 'Pipewrench', card: 'Whoops!', laid: 'Whoops!', span: 'two days', setterStaff: false, passage: null, says: null },
      { how: 'caught', setter: 'Pipewrench', card: 'Whoops!', laid: null, span: 'two days', setterStaff: false },
    ]);
  });
  test('how long is said in words: minutes, hours, days', () => {
    const laid = act('s', { kind: 'card', targetActId: 'post43', payload: { card: 'whoops', spring: 'sp' } });
    const at = (ms: number) => said(row({ kind: 'trapStruck', act: 's', character: 'c1', name: 'Spritey' }),
      ctx([laid, spring({ createdAt: new Date(Date.parse(set().createdAt) + ms).toISOString() }), set(), act('post43', { seq: 43 })], { names })).detail;
    expect(at(30_000)).toContain('less than a minute before');
    expect(at(90 * 60_000)).toContain('an hour before');
    expect(at(5 * 3_600_000)).toContain('five hours before');
    expect(at(DAY)).toContain('a day before');
    expect(at(12 * DAY)).toContain('12 days before');
  });
  test('sprang (yours): a face-down card landed, caught or ended a visit', () => {
    const r = row({ kind: 'trapSprang', act: 'sp', character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
    const post = act('post9', { seq: 9 });
    expect(said(r, ctx([spring(), post]))).toEqual({ line: 'Your face-down Whoops! sprang', detail: 'A quote set it off, and it landed. In Hobbies.', ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-9' }], who: 'Pipewrench' });
    expect(said(r, ctx([spring({ payload: { card: 'trap', trigger: 'cast', did: 'caught', set: 'set1', by: 'k', caught: 'k' } }), post])).detail).toBe('A cast it was waiting for set it off, and the card is now in your hand. In Hobbies.');
    expect(said(r, ctx([spring({ payload: { card: 'pass', trigger: 'visit', did: 'ended', set: 'set1' } }), post])).detail).toBe('A Mod Bot\'s visit set it off, and it ended the visit. In Hobbies.');
  });
  /* A ride back (card notes, Part 6): the cast landed as usual, so the caster is told, and the setter is told its pay. */
  describe('a ride back', () => {
    const chess = { key: 'chess', name: '4D Chess' };
    const rides = () => ctx([], {}).instance;
    const withChess = (acts: readonly Act[], o: Partial<WordsContext> = {}) => ctx(acts, { instance: { cards: [...(rides() as unknown as { cards: object[] }).cards, chess] } as unknown as WordsContext['instance'], names, ...o });
    const cast = act('k', { kind: 'card', character: 'c1', targetActId: 'post9', seq: null, payload: { card: 'whoops', rode: 'set1', layer: 1 } });
    const rode = spring({ payload: { card: 'chess', trigger: 'cast', did: 'rode', quadrant: 'excitedPositive', set: 'set1', by: 'k' } });
    test('the caster is told the cast landed as usual and keeps what it earns, naming the setter and, where the spring is read, the card', () => {
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' });
      expect(said(r, withChess([cast, rode, set(), act('post9', { seq: 9, character: 'cPipe' })]))).toEqual({
        line: 'Pipewrench\'s face-down 4D Chess was waiting for your Whoops!',
        detail: 'Your Whoops! landed as usual, and you keep everything it earns. In Hobbies.',
        ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-9' }], who: 'Spritey',
      });
      /* The spring is not always at hand: the words never guess the card. */
      expect(said(r, withChess([cast, set(), act('post9', { seq: 9, character: 'cPipe' })])).line).toBe('Pipewrench\'s face-down card was waiting for your Whoops!');
      expect(JSON.stringify(wordsFor(r, withChess([cast, rode, set()])))).not.toMatch(/account|owner|quadrant|excitedPositive/iu);
    });
    test('the instance voice is handed how: rode, the setter, the card where known, and the Move that landed', () => {
      const seen: unknown[] = [];
      const ui = { copy: { ...ctx().ui.copy, alerts: { trapStruck: (f: unknown) => { seen.push(f); return { line: 'L', detail: 'D' }; } } } } as unknown as WordsContext['ui'];
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey' });
      said(r, withChess([cast, rode, set(), act('post9', { seq: 9 })], { ui }));
      said(r, withChess([cast, set(), act('post9', { seq: 9 })], { ui }));
      expect(seen).toEqual([
        { how: 'rode', setter: 'Pipewrench', card: '4D Chess', laid: 'Whoops!', span: 'two days', setterStaff: false },
        { how: 'rode', setter: 'Pipewrench', card: null, laid: 'Whoops!', span: 'two days', setterStaff: false },
      ]);
    });
    test('sprang (yours) with no quadrant on the spring says every reaction pays', () => {
      const r = row({ kind: 'trapSprang', act: 'sp', character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
      const bare = spring({ payload: { card: 'chess', trigger: 'cast', did: 'rode', set: 'set1', by: 'k' } });
      expect(said(r, withChess([bare, act('post9', { seq: 9 })])).detail).toBe('A card it was waiting for was cast there and set it off. The cast landed, and every reaction to it pays you at each settlement. In Hobbies.');
    });
    test('sprang (yours) says the cast landed and its reactions of the kind named pay at each settlement', () => {
      const r = row({ kind: 'trapSprang', act: 'sp', character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
      expect(said(r, withChess([rode, act('post9', { seq: 9 })]))).toEqual({
        line: 'Your face-down 4D Chess sprang',
        detail: 'A cast of the card it named set it off. The cast landed, and its reactions of the kind you named pay you at each settlement. In Hobbies.',
        ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-9' }], who: 'Pipewrench',
      });
    });
  });
  /* A refund back or sign (the refund outcome): the cast landed and its card went back to its caster; the words branch on the data, never a card's key. */
  describe('a refund', () => {
    const cast = act('k', { kind: 'card', character: 'c1', targetActId: 'post9', seq: null, payload: { card: 'whoops', handedBack: { by: 'set1', card: 'gift' }, layer: 1 } });
    const gift = { key: 'gift', name: 'Gift', play: 'set' };
    const kick = { key: 'kick', name: 'Kick', play: 'use' };
    const withRefunds = (acts: readonly Act[], o: Partial<WordsContext> = {}) => ctx(acts, { instance: { cards: [...(ctx([], {}).instance as unknown as { cards: object[] }).cards, gift, kick] } as unknown as WordsContext['instance'], ...o });
    test('sprang (yours): the cast landed and its card went back to its caster', () => {
      const r = row({ kind: 'trapSprang', act: 'sp', character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
      const returned = spring({ payload: { card: 'whoops', trigger: 'cast', did: 'returned', set: 'set1', by: 'k' } });
      expect(said(r, ctx([returned, act('post9', { seq: 9 })])).detail).toBe('A card it was waiting for was cast there and set it off. The cast landed, and its card went back to its caster. In Hobbies.');
    });
    test('a cast a sign alone handed back is never told as a face-down card springing', () => {
      const signed = act('k', { kind: 'card', character: 'c1', targetActId: 'post9', seq: null, payload: { card: 'whoops', handedBack: { by: 'sign1', card: 'kick' }, layer: 1 } });
      const sign = act('sign1', { kind: 'card', character: 'cPipe', targetActId: 'post9', seq: null, payload: { card: 'kick' } });
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' });
      const s = said(r, withRefunds([signed, sign, act('post9', { seq: 9, character: 'cPipe' })], { names }));
      expect(s.detail).not.toContain('your card is back in your hand');
      const seen: { how?: unknown }[] = [];
      const ui = { copy: { ...ctx().ui.copy, alerts: { trapStruck: (f: { how?: unknown }) => { seen.push(f); return { line: 'L', detail: 'D' }; } } } } as unknown as WordsContext['ui'];
      said(r, withRefunds([signed, sign, act('post9', { seq: 9, character: 'cPipe' })], { names, ui }));
      expect(seen.map((f) => f.how)).not.toContain('returned');
    });
    test('a cast a ride back let land and a sign then refunded is told the ride back\'s words, naming the ride back\'s setter', () => {
      const both = act('k', { kind: 'card', character: 'c1', targetActId: 'post9', seq: null, payload: { card: 'whoops', rode: 'set1', handedBack: { by: 'sign1', card: 'kick' }, layer: 1 } });
      const sign = act('sign1', { kind: 'card', character: 'cOther', targetActId: 'post9', seq: null, payload: { card: 'kick' } });
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' });
      const s = said(r, ctx([both, sign, set(), act('post9', { seq: 9, character: 'cPipe' })], { names }));
      expect(s.line).toBe('Pipewrench\'s face-down card was waiting for your Whoops!');
      expect(s.detail).toContain('landed as usual');
    });
    test('the caster is told its card is back, in the engine\'s words, and the instance voice is handed how: returned', () => {
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' });
      const acts = [cast, set(), act('post9', { seq: 9, character: 'cPipe' })];
      const s = said(r, withRefunds(acts, { names }));
      expect(s.line).toBe('Pipewrench\'s face-down card was waiting for your Whoops!');
      expect(s.detail).toBe('A card set face down on that post sprang on your cast. It landed, and your card is back in your hand. In Hobbies.');
      const seen: unknown[] = [];
      const ui = { copy: { ...ctx().ui.copy, alerts: { trapStruck: (f: unknown) => { seen.push(f); return { line: 'L', detail: 'D' }; } } } } as unknown as WordsContext['ui'];
      said(r, withRefunds(acts, { names, ui }));
      expect(seen).toEqual([{ how: 'returned', setter: 'Pipewrench', card: null, laid: 'Whoops!', span: 'two days', setterStaff: false }]);
    });
  });
  /* A lockout back: the Move landed and its character is locked out of the thread; the words branch on the spring's `did`, never a card's key. */
  describe('a lockout', () => {
    const until = '2026-11-03T09:41:00.000Z';
    const locked = (o: Partial<Act> = {}) => spring({ payload: { card: 'trap', trigger: 'cast', did: 'lockedOut', set: 'set1', by: 'k', locks: 'c1', until }, ...o });
    const play = act('k', { kind: 'card', character: 'c1', targetActId: 'post9', seq: null, payload: { card: 'whoops', layer: 1, lockedOut: 'sp' } });
    const lockNames = new Map([['cPipe', 'Pipewrench'], ['c1', 'Spritey']]);
    const post = act('post9', { seq: 9, character: 'cPipe' });
    test('sprang (yours): the Move landed and the caster is locked out until a time, as the alerts write times', () => {
      const r = row({ kind: 'trapSprang', act: 'sp', character: 'cPipe', name: 'Pipewrench', title: 'Hobbies' });
      const s = said(r, ctx([locked(), play, post], { names: lockNames }));
      expect(s.line).toBe('Your face-down Card Collector sprang');
      expect(s.detail).toBe('Card Collector on your post #9 sprang when Spritey played Whoops! on it. Whoops! landed, and Spritey is locked out of the thread until Nov 3 · 09:41 UTC. In Hobbies.');
    });
    test('sprang (yours): an admin who ended it early is named plainly, with the time', () => {
      const r = row({ kind: 'trapSprang', act: 'sp', character: 'cPipe', name: 'Pipewrench', title: 'Hobbies' });
      const end = act('end', { kind: 'card_end', character: null, targetActId: 'sp', createdAt: '2026-11-02T12:05:00.000Z' });
      expect(said(r, ctx([locked(), play, post, end], { names: lockNames })).detail)
        .toContain('Spritey was locked out of the thread until Nov 3 · 09:41 UTC. An admin ended it at Nov 2 · 12:05 UTC. In Hobbies.');
    });
    test('struck (the caster): the default words, and the instance voice is handed how: lockedOut with the time', () => {
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' });
      const acts = [play, locked(), set(), post];
      const s = said(r, ctx(acts, { names: lockNames }));
      expect(s.detail).toBe('The Card Collector on Pipewrench\'s post #9 locked Spritey out of this thread until Nov 3 · 09:41 UTC. In Hobbies.');
      const seen: unknown[] = [];
      const ui = { copy: { ...ctx().ui.copy, alerts: { trapStruck: (f: unknown) => { seen.push(f); return { line: 'L', detail: 'D' }; } } } } as unknown as WordsContext['ui'];
      said(r, ctx(acts, { names: lockNames, ui }));
      expect(seen).toEqual([{ how: 'lockedOut', setter: 'Pipewrench', card: 'Card Collector', laid: 'Whoops!', span: null, setterStaff: false, until: 'Nov 3 · 09:41 UTC' }]);
    });
    test('struck (the caster): an instance voice keeps the engine\'s true sentence that an admin ended it', () => {
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' });
      const end = act('end', { kind: 'card_end', character: null, targetActId: 'sp', createdAt: '2026-11-02T12:05:00.000Z' });
      const ui = { copy: { ...ctx().ui.copy, alerts: { trapStruck: () => ({ line: 'L', detail: 'Ha, locked.' }) } } } as unknown as WordsContext['ui'];
      expect(said(r, ctx([play, locked(), set(), post, end], { names: lockNames, ui })).detail).toBe('Ha, locked. An admin ended it at Nov 2 · 12:05 UTC.');
    });
    test('struck (the caster): an instance voice is handed ended, the time an admin ended the lockout, and not otherwise', () => {
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' });
      const end = act('end', { kind: 'card_end', character: null, targetActId: 'sp', createdAt: '2026-11-02T12:05:00.000Z' });
      const seen: unknown[] = [];
      const ui = { copy: { ...ctx().ui.copy, alerts: { trapStruck: (f: unknown) => { seen.push(f); return { line: 'L', detail: 'D' }; } } } } as unknown as WordsContext['ui'];
      said(r, ctx([play, locked(), set(), post, end], { names: lockNames, ui }));
      expect(seen).toEqual([expect.objectContaining({ how: 'lockedOut', ended: 'Nov 2 · 12:05 UTC', until: 'Nov 3 · 09:41 UTC' })]);
      seen.length = 0;
      said(r, ctx([play, locked(), set(), post], { names: lockNames, ui }));
      expect(seen).toHaveLength(1);
      expect(seen[0]).not.toHaveProperty('ended');
    });
    test('struck (the caster): an admin ending it is named plainly', () => {
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' });
      const end = act('end', { kind: 'card_end', character: null, targetActId: 'sp', createdAt: '2026-11-02T12:05:00.000Z' });
      expect(said(r, ctx([play, locked(), set(), post, end], { names: lockNames })).detail).toContain('until Nov 3 · 09:41 UTC. An admin ended it at Nov 2 · 12:05 UTC.');
    });
    test('struck (the caster): the spring is found through the play\'s `lockedOut`, whatever the spring\'s own `by` says', () => {
      const r = row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' });
      const s = said(r, ctx([play, locked({ payload: { card: 'trap', trigger: 'cast', did: 'lockedOut', set: 'set1', by: 'elsewhere', locks: 'c1', until } }), set(), post], { names: lockNames }));
      expect(s.detail).toBe('The Card Collector on Pipewrench\'s post #9 locked Spritey out of this thread until Nov 3 · 09:41 UTC. In Hobbies.');
    });
    test('none of the new words says "cast"', () => {
      const all = [
        said(row({ kind: 'trapSprang', act: 'sp', character: 'cPipe', name: 'Pipewrench', title: 'Hobbies' }), ctx([locked(), play, post], { names: lockNames })),
        said(row({ kind: 'trapStruck', act: 'k', character: 'c1', name: 'Spritey', title: 'Hobbies' }), ctx([play, locked(), set(), post], { names: lockNames })),
      ];
      for (const s of all) expect(`${s.line} ${s.detail}`).not.toMatch(/cast/i);
    });
  });
  test('sprang, as it was written before: the old words', () => {
    const old = act('sp', { kind: 'card', targetActId: 'post9', payload: { card: 'whoops', trigger: 'cast' } });
    const s = said(row({ kind: 'trapSprang', act: 'sp', character: 'c1', name: 'Pipewrench', title: 'Hobbies' }), ctx([old, act('post9', { seq: 9 })]));
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
  test('an end of a lockout (the target is a lockedOut spring) says the lockout was ended, never that a card or its cost was lost, and never says "cast"', () => {
    const lockEnd = act('e', { character: null, kind: 'card_end', seq: null, targetActId: 'sp', payload: { why: 'reversed', by: 'admin' } });
    const sp = act('sp', { kind: 'spring', character: 'c1', seq: null, targetActId: 'post4', payload: { card: 'trap', trigger: 'cast', did: 'lockedOut', set: 'set1', by: 'k', locks: 'cL', until: '2026-11-03T09:41:00.000Z' } });
    const s = said(r, ctx([lockEnd, sp, act('post4', { character: 'cG', seq: 4 })], { names: new Map([['cG', 'Gizmo'], ['cL', 'Spritey']]) }));
    expect(s.line).toBe('An admin ended the lockout your Card Collector on Gizmo\'s post #4 put on Spritey.');
    expect(s.detail).toBe('In Hobbies.');
    expect(`${s.line} ${s.detail}`).not.toMatch(/cast|refund|cost/i);
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

describe('a trophy alert and a belt lost alert (the cosmetics plan, Task 12)', () => {
  const trophy = row({ kind: 'trophy', sub: 'Boss\'s Pet', character: 'c1', name: 'Pipewrench', thread: null });
  const lost = row({ kind: 'beltLost', sub: 'The Belt', character: 'c1', name: 'Pipewrench', thread: null });
  test('a trophy says which mask was given what, and sends the player to the log, which says by whom', () => {
    expect(said(trophy, ctx())).toEqual({
      line: 'Pipewrench was given Boss\'s Pet', detail: 'The log says who gave it.', ways: [{ text: 'Open My log', to: '/log' }], who: 'Pipewrench',
    });
  });
  test('a belt that came back says the mask holds it again', () => {
    expect(said(row({ kind: 'beltBack', sub: 'The Belt', character: 'c1', name: 'Pipewrench', thread: null }), ctx())).toEqual({
      line: 'Pipewrench holds the Belt again', detail: 'The log says what changed.', ways: [{ text: 'Open My log', to: '/log' }], who: 'Pipewrench',
    });
  });
  test('a belt lost says the mask no longer holds it, and never names who took it', () => {
    expect(said(lost, ctx())).toEqual({
      line: 'Pipewrench lost the Belt', detail: 'The log says who took it.', ways: [{ text: 'Open My log', to: '/log' }], who: 'Pipewrench',
    });
  });
  test('a trophy named with a leading "The" reads as a sentence: "the Hardcore Belt"', () => {
    expect(said({ ...trophy, sub: 'The Hardcore Belt' }, ctx()).line).toBe('Pipewrench was given the Hardcore Belt');
  });
  test('read without a name or a trophy they stay plain', () => {
    expect(said({ ...trophy, name: null, sub: null }, ctx()).line).toBe('One of your characters was given a trophy');
    expect(said({ ...lost, name: null, sub: null }, ctx()).line).toBe('One of your characters lost a belt');
    expect(said({ ...lost, kind: 'beltBack', name: null, sub: null }, ctx()).line).toBe('One of your characters holds a belt again');
  });
});

describe('a ruling, one line per sub (the rulings design, section 7)', () => {
  const r = (sub: string | null, o: Partial<Alert> = {}) => row({ kind: 'ruling', sub, character: 'c1', name: 'Pipewrench', title: 'Hobbies', ...o });
  const post = act('post4', { seq: 4, character: 'c1' });
  /* What alerts_page gives (0423, section 9): the people are characters by id (the taker), and the Mods by their staff key; the infraction's Mod is a key, never a character's id. */
  const names = new Map([['cTaker', 'Gloomba']]);
  const staffNames = new Map([['ra-m1', 'Thwomp']]);
  const c = (extra: readonly Act[] = [], o: Partial<WordsContext> = {}) => ctx([post, ...extra], { names, staffNames, ...o });
  const postWayOf = [{ text: 'Go to the post', to: '/t/t1?page=1#post-4' }];
  const logWay = [{ text: 'Open My log', to: '/log' }];

  test('warning: the points, the rule and the Mod from the infraction, when they drop off, the post as the way', () => {
    const inf = act('inf', { kind: 'infraction', character: null, seq: null, payload: { about_act: 'post4', character: 'c1', points: 3, rule_number: 2, staff: 'ra-m1', expires_at: '2026-11-09T09:00:00.000Z' } });
    expect(said(r('warning', { act: 'inf' }), c([inf]))).toEqual({
      line: 'Pipewrench got 3 warn points',
      detail: 'Thwomp filed rule 2. They drop off Nov 9. You can appeal from the post. In Hobbies.', ways: postWayOf, who: 'Pipewrench',
    });
    expect(said(r('warning', { act: 'inf' }), c([act('inf', { kind: 'infraction', character: null, seq: null, payload: { points: 1 } })])).line).toBe('Pipewrench got 1 warn point');
  });
  test('warning: a Mod key that was not loaded says "A Mod", never a character\'s name', () => {
    const inf = act('inf', { kind: 'infraction', character: null, seq: null, payload: { about_act: 'post4', character: 'c1', points: 3, rule_number: 2, staff: 'ra-m1', expires_at: '2026-11-09T09:00:00.000Z' } });
    expect(said(r('warning', { act: 'inf' }), c([inf], { staffNames: new Map() })).detail).toBe('A Mod filed rule 2. They drop off Nov 9. You can appeal from the post. In Hobbies.');
  });
  test('warning: where the post could not be loaded, it offers no appeal from a post it cannot link to', () => {
    const inf = act('inf', { kind: 'infraction', character: null, seq: null, targetActId: null, payload: { about_act: 'gone', character: 'c1', points: 3, rule_number: 2, staff: 'ra-m1', expires_at: '2026-11-09T09:00:00.000Z' } });
    expect(said(r('warning', { act: 'inf' }), c([inf])).detail).not.toContain('appeal from the post');
  });
  test('warning: the post is the one the infraction names, loaded by its payload id, when the infraction links to none', () => {
    const inf = act('inf', { kind: 'infraction', character: null, seq: null, targetActId: null, payload: { about_act: 'post4', character: 'c1', points: 3, staff: 'ra-m1', expires_at: '2026-11-09T09:00:00.000Z' } });
    expect(said(r('warning', { act: 'inf' }), c([inf])).ways).toEqual(postWayOf);
  });
  test('warning with no readable Act still says it, without the facts', () => {
    expect(said(r('warning'), c()).line).toBe('Pipewrench got warn points');
  });
  test('ban: until when, and that it ends by itself and can be appealed, the log as the way', () => {
    const ban = act('ban', { kind: 'ban', character: null, seq: null, payload: { character: 'c1', days: 3, until: '2026-11-12T10:00:00.000Z' } });
    expect(said(r('ban', { act: 'ban' }), c([ban]))).toEqual({
      line: 'Pipewrench was banned until Nov 12', detail: 'The warn bar filled. The ban ends by itself; you can appeal it to the Boss.', ways: logWay, who: 'Pipewrench',
    });
  });
  test('fall taken: names the taker from the infraction, and where the points landed', () => {
    const inf = act('inf', { kind: 'infraction', character: null, seq: null, payload: { about_act: 'post4', character: 'cTaker', points: 2 } });
    expect(said(r('fallTaken', { act: 'inf' }), c([inf]))).toEqual({
      line: "Gloomba took the fall for Pipewrench's post", detail: "The 2 warn points landed on Gloomba, not on Pipewrench. In Hobbies.", ways: postWayOf, who: 'Pipewrench',
    });
  });
  test('report judged: each verdict in plain words, a visit only where one was opened', () => {
    const verdict = (payload: Record<string, unknown>) => act('v', { kind: 'report_verdict', character: null, seq: null, targetActId: null, payload: { report_act: 'rep', line: 'The Mod sighs.', ...payload } });
    const line = (payload: Record<string, unknown>) => said(r('reportJudged', { act: 'v' }), c([verdict(payload)]));
    expect(line({ verdict: 'dismissed' })).toMatchObject({ line: "Pipewrench's report was judged: dismissed", ways: [{ text: 'Go to the thread', to: '/t/t1' }] });
    expect(line({ verdict: 'visit', visit_act: 'vis' }).line).toBe("Pipewrench's report was judged: a Mod opened a visit to the post");
    expect(line({ verdict: 'visit' }).line).toBe("Pipewrench's report was judged, but no visit was opened");
    expect(line({ verdict: 'backfire' })).toMatchObject({ line: "Pipewrench's report was judged: it backfired", detail: 'In Hobbies.' });
    expect(line({ verdict: 'backfire', visit_act: 'vis' }).detail).toBe('A Mod opened a visit to your own latest post. In Hobbies.');
    expect(said(r('reportJudged'), c()).line).toBe("Pipewrench's report was judged");
  });
  test('report refunded', () => {
    expect(said(r('reportRefunded'), c())).toMatchObject({ line: "Pipewrench's report could not be heard", detail: 'Its cost was refunded. In Hobbies.' });
  });
  test('appeal answered and refunded', () => {
    const v = act('v', { kind: 'appeal_ruling', character: null, seq: null, payload: { verdict: 'reduced' } });
    expect(said(r('appealAnswered', { act: 'v' }), c([v]))).toMatchObject({ line: "Pipewrench's appeal was reduced", ways: logWay });
    expect(said(r('appealRefunded'), c())).toMatchObject({ line: "Pipewrench's appeal was not heard", detail: 'Its cost was refunded. You can appeal again.' });
  });
  /* A conferGroup move as the SQL writes it (0423, system_tick): {kind, params: {character, group}, body}, with `expires_at` only where the move lasts, which a conferGroup does not. */
  const confer = (extra: Record<string, unknown> = {}) => act('mv', { kind: 'move', character: null, seq: null, payload: { kind: 'conferGroup', params: { group: 'tardy', character: 'c1' }, body: 'Done.', ...extra } });
  const groups = (tone: 'punishment' | 'favor') => ({ instance: { cards: [], groups: { ladder: [], conferred: [{ key: 'tardy', name: 'Tardy', tone }] } } as unknown as WordsContext['instance'] });
  test('grouped: a punishment names the group, points to the log for how it ends and offers the appeal and the apology', () => {
    expect(said(r('grouped', { act: 'mv' }), c([confer()], groups('punishment')))).toMatchObject({
      line: 'Pipewrench was put in Tardy', detail: 'The log says how it ends. You can appeal it, or apologize.', ways: logWay,
    });
    expect(said(r('grouped', { act: 'mv' }), c([confer()])).line).toBe('Pipewrench was put in a group');
    expect(said(r('grouped', { act: 'mv' }), c([confer()])).detail).toBe('The log says how it ends.');
  });
  test('grouped: a favor offers no appeal or apology, and an end the move holds is said', () => {
    expect(said(r('grouped', { act: 'mv' }), c([confer()], groups('favor'))).detail).toBe('The log says how it ends.');
    expect(said(r('grouped', { act: 'mv' }), c([confer({ expires_at: '2026-11-20T00:00:00.000Z' })], groups('favor'))).detail).toBe('It ends Nov 20 by itself.');
    expect(said(r('grouped', { act: 'mv' }), c([confer({ expires_at: '2026-11-20T00:00:00.000Z' })], groups('punishment'))).detail).toBe('It ends Nov 20 by itself. You can appeal it, or apologize.');
    expect(said(r('grouped', { act: 'mv' }), c([confer({ demand: { kind: 'apologyAccepted', params: {} } })], groups('punishment'))).detail).toBe('It ends when an apology is accepted. You can appeal it, or apologize.');
    expect(said(r('grouped', { act: 'mv' }), c([confer({ expires_at: '2026-11-20T00:00:00.000Z', demand: { kind: 'apologyAccepted', params: {} } })], groups('favor'))).detail).toBe('It ends Nov 20 by itself. It ends when an apology is accepted.');
  });
  test('thread moved: the thread and the board the move names, from the page; the thread that moved as the way (the row\'s own thread is the move\'s, Announcements)', () => {
    /* A moveThread move as the SQL writes it: {kind, params: {thread, board}, body}, in the Announcements thread; the thread's title and the board's name come with the page. */
    const move = act('mv', { kind: 'move', character: null, seq: null, thread: 'tAnn', payload: { kind: 'moveThread', params: { thread: 't1', board: 'b2' }, body: 'Done.' } });
    const moved = (o: Partial<Alert> = {}) => r('threadMoved', { act: 'mv', thread: 'tAnn', title: 'Announcements', ...o });
    const s = wordsFor(moved(), c([move], { boards: new Map([['b2', 'Crafts']]), threadTitles: new Map([['t1', 'Hobbies']]) }));
    expect(s.line).toEqual([{ em: 'Hobbies' }, ' was moved to the Crafts board']);
    expect(s.ways).toEqual([{ text: 'Go to the thread', to: '/t/t1' }]);
    /* A page that could not name them says so plainly, and never names the Announcements thread. */
    const bare = wordsFor(moved(), c([move]));
    expect(plainText(bare.line)).toBe('Your thread was moved to another board');
    expect(bare.ways).toEqual([{ text: 'Go to the thread', to: '/t/t1' }]);
    expect(plainText(wordsFor(moved({ act: null }), c()).line)).toBe('Your thread was moved to another board');
  });
  test('trophy reversed, poll closed and gear given send the player to the log', () => {
    expect(said(r('trophyReversed'), c())).toMatchObject({ line: 'An admin took back a trophy from Pipewrench', detail: 'The log says which.', ways: logWay });
    expect(said(r('pollClosed'), c()).line).toBe("An admin closed Pipewrench's poll");
    expect(said(r('gearGiven'), c())).toMatchObject({ line: 'An admin gave Pipewrench gear', detail: 'The log says what.', ways: logWay });
  });
  test('an unknown or null sub keeps the generic words', () => {
    for (const sub of [null, 'whatever']) expect(said(r(sub, { act: 'post4' }), c()).line).toBe('A ruling landed on Pipewrench');
  });
});

describe('cards ended and drawn, the new subs', () => {
  test('cardEnded onYours names the card and the place it was on', () => {
    const play = act('p', { kind: 'card', character: 'cBo', targetActId: 'post4', payload: { card: 'whoops', reach: 'post' } });
    const end = act('e', { kind: 'card_end', character: null, targetActId: 'p', seq: null });
    const s = said(row({ kind: 'cardEnded', sub: 'onYours', act: 'e', character: 'c1', name: 'Pipewrench', title: 'Hobbies' }), ctx([play, end, act('post4', { seq: 4, character: 'c1' })]));
    expect(s.line).toBe("An admin ended Whoops! on your post");
  });
  test('cardEnded refunded', () => {
    const play = act('p', { kind: 'card', payload: { card: 'whoops', reach: 'post' } });
    expect(said(row({ kind: 'cardEnded', sub: 'refunded', act: 'p', name: 'Pipewrench' }), ctx([play])).line).toBe('Your Whoops! did not take; it was refunded');
  });
  test('cardOnYours drew names the drawer and the post', () => {
    const wall = act('w', { kind: 'card', targetActId: 'post4', payload: { card: 'whoops', reach: 'post' } });
    const draw = act('d', { kind: 'draw', character: 'cMod', targetActId: 'w', seq: null });
    const c = ctx([wall, draw, act('post4', { seq: 4, character: 'c1' })], { names: new Map([['cMod', 'Thwomp']]) });
    expect(said(row({ kind: 'cardOnYours', sub: 'drew', act: 'd', character: 'c1', name: 'Pipewrench' }), c).line).toBe("Thwomp drew on the wall on Pipewrench's post #4");
  });
  test('drawings batch per wall and say how many', () => {
    const wall = act('w', { kind: 'card', targetActId: 'post4', payload: { card: 'whoops', reach: 'post' } });
    const d1 = act('d1', { kind: 'draw', character: 'cMod', targetActId: 'w', seq: null });
    const d2 = act('d2', { kind: 'draw', character: 'cMod', targetActId: 'w', seq: null });
    const c = ctx([wall, d1, d2, act('post4', { seq: 4, character: 'c1' })]);
    const rows = [row({ kind: 'cardOnYours', sub: 'drew', act: 'd2', name: 'Pipewrench' }), row({ kind: 'cardOnYours', sub: 'drew', act: 'd1', name: 'Pipewrench' })];
    expect(targetKey(rows[0]!, c)).toBe('wall:w');
    expect(plainText(batchWords(rows, c).line)).toBe("2 drawings on the wall on Pipewrench's post #4");
  });
});

describe('a gift', () => {
  /* donation -> the drive's opening play -> the post (three links, 0423 section 9); `amount` and `arrives` are in hundredths. */
  const post = act('post4', { seq: 4, character: 'c1' });
  const drive = act('drv', { kind: 'card', targetActId: 'post4', payload: { card: 'whoops', reach: 'post' } });
  const g = (id: string, amount: number, arrives: number) => act(id, { kind: 'donation', targetActId: 'drv', seq: null, payload: { amount, overhead: amount - arrives, arrives } });
  const r = (id: string) => row({ kind: 'gift', act: id, character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
  test('says the amount in dollars and cents, what was sent on, never who gave', () => {
    expect(said(r('g1'), ctx([post, drive, g('g1', 500, 375)]))).toEqual({
      line: "A gift of 5.00 was given to the drive on Pipewrench's post #4", detail: "3.75 of it was sent to Pipewrench, after the drive's overhead. In Hobbies.",
      ways: [{ text: 'Go to the post', to: '/t/t1?page=1#post-4' }], who: 'Pipewrench',
    });
    expect(said(r('g1'), ctx()).line).toBe('A gift was given to the drive on a post of Pipewrench\'s');
  });
  test('a gift that all went to overhead (the post\'s author is staff) does not say it reached anyone', () => {
    const s = said(r('g1'), ctx([post, drive, g('g1', 1000, 0)]));
    expect(s.line).toBe("A gift of 10.00 was given to the drive on Pipewrench's post #4");
    expect(s.detail).toBe("It all went to the drive's overhead. In Hobbies.");
    expect(`${s.line} ${s.detail}`).not.toMatch(/reached/);
  });
  test('gifts batch per drive and say how many', () => {
    const c = ctx([post, drive, g('g1', 500, 375), g('g2', 100, 75)]);
    expect(targetKey(r('g1'), c)).toBe('drive:drv');
    expect(plainText(batchWords([r('g2'), r('g1')], c).line)).toBe("2 gifts were given to the drive on Pipewrench's post #4");
  });
});

describe('conduct, plain', () => {
  const r = (sub: string | null) => row({ kind: 'conduct', sub, act: 'post4', character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
  const c = () => ctx([act('post4', { seq: 4 })]);
  const postWayOf = [{ text: 'Go to the post', to: '/t/t1?page=1#post-4' }];
  test('each outcome, in the glass\'s own plain voice', () => {
    expect(said(r('hide'), c())).toMatchObject({ line: "An admin hid Pipewrench's post for the code of conduct", ways: postWayOf });
    expect(said(r('hideUntilEdited'), c())).toMatchObject({ line: "An admin hid Pipewrench's post until it is edited", detail: 'Edit the post to bring it back. In Hobbies.' });
    expect(said(r('unhide'), c()).line).toBe("An admin brought back Pipewrench's post");
    expect(said(r('approve'), c()).line).toBe("An admin approved the edit to Pipewrench's post");
  });
  test('an unknown sub is still plain', () => {
    expect(said(r('whatever'), c()).line).toBe("A code of conduct decision on Pipewrench's post");
  });
  test('a decision on an edit points at the post the edit is of, since the version has no number', () => {
    const edit = act('ver', { kind: 'edit', targetActId: 'post4', seq: null });
    const on = row({ kind: 'conduct', sub: 'approve', act: 'ver', character: 'c1', name: 'Pipewrench', title: 'Hobbies' });
    expect(said(on, ctx([edit, act('post4', { seq: 4 })]))).toMatchObject({ line: "An admin approved the edit to Pipewrench's post", ways: postWayOf });
  });
});

describe('a settlement that paid only crowd pay', () => {
  test('says so, in place of "moved 0"', () => {
    expect(said(row({ kind: 'settlement', sub: '5', count: 0, thread: null }), ctx([], { newestSettlement: '5' })).detail).toBe('Crowd pay came in.');
  });
});
