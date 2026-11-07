import { describe, expect, test, vi } from 'vitest';
import type { KayfaApi } from './data/api.ts';
import { SIGNED_OUT_DOC } from './screen-docs.ts';
import { charactersKey, lazyScreen, loadChunk, loadContact, loadMyCharacters, loadSeason, loadSettings, seasonAsked, seasonKey, settingsKey } from './glass-docs.ts';

const q = (s: string) => new URLSearchParams(s);
const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};
const settled = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

/** An api whose every read fails the test but the ones named. */
const apiOf = (reads: Record<string, unknown>) => reads as unknown as KayfaApi;
const signed = (is: boolean) => () => is;

describe('the keys', () => {
  test('My characters and Edit profile are one key', () => {
    expect(charactersKey()).toBe('/characters');
  });

  test('a season is keyed by its tab, season, character and page; an address that asks the same thing keys the same', () => {
    expect(seasonKey(q(''))).toBe(seasonKey(q('tab=rankings')));
    expect(seasonKey(q('tab=rankings'))).not.toBe(seasonKey(q('tab=news')));
    expect(seasonKey(q('tab=rankings&page=2'))).not.toBe(seasonKey(q('tab=rankings')));
    expect(seasonKey(q('tab=rankings&season=3'))).not.toBe(seasonKey(q('tab=rankings')));
    expect(seasonKey(q('season=3&character=c1'))).not.toBe(seasonKey(q('season=3')));
    expect(seasonKey(q('page=abc'))).toBe(seasonKey(q('')));
  });

  test('a season asked for is a whole number from 1, a character only with a season, and a page as it is written', () => {
    expect(seasonAsked(q('tab=news'))).toEqual({ tab: 'news', season: null, character: null, page: null });
    expect(seasonAsked(q('season=0&character=c1'))).toEqual({ tab: 'rankings', season: null, character: null, page: null });
    expect(seasonAsked(q('season=2&character=c1&page=3'))).toEqual({ tab: 'rankings', season: 2, character: 'c1', page: 3 });
  });

  test('Settings is keyed by its section', () => {
    expect(settingsKey(q(''))).toBe('accessibility');
    expect(settingsKey(q('section=bogus'))).toBe('accessibility');
    expect(settingsKey(q('section=account'))).toBe('account');
    expect(settingsKey(q('section=notifications'))).toBe('notifications');
  });
});

describe('the loaders', () => {
  test('a lazy screen\'s chunk and its document are awaited together: both start at once, and neither alone lands the route', async () => {
    const chunk = deferred();
    const doc = deferred<unknown>();
    const preload = vi.fn(() => chunk.promise);
    const myCharactersPage = vi.fn(() => doc.promise);
    let landed = false;
    void loadMyCharacters({ api: apiOf({ myCharactersPage }), signedIn: signed(true) }, preload).then(() => { landed = true; });
    await settled();
    expect(preload).toHaveBeenCalledTimes(1);
    expect(myCharactersPage).toHaveBeenCalledTimes(1);
    doc.resolve({ characters: [] });
    await settled();
    expect(landed).toBe(false);
    chunk.resolve();
    await settled();
    expect(landed).toBe(true);
  });

  test('the document alone landing early waits for the chunk, and a chunk that fails fails the load', async () => {
    const preload = vi.fn(() => Promise.reject(new Error('chunk')));
    await expect(loadContact({ api: apiOf({ adminContact: () => Promise.resolve([]) }), signedIn: signed(false) }, preload)).rejects.toThrow('chunk');
  });

  test('signed out, a document loader answers the marker with no request, and the chunk is still loaded', async () => {
    const preload = vi.fn(() => Promise.resolve());
    const read = vi.fn();
    const env = { api: apiOf({ myCharactersPage: read, seasonPage: read, invites: read }), signedIn: signed(false) };
    expect(await loadMyCharacters(env, preload)).toBe(SIGNED_OUT_DOC);
    expect(await loadSeason(env, q('tab=news'), preload)).toBe(SIGNED_OUT_DOC);
    expect(await loadSettings(env, q('section=account'), preload)).toBe(SIGNED_OUT_DOC);
    expect(read).not.toHaveBeenCalled();
    expect(preload).toHaveBeenCalledTimes(3);
  });

  test('Contact reads signed out, one adminContact call', async () => {
    const adminContact = vi.fn(() => Promise.resolve([{ label: 'Mail', href: 'mailto:a@b.c' }]));
    const doc = await loadContact({ api: apiOf({ adminContact }), signedIn: signed(false) }, () => Promise.resolve());
    expect(adminContact).toHaveBeenCalledTimes(1);
    expect(doc).toEqual([{ label: 'Mail', href: 'mailto:a@b.c' }]);
  });

  test('Season asks seasonPage with what the address names', async () => {
    const seasonPage = vi.fn(() => Promise.resolve({ tab: 'news' }));
    const env = { api: apiOf({ seasonPage }), signedIn: signed(true) };
    await loadSeason(env, q('tab=rankings&season=2&character=c1&page=3'), () => Promise.resolve());
    expect(seasonPage).toHaveBeenLastCalledWith('rankings', 2, 'c1', 3);
    await loadSeason(env, q('tab=news'), () => Promise.resolve());
    expect(seasonPage).toHaveBeenLastCalledWith('news', null, null, null);
  });

  test('a season that does not exist answers null, which the router shows as "can\'t be found"', async () => {
    const env = { api: apiOf({ seasonPage: () => Promise.resolve(null) }), signedIn: signed(true) };
    expect(await loadSeason(env, q('season=99'), () => Promise.resolve())).toBeNull();
  });

  test('Settings reads the invites in Account alone; every other section is its chunk alone', async () => {
    const invites = vi.fn(() => Promise.resolve([]));
    const env = { api: apiOf({ invites }), signedIn: signed(true) };
    const preload = vi.fn(() => Promise.resolve());
    expect(await loadSettings(env, q('section=account'), preload)).toEqual([]);
    expect(invites).toHaveBeenCalledTimes(1);
    expect(await loadSettings(env, q(''), preload)).toBeUndefined();
    expect(await loadSettings(env, q('section=notifications'), preload)).toBeUndefined();
    expect(invites).toHaveBeenCalledTimes(1);
    expect(preload).toHaveBeenCalledTimes(3);
  });

  test('a screen with no document loads its chunk and answers nothing', async () => {
    const preload = vi.fn(() => Promise.resolve('chunk'));
    expect(await loadChunk(preload)).toBeUndefined();
    expect(preload).toHaveBeenCalledTimes(1);
  });
});

describe('lazyScreen', () => {
  test('preload imports the chunk once, and the component uses the same import', async () => {
    const importer = vi.fn(() => Promise.resolve({ default: () => null }));
    const screen = lazyScreen(importer);
    await screen.preload();
    await screen.preload();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(screen.Component).toBeDefined();
  });

  test('a chunk that failed is imported again on the next preload', async () => {
    const importer = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ default: () => null });
    const screen = lazyScreen(importer);
    await expect(screen.preload()).rejects.toThrow('offline');
    await screen.preload();
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
