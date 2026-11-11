/**
 * What a writing play's tail is at the version drawn (written.ts): a pure answer from the rows, the post's versions in order, the version
 * drawn and the mode. Live, the latest text wins and a failed regeneration keeps the tail the play had; in History and a moment it is the
 * version's own row alone.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Tail } from '../data/api.ts';
import { currentVersion, resolveWritten, versionAt, versionsOf } from './written.ts';

const text = (play: string, version: string, words: string): Tail => ({ post: 'p', play, version, text: words, failed: false, waiting: false, createdAt: '2026-11-07T12:00:00Z' });
const failed = (play: string, version: string): Tail => ({ post: 'p', play, version, text: null, failed: true, waiting: false, createdAt: '2026-11-07T12:00:00Z' });
const waiting = (play: string, version: string): Tail => ({ post: 'p', play, version, text: null, failed: false, waiting: true, createdAt: null });
const entries = (m: ReadonlyMap<string, unknown>) => Object.fromEntries(m);

describe('versionsOf and currentVersion', () => {
  test('versions are the distinct ones in the order the rows give them, the last being current', () => {
    const rows = [text('a', 'v1', 'x'), text('b', 'v1', 'y'), text('a', 'v2', 'z'), waiting('b', 'v2')];
    assert.deepEqual(versionsOf(rows), ['v1', 'v2']);
    assert.equal(currentVersion(rows), 'v2');
  });
  test('no rows have no version', () => {
    assert.deepEqual(versionsOf([]), []);
    assert.equal(currentVersion([]), null);
  });
});

describe('resolveWritten, live', () => {
  test('the text of the version drawn, for each play', () => {
    const rows = [text('a', 'v1', 'one'), text('b', 'v1', 'two')];
    assert.deepEqual(entries(resolveWritten(rows, ['v1'], 'v1', 'current')), { a: { text: 'one' }, b: { text: 'two' } });
  });
  test('a generation still waiting for the version drawn is waiting', () => {
    const rows = [text('a', 'v1', 'one'), waiting('a', 'v2')];
    assert.deepEqual(entries(resolveWritten(rows, ['v1', 'v2'], 'v2', 'current')), { a: { waiting: true } });
  });
  test('a failure keeps the tail the play had: the text of its latest earlier version', () => {
    const rows = [text('a', 'v1', 'first'), text('a', 'v2', 'second'), failed('a', 'v3')];
    assert.deepEqual(entries(resolveWritten(rows, ['v1', 'v2', 'v3'], 'v3', 'current')), { a: { text: 'second' } });
  });
  test('a failure with no earlier text is failed', () => {
    const rows = [failed('a', 'v1'), text('b', 'v1', 'kept')];
    assert.deepEqual(entries(resolveWritten(rows, ['v1'], 'v1', 'current')), { a: { failed: true }, b: { text: 'kept' } });
  });
  test('an earlier failure is no text to keep: the latest earlier version that has text is', () => {
    const rows = [text('a', 'v1', 'first'), failed('a', 'v2'), failed('a', 'v3')];
    assert.deepEqual(entries(resolveWritten(rows, ['v1', 'v2', 'v3'], 'v3', 'current')), { a: { text: 'first' } });
  });
  test('a play with no row for the version drawn keeps its latest earlier text, and a play with none at all is absent', () => {
    const rows = [text('a', 'v1', 'first'), text('b', 'v2', 'later')];
    assert.deepEqual(entries(resolveWritten(rows, ['v1', 'v2'], 'v2', 'current')), { a: { text: 'first' }, b: { text: 'later' } });
    assert.deepEqual(entries(resolveWritten([text('a', 'v2', 'x')], ['v1', 'v2'], 'v1', 'current')), {});
  });
  test('a text of a version after the one drawn is not read', () => {
    const rows = [text('a', 'v1', 'first'), text('a', 'v2', 'second')];
    assert.deepEqual(entries(resolveWritten(rows, ['v1', 'v2'], 'v1', 'current')), { a: { text: 'first' } });
  });
});

describe('resolveWritten, a version\'s own rows (History, a moment)', () => {
  const rows = [text('a', 'v1', 'one'), text('a', 'v2', 'two'), failed('b', 'v2'), waiting('c', 'v2'), text('b', 'v1', 'bee')];
  test('only the version\'s own text: its own row, nothing from another version', () => {
    assert.deepEqual(entries(resolveWritten(rows, ['v1', 'v2'], 'v1', 'version')), { a: { text: 'one' }, b: { text: 'bee' } });
  });
  test('a failed row and a waiting job draw none, and no row for a play draws none', () => {
    assert.deepEqual(entries(resolveWritten(rows, ['v1', 'v2'], 'v2', 'version')), { a: { text: 'two' } });
    assert.deepEqual(entries(resolveWritten(rows, ['v1', 'v2'], 'v3', 'version')), {});
  });
});

describe('versionAt', () => {
  const history = [
    { id: 'v1', kind: 'post', createdAt: '2026-11-07T12:00:00.000Z' },
    { id: 'v2', kind: 'edit', createdAt: '2026-11-07T12:05:00.123456+00:00' },
    { id: 'v3', kind: 'edit', createdAt: '2026-11-07T12:09:00.000Z' },
  ];
  test('the original where the moment was never edited', () => {
    assert.equal(versionAt(history, null), 'v1');
  });
  test('the edit made at that instant, however the time is written', () => {
    assert.equal(versionAt(history, '2026-11-07T12:05:00.123Z'), 'v2');
    assert.equal(versionAt(history, '2026-11-07T05:09:00-07:00'), 'v3');
  });
  test('no such version is none', () => {
    assert.equal(versionAt(history, '2026-11-07T13:00:00Z'), null);
    assert.equal(versionAt([], null), null);
  });
});
