import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSearching, parseSearch, searchHref, searchParams, type SearchAsk } from './query.ts';

const p = (s: string) => parseSearch(new URLSearchParams(s));
const BLANK = { q: '', author: null, board: null, fromAt: null, toAt: null, titlesOnly: false, sort: null, perPage: null };

test('parseSearch: no fields is the blank search, posts, page 1', () => {
  assert.deepEqual(p(''), { query: BLANK, view: 'posts', page: 1, after: null });
});

test('every field round-trips through the address', () => {
  const ask: SearchAsk = {
    query: {
      q: '"green shell" -kart or shell', author: 'c-1', board: 'b-2', titlesOnly: true, sort: 'oldest', perPage: 50,
      fromAt: new Date(2026, 9, 5, 0, 0, 0, 0).toISOString(), toAt: new Date(2026, 9, 6, 23, 59, 59, 999).toISOString(),
    },
    view: 'threads', page: 3, after: { rank: 4.5, at: '2026-10-05T12:30:00.000Z', act: 'a-9' },
  };
  assert.deepEqual(parseSearch(searchParams(ask)), ask);
  assert.deepEqual(p(searchHref(ask).split('?')[1]!), ask);
});

test('a null rank (newest and oldest) round-trips in a cursor', () => {
  const ask: SearchAsk = { query: { ...BLANK, q: 'x' }, view: 'posts', page: 2, after: { rank: null, at: '2026-10-05T12:30:00.000Z', act: 'a-9' } };
  assert.deepEqual(parseSearch(searchParams(ask)), ask);
});

test('the dates are the reader\'s days, whole: from is its midnight, to is its last millisecond', () => {
  const ask = p('from=2026-10-05&to=2026-10-06');
  assert.equal(ask.query.fromAt, new Date(2026, 9, 5, 0, 0, 0, 0).toISOString());
  assert.equal(ask.query.toAt, new Date(2026, 9, 6, 23, 59, 59, 999).toISOString());
  assert.equal(searchParams(ask).get('from'), '2026-10-05');
  assert.equal(searchParams(ask).get('to'), '2026-10-06');
});

test('defaults are left out of the address', () => {
  assert.equal(searchHref(p('')), '/search');
  assert.equal(searchHref({ query: { ...BLANK, q: 'wario' }, view: 'posts', page: 1, after: null }), '/search?q=wario');
});

test('unknown values drop to their defaults, field by field', () => {
  const ask = p('sort=sideways&as=cards&in=nowhere&from=yesterday&to=2026-13-45&per=0&author=%00&board=&page=-4&after=junk');
  assert.deepEqual(ask, { query: BLANK, view: 'posts', page: 1, after: null });
  assert.equal(p('per=51').query.perPage, null);
  assert.equal(p('per=2.5').query.perPage, null);
  assert.equal(p('per=20').query.perPage, 20);
});

test('a page past the first needs the cursor that reaches it, else it is the first page', () => {
  assert.equal(p('q=x&page=4').page, 1);
  assert.equal(p('q=x&page=4&after=1.5%7C2026-10-05T12%3A30%3A00.000Z%7Ca-9').page, 4);
  assert.equal(p('q=x&page=4&after=1.5%7Cnot-a-time%7Ca-9').page, 1);
});

test('isSearching: any keyword or filter, not the form alone', () => {
  assert.equal(isSearching(BLANK), false);
  assert.equal(isSearching({ ...BLANK, q: '   ' }), false);
  assert.equal(isSearching({ ...BLANK, q: 'x' }), true);
  assert.equal(isSearching({ ...BLANK, author: 'c' }), true);
  assert.equal(isSearching({ ...BLANK, board: 'b' }), true);
  assert.equal(isSearching({ ...BLANK, fromAt: '2026-10-05T00:00:00.000Z' }), true);
  assert.equal(isSearching({ ...BLANK, toAt: '2026-10-05T00:00:00.000Z' }), true);
  assert.equal(isSearching({ ...BLANK, titlesOnly: true }), false);
});
