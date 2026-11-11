import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castFor, dayActions as draw, DAY_MS as DAY, type World } from './generate.ts';
import type { RehearsalCorpus, Scenario, Sketch } from './types.ts';

const sketch = (n: number, over: Partial<Sketch> = {}): Sketch => ({
  key: `s${n}`, name: `Name${n}`, classKey: 'c', voice: 'dry', interests: [`topic${n}`, 'sprites'], feuds: [], postsPerDay: { least: n % 3, most: (n % 3) + 2 }, ...over,
});
const corpus: RehearsalCorpus = {
  sketches: Array.from({ length: 8 }, (_, n) => sketch(n, n === 1 ? { feuds: ['s2'] } : {})),
  openers: { general: [{ title: 'Anyone like sprites?', body: 'Asking for a friend.' }, { title: 'topic3 thread', body: 'Hmm.' }] },
  replies: ['Hey {name}, good point about {interest} on {board}.', 'Interesting.'],
  agreeing: ['Agreed, {name}.', 'Yes.'],
  disagreeing: ['No way, {name}.', 'Nope.'],
};
const scenario: Scenario = {
  key: 't', seed: 7, players: 4, charactersPerPlayer: { least: 2, most: 2 }, startThreads: 2, backstoryDays: 1, dayOfSeason: 3, days: 3,
  postsPerDay: { least: 0, most: 4 }, reactionsPerPost: { least: 1, most: 3 }, costCapDollars: 5,
};
const reactions = [
  { key: 'a', emoji: 'a', quadrant: 'excitedPositive' as const }, { key: 'b', emoji: 'b', quadrant: 'excitedNegative' as const },
  { key: 'c', emoji: 'c', quadrant: 'calmPositive' as const }, { key: 'd', emoji: 'd', quadrant: 'boredNegative' as const },
];
const LIMITS = { title: 200, post: 2000 };
const dayActions = (w: World, c: RehearsalCorpus, s: Scenario, d: number, l = LIMITS) => draw(w, c, s, d, l);
const cast = castFor(scenario, corpus);
const characters = cast.flatMap((p) => p.characters.map((c, i) => ({ id: `ch-${p.player}-${i}`, name: c.name, player: p.player, sketch: c.sketch })));
const world: World = {
  dayStart: 1_000 * DAY, reactions, characters,
  threads: [{ id: 't1', board: 'general', title: 'Anyone like sprites?', open: true }, { id: 't2', board: 'general', title: 'topic3 thread', open: true }],
  posts: characters.slice(0, 6).map((c, i) => ({ act: `p${i}`, thread: i % 2 ? 't1' : 't2', character: c.id, at: 1_000 * DAY - (i + 1) * 3_600_000 })),
};

test('castFor gives each player characters from the sketches in order without repeats', () => {
  assert.equal(cast.length, 4);
  const keys = cast.flatMap((p) => p.characters.map((c) => c.sketch));
  assert.deepEqual(keys, corpus.sketches.map((s) => s.key));
  assert.ok(cast.every((p) => p.characters.every((c) => c.classKey === 'c')));
  assert.throws(() => castFor({ ...scenario, players: 5 }, corpus));
});

test('the same seed and day give the same actions; another seed gives others', () => {
  const a = dayActions(world, corpus, scenario, 1);
  assert.ok(a.length > 0);
  assert.deepEqual(dayActions(world, corpus, scenario, 1), a);
  assert.notDeepEqual(dayActions(world, corpus, { ...scenario, seed: 8 }, 1), a);
  assert.notDeepEqual(dayActions(world, corpus, scenario, 2), a);
});

test('every action names a character and a thread or post in the world, within the day', () => {
  const ids = new Set(characters.map((c) => c.id));
  for (let day = 1; day <= 5; day++) for (const x of dayActions(world, corpus, scenario, day)) {
    assert.ok(x.at >= world.dayStart && x.at < world.dayStart + DAY);
    const r = x.request as Record<string, string>;
    assert.ok(ids.has(r.character!), 'character');
    const who = characters.find((c) => c.id === r.character)!;
    assert.equal(x.player, who.player);
    if (r.action === 'post') assert.ok(world.threads.some((t) => t.id === r.thread));
    else if (r.action === 'react') assert.ok(world.posts.some((p) => p.act === r.act) && reactions.some((k) => k.key === r.kind));
    else assert.equal(r.action, 'startThread');
  }
});

test('each character posts within its sketch bounds a day', () => {
  for (let day = 1; day <= 20; day++) {
    const counts = new Map<string, number>();
    for (const x of dayActions(world, corpus, { ...scenario, seed: day }, day)) {
      const r = x.request as Record<string, string>;
      if (r.action === 'post' || r.action === 'startThread') counts.set(r.character!, (counts.get(r.character!) ?? 0) + 1);
    }
    for (const c of characters) {
      const b = corpus.sketches.find((s) => s.key === c.sketch)!.postsPerDay;
      const n = counts.get(c.id) ?? 0;
      assert.ok(n >= b.least && n <= b.most, `${c.name} posted ${n}`);
    }
  }
});

test('no reaction is by the post own player, and no player reacts twice to a post', () => {
  for (let day = 1; day <= 20; day++) {
    const seen = new Set<string>();
    for (const x of dayActions(world, corpus, { ...scenario, seed: day }, day)) {
      const r = x.request as Record<string, string>;
      if (r.action !== 'react') continue;
      const post = world.posts.find((p) => p.act === r.act)!;
      const author = characters.find((c) => c.id === post.character)!;
      assert.notEqual(x.player, author.player);
      assert.ok(!seen.has(`${x.player}/${r.act}`));
      seen.add(`${x.player}/${r.act}`);
    }
  }
});

test('a feud draws a negative reaction and others a positive one', () => {
  const feud = characters.find((c) => c.sketch === 's1')!;
  const foe = characters.find((c) => c.sketch === 's2')!;
  const w: World = { ...world, posts: [{ act: 'x', thread: 't1', character: foe.id, at: world.dayStart - 1000 }] };
  const quad = (k: string) => reactions.find((r) => r.key === k)!.quadrant;
  let saw = 0;
  for (let day = 1; day <= 40; day++) for (const x of dayActions(w, corpus, { ...scenario, seed: day, reactionsPerPost: { least: 8, most: 8 } }, day)) {
    const r = x.request as Record<string, string>;
    if (r.action !== 'react') continue;
    const neg = quad(r.kind!).endsWith('Negative');
    if (r.character === feud.id) { saw++; assert.ok(neg); } else assert.ok(!neg);
  }
  assert.ok(saw > 0, 'a feud reaction happened');
});

test('replies fill {name} with real character names and leave no slot behind', () => {
  const names = new Set(characters.map((c) => c.name));
  let named = 0;
  for (let day = 1; day <= 30; day++) for (const x of dayActions(world, corpus, { ...scenario, seed: day }, day)) {
    const r = x.request as Record<string, string>;
    const body = r.body ?? '';
    assert.ok(!/[{}]/.test(body), body);
    if (r.action === 'post' && /Hey |Agreed, |No way, /.test(body)) {
      const n = /(?:Hey |Agreed, |No way, )(\w+)/.exec(body)![1]!;
      assert.ok(names.has(n), body);
      named++;
    }
  }
  assert.ok(named > 0);
});

const requests = (w: World, c = corpus, s = scenario, days = 30) =>
  Array.from({ length: days }, (_, d) => dayActions(w, c, { ...s, seed: d + 1 }, d + 1)).flat().map((x) => x.request as Record<string, string>);

test('replies lean toward threads a feud or an interest is in', () => {
  const feud = characters.find((c) => c.sketch === 's1')!;
  const foe = characters.find((c) => c.sketch === 's2')!;
  const w: World = {
    ...world, threads: [{ id: 'plain', board: 'general', title: 'nothing here', open: true }, { id: 'foes', board: 'general', title: 'nothing here', open: true }],
    posts: [{ act: 'x', thread: 'foes', character: foe.id, at: world.dayStart - 5 * DAY }],
  };
  const mine = requests(w, corpus, { ...scenario, reactionsPerPost: { least: 0, most: 0 } }, 60).filter((r) => r.action === 'post' && r.character === feud.id);
  const inFoes = mine.filter((r) => r.thread === 'foes').length;
  assert.ok(mine.length > 10 && inFoes > mine.length - inFoes, `${inFoes} of ${mine.length}`);
  const liking = characters.find((c) => c.sketch === 's3')!;
  const w2: World = { ...w, threads: [{ id: 'plain', board: 'general', title: 'nothing here', open: true }, { id: 'liked', board: 'general', title: 'All about topic3', open: true }], posts: [] };
  const l = requests(w2, corpus, scenario, 60).filter((r) => r.action === 'post' && r.character === liking.id);
  assert.ok(l.filter((r) => r.thread === 'liked').length > l.length / 2);
});

test('a reply to a feud uses a disagreeing line; {interest} and {board} are filled', () => {
  const feud = characters.find((c) => c.sketch === 's1')!;
  const foe = characters.find((c) => c.sketch === 's2')!;
  const c2: RehearsalCorpus = { ...corpus, replies: ['R {interest} {board}'], agreeing: ['A {interest} {board}'], disagreeing: ['D {name} {interest} {board}'] };
  const w: World = { ...world, threads: [{ id: 'foes', board: 'lounge', title: 'x', open: true }], posts: [{ act: 'x', thread: 'foes', character: foe.id, at: world.dayStart - 5 * DAY }] };
  const mine = requests(w, c2, scenario, 40).filter((r) => r.action === 'post' && r.character === feud.id);
  assert.ok(mine.length > 0);
  const interests = corpus.sketches.find((s) => s.key === 's1')!.interests;
  for (const r of mine) {
    const m = /^D (\w+) (\w+) lounge$/.exec(r.body!);
    assert.ok(m, r.body);
    assert.equal(m[1], foe.name);
    assert.ok(interests.includes(m[2]!));
  }
});

test('an empty world gives only thread starts; a board without openers is skipped; one character is fine', () => {
  const empty = requests({ ...world, threads: [], posts: [] });
  assert.ok(empty.length > 0 && empty.every((r) => r.action === 'startThread'));
  const c2: RehearsalCorpus = { ...corpus, openers: { quiet: [], general: corpus.openers.general! } };
  assert.ok(requests({ ...world, threads: [], posts: [] }, c2).every((r) => r.board === 'general'));
  const one: World = { ...world, characters: [characters[0]!], posts: [] };
  const got = requests(one);
  assert.ok(got.every((r) => r.action !== 'react'));
  assert.ok(got.every((r) => r.character === characters[0]!.id));
});

test('a closed thread is never replied to or reacted in', () => {
  const w: World = { ...world, threads: [{ id: 'shut', board: 'general', title: 'topic3', open: false }, { id: 't1', board: 'general', title: 'x', open: true }], posts: characters.map((c, i) => ({ act: `q${i}`, thread: 'shut', character: c.id, at: world.dayStart - 1000 })) };
  const got = requests(w);
  assert.ok(got.some((r) => r.action === 'post'));
  assert.ok(got.every((r) => r.thread !== 'shut' && r.action !== 'react'));
});

test('filled titles and bodies are trimmed to the limits', () => {
  for (let d = 1; d <= 10; d++) for (const x of dayActions(world, corpus, { ...scenario, seed: d }, d, { title: 5, post: 8 })) {
    const r = x.request as Record<string, string>;
    if (r.title !== undefined) assert.ok(Array.from(r.title).length <= 5);
    if (r.body !== undefined) assert.ok(Array.from(r.body).length <= 8);
  }
});

test('an interest that is a phrase weighs a thread whose title shares a significant word of it', () => {
  const phrase: RehearsalCorpus = { ...corpus, sketches: corpus.sketches.map((s) => s.key === 's3' ? { ...s, interests: ['speedrunning and the tricks behind it'] } : s) };
  const liking = characters.find((c) => c.sketch === 's3')!;
  const w2: World = { ...world, threads: [{ id: 'plain', board: 'general', title: 'nothing here', open: true }, { id: 'liked', board: 'general', title: 'Speedrunning routes, anyone?', open: true }], posts: [] };
  const l = requests(w2, phrase, scenario, 60).filter((r) => r.action === 'post' && r.character === liking.id);
  assert.ok(l.length > 10 && l.filter((r) => r.thread === 'liked').length > l.length / 2);
  const stop: World = { ...w2, threads: [{ id: 'plain', board: 'general', title: 'nothing here', open: true }, { id: 'stopwords', board: 'general', title: 'And the behind of that', open: true }] };
  const s = requests(stop, phrase, scenario, 60).filter((r) => r.action === 'post' && r.character === liking.id);
  assert.ok(s.filter((r) => r.thread === 'stopwords').length < s.length * 0.75, 'stopwords alone do not weigh a thread');
});
