import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSitePath } from './next.ts';

const ORIGIN = 'https://dw.gripe';

test('a path on the site is returned with its query and fragment', () => {
  assert.equal(sameSitePath('/board/general?page=2#top', ORIGIN), '/board/general?page=2#top');
  assert.equal(sameSitePath('/standings', ORIGIN), '/standings');
  assert.equal(sameSitePath('/', ORIGIN), '/');
});

test('anything that leaves the site, or is not a path, is null', () => {
  for (const next of ['//evil.example', '//evil.example/x', '/\\evil.example', '/\t/evil.example', '/\n/evil.example', 'https://evil.example/', 'javascript:alert(1)', 'standings', '', ' /x', null, undefined, 7, {}, ['/x']]) {
    assert.equal(sameSitePath(next, ORIGIN), null, JSON.stringify(next));
  }
});

test('a path is at most 512 characters', () => {
  const at = '/' + 'a'.repeat(511);
  assert.equal(sameSitePath(at, ORIGIN), at);
  assert.equal(sameSitePath(at + 'a', ORIGIN), null);
});
