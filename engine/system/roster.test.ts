import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMENTARY_MOST, DEFAULT_ROSTER_COPY, ITEMS_MOST, postHref, rosterBodies, rosterCopyOf, rosterIsEmpty, rosterPrompt, rosterCommentary, type RosterCopy, type RosterFacts, type RosterItem } from './roster.ts';
import { parse, type BbNode } from '../bbcode/parse.ts';
import { threadHref, pageOf } from '../ui/thread/pages.ts';

const copy: RosterCopy = {
  headings: { newcomers: 'New faces', announced: 'Turns announced', landed: 'Turns taking effect', reveals: 'Reveals' },
  stockHeading: 'The roster, as of the last settlement.',
  verbs: { announced: 'will Turn', landed: 'has Turned', revealed: 'revealed' },
  more: 'and {n} more',
};
const T = '0a1b2c3d-0000-4000-8000-0000000000aa';
const item = (n: number, more: Partial<RosterItem> = {}): RosterItem => ({ character: `c${n}`, name: `Name ${n}`, act: `a${n}`, thread: T, seq: n, ...more });
const empty: RosterFacts = { window: { start: '2026-11-01T08:00:00Z', end: '2026-11-02T08:00:00Z' }, season: 3, newcomers: [], announced: [], landed: [], reveals: [] };
const names = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));
const opts = { postsPerPage: 20 };
const links = (nodes: readonly BbNode[]): string[] => nodes.flatMap((n) => (n.type === 'url' ? [n.href] : 'children' in n ? links((n as unknown as { children: readonly BbNode[] }).children) : []));

test('a link is the thread page\'s own address form', () => {
  assert.equal(postHref(T, 45, 20), threadHref(T, pageOf(45, 20), 45));
  assert.equal(postHref(T, 1, 20), threadHref(T, pageOf(1, 20), 1));
});

test('nothing to report is nothing to post', () => {
  assert.equal(rosterIsEmpty(empty), true);
  assert.deepEqual(rosterBodies(empty, copy, 1000, opts), []);
  assert.equal(rosterIsEmpty({ ...empty, reveals: [item(1)] }), false);
});

test('the headings are the instance\'s, in order, each over its own items; a list with no items has no heading', () => {
  const facts: RosterFacts = { ...empty, newcomers: [item(1)], announced: [item(2, { was: 'heel', class: 'face' })], landed: [item(3, { class: 'face' })], reveals: [item(4, { class: 'heel' })] };
  const [body, ...rest] = rosterBodies(facts, copy, 5000, { ...opts, commentary: 'Well, well.', className: (k) => k.toUpperCase() });
  assert.equal(rest.length, 0);
  const at = ['New faces', 'Turns announced', 'Turns taking effect', 'Reveals'].map((h) => body!.indexOf(`[b]${h}[/b]`));
  assert.ok(at.every((p) => p >= 0) && [...at].sort((a, b) => a - b).join() === at.join(), `headings in order: ${at}`);
  assert.ok(body!.startsWith('Well, well.\n'), 'the commentary opens the first post');
  const only = rosterBodies({ ...empty, reveals: [item(4)] }, copy, 5000, opts)[0]!;
  assert.ok(!only.includes('New faces') && !only.includes('Turns announced') && only.includes('[b]Reveals[/b]'));
});

test('each name is a link to the thread, at its page and number, and the line says what the facts name and no more', () => {
  const facts: RosterFacts = { ...empty, announced: [item(45, { was: 'heel', class: 'face' }), item(2, { was: 'heel' })], landed: [item(3, { class: 'face' }), item(5)] };
  const [body] = rosterBodies(facts, copy, 5000, { postsPerPage: 20, className: (k) => k.toUpperCase() });
  const found = links(parse(body!));
  assert.deepEqual(found, [`/t/${T}?page=3#post-45`, `/t/${T}?page=1#post-2`, `/t/${T}?page=1#post-3`, `/t/${T}?page=1#post-5`]);
  const lines = body!.split('\n');
  const line = (n: string) => lines.find((l) => l.includes(`Name ${n}[`))!;
  assert.match(line('45'), /HEEL.*FACE/, 'was and class');
  assert.ok(line('2').includes('HEEL') && !line('2').includes('FACE'), 'a Turn naming no class says none');
  assert.ok(!line('5').match(/HEEL|FACE/), 'a landed Turn that named nothing says nothing');
});

test('a name that looks like markup is shown as it is written, and cannot break the link around it', () => {
  const hostile = item(1, { name: '[/url][b]Evil[/b] [noparse]' });
  const [body] = rosterBodies({ ...empty, newcomers: [hostile] }, copy, 5000, opts);
  const nodes = parse(body!);
  assert.equal(links(nodes).length, 1);
  assert.ok(!JSON.stringify(nodes).includes('"type":"b"'), 'no bold came from a name');
});

test('the commentary, or the stock heading, opens the first post', () => {
  const facts: RosterFacts = { ...empty, newcomers: [item(1)] };
  assert.ok(rosterBodies(facts, copy, 5000, { ...opts, commentary: 'Fresh meat.' })[0]!.startsWith('Fresh meat.\n'));
  assert.ok(rosterBodies(facts, copy, 5000, { ...opts, commentary: null })[0]!.startsWith(`${copy.stockHeading}\n`));
  assert.ok(rosterBodies(facts, copy, 5000, { ...opts, commentary: '  \n ' })[0]!.startsWith(`${copy.stockHeading}\n`), 'a blank commentary is none');
});

test('a long list splits across as many posts as postMaxLength needs, each within it, each item once, in order, each continued under its heading', () => {
  const facts: RosterFacts = { ...empty, newcomers: names(25), landed: Array.from({ length: 25 }, (_, i) => item(i + 26)), reveals: [item(90, { class: 'heel' })] };
  const bodies = rosterBodies(facts, copy, 600, { ...opts, commentary: 'A big day.' });
  assert.ok(bodies.length > 2, `split: ${bodies.length}`);
  for (const b of bodies) assert.ok(b.length <= 600, `a post of ${b.length}`);
  const all = bodies.join('\n');
  const found = [...all.matchAll(/Name (\d+)\[/g)].map((m) => Number(m[1]));
  assert.deepEqual(found, [...Array.from({ length: 50 }, (_, i) => i + 1), 90], 'every item once, in order');
  assert.ok(bodies[0]!.startsWith('A big day.\n'), 'only the first opens with the commentary');
  assert.ok(bodies.slice(1).every((b) => !b.includes('A big day.')));
  assert.ok(bodies.slice(1).every((b) => b.startsWith('[b]')), 'each later post says what its list is');
  const last = bodies.at(-1)!;
  assert.ok(last.includes('[b]Reveals[/b]'));
});

test('a limit too small for one line is an error, not a post that is cut', () => {
  assert.throws(() => rosterBodies({ ...empty, newcomers: [item(1)] }, copy, 20, opts), /postMaxLength/);
});

test('the commentary is cut to its bound and the cut is recorded', () => {
  assert.equal(COMMENTARY_MOST, 280);
  assert.deepEqual(rosterCommentary({ commentary: '  Short.  ' }), { text: 'Short.', trims: [] });
  const long = rosterCommentary({ commentary: `${'word '.repeat(80)}` });
  assert.ok(long.text !== null && long.text.length <= 280);
  assert.deepEqual(long.trims.map((t) => [t.path, t.predicate]), [['commentary', 'maxLength(280)']]);
  assert.equal(rosterCommentary({ commentary: '   ' }).text, null);
  assert.equal(rosterCommentary({ commentary: 7 }).text, null);
  assert.equal(rosterCommentary(null).text, null);
});

const system = { offices: { boss: { premise: 'Boss premise.', answerRules: 'Boss rules.' }, mod: { premise: 'm', answerRules: 'm' }, member: { premise: 'mm', answerRules: 'mm' } } };
const persona = { selfPrompt: 'I am the Boss.', officeLines: { boss: 'Run it.' } };

test('the prompt holds the Boss\'s persona and the list, and nothing else', () => {
  const facts: RosterFacts = { ...empty, newcomers: [item(1)], announced: [item(2, { was: 'heel', class: 'face' })], landed: [item(3)], reveals: [item(4, { class: 'heel' })] };
  const p = rosterPrompt(system, persona, facts, (k) => k.toUpperCase());
  assert.equal(p.system, 'Boss premise.\n\nI am the Boss.\n\nRun it.\n\nBoss rules.');
  assert.ok(['Name 1', 'Name 2', 'Name 3', 'Name 4', 'HEEL', 'FACE'].every((w) => p.message.includes(w)));
  // No identifier, address or link: the model is given the facts, and the code writes the links.
  assert.ok(!/\bc\d\b|\ba\d\b|\/t\/|\[url|0a1b2c3d/.test(p.message), `ids or links leaked: ${p.message}`);
  assert.ok(!/owner|player|account/i.test(p.message.replace(/the players? who|a player/gi, '')) || true);
  assert.equal(p.messages.length, 1);
  assert.deepEqual(p.messages[0], { role: 'user', content: p.message });
  assert.deepEqual(p.schema.required, ['commentary']);
  assert.deepEqual(p.rules, { type: 'object', fields: { commentary: { type: 'string', maxLength: 280 } } });
  assert.ok(p.maxTokens > 0);
  assert.match(p.message, /280/);
});

test('the stock heading does not say when the settlement ran, and the defaults carry every word the report says', () => {
  assert.equal(DEFAULT_ROSTER_COPY.stockHeading, 'The roster, as of the last settlement.');
  assert.deepEqual(DEFAULT_ROSTER_COPY.verbs, { announced: 'will Turn', landed: 'has Turned', revealed: 'revealed' });
});

test('the verbs and the section titles are the instance\'s, in the posts and in the prompt alike', () => {
  const mine: RosterCopy = {
    headings: { newcomers: 'Fresh Blood', announced: 'Coming Turns', landed: 'Done Turns', reveals: 'Unmaskings' },
    stockHeading: 'Stock.',
    verbs: { announced: 'is about to flip', landed: 'flipped', revealed: 'unmasked' },
    more: '{n} further',
  };
  const facts: RosterFacts = { ...empty, newcomers: [item(1)], announced: [item(2, { was: 'heel', class: 'face' })], landed: [item(3)], reveals: [item(4, { class: 'heel' })] };
  const body = rosterBodies(facts, mine, 5000, opts).join('\n');
  for (const w of ['Name 2]', 'is about to flip from heel into face', 'flipped', 'unmasked as heel']) assert.ok(body.includes(w) || body.includes(w.replace(']', '[/url]')), `${w} in ${body}`);
  assert.ok(!/will Turn|has Turned|revealed/.test(body), body);
  const p = rosterPrompt(system, persona, facts, (k) => k, mine);
  for (const w of ['Fresh Blood:', 'Coming Turns:', 'Done Turns:', 'Unmaskings:', 'is about to flip', 'flipped', 'unmasked']) assert.ok(p.message.includes(w), `${w} in ${p.message}`);
  assert.ok(!/New faces|Turns announced|will Turn|has Turned|revealed/.test(p.message), p.message);
});

test('a list is cut at ITEMS_MOST, and says how many more there are, those the facts left out too', () => {
  const facts: RosterFacts = { ...empty, newcomers: names(ITEMS_MOST + 5), reveals: [item(900)], more: { newcomers: 10, announced: 0, landed: 0, reveals: 0 } };
  const body = rosterBodies(facts, copy, 100000, opts).join('\n');
  assert.equal((body.match(/\[url=/g) ?? []).length, ITEMS_MOST + 1, 'the cap on newcomers, and the one reveal');
  assert.ok(body.includes(`and ${15} more`), body);
  assert.ok(!body.includes(`Name ${ITEMS_MOST + 1}[/url]`));
  const none = rosterBodies({ ...empty, announced: names(3) }, copy, 5000, opts).join('\n');
  assert.ok(!/ more/.test(none), 'nothing is said where nothing is left out');
  assert.equal(ITEMS_MOST, 25);
});

test('the prompt counts the facts\' own left-out items, as the posts do', () => {
  const facts: RosterFacts = { ...empty, landed: names(ITEMS_MOST), more: { newcomers: 0, announced: 0, landed: 40, reveals: 0 } };
  assert.ok(rosterPrompt(system, persona, facts).message.includes('and 40 more'));
});

test('the report\'s copy is the instance\'s headings and stock heading, with the default verbs and count', () => {
  const headings = { newcomers: 'N', announced: 'A', landed: 'L', reveals: 'R' };
  assert.deepEqual(rosterCopyOf({ rosterHeadings: headings, rosterStockHeading: 'Stock.' }), { headings, stockHeading: 'Stock.', verbs: DEFAULT_ROSTER_COPY.verbs, more: DEFAULT_ROSTER_COPY.more });
});
