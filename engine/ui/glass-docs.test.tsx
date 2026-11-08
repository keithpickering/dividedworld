import { render } from '@testing-library/react';
import { Suspense, useEffect } from 'react';
import { describe, expect, test, vi } from 'vitest';
import type { KayfaApi } from './data/api.ts';
import { SIGNED_OUT_DOC } from './screen-docs.ts';
import { alertsKey, charactersKey, ESTIMATE_WAIT_MS, isNotAdminDoc, lazyScreen, loadAlerts, loadChunk, loadContact, loadLog, loadMyCharacters, loadQueue, loadSeason, loadSettings, loadUpdates, logKey, NOT_ADMIN_DOC, queueKey, seasonAsked, seasonKey, settingsKey, updatesAsked, updatesKey } from './glass-docs.ts';

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
    const env = { api: apiOf({ invites, signInAddress: () => Promise.resolve('a@b.c') }), signedIn: signed(true) };
    const preload = vi.fn(() => Promise.resolve());
    expect(await loadSettings(env, q('section=account'), preload)).toEqual({ invites: [], address: 'a@b.c' });
    expect(invites).toHaveBeenCalledTimes(1);
    expect(await loadSettings(env, q(''), preload)).toBeUndefined();
    expect(await loadSettings(env, q('section=notifications'), preload)).toBeUndefined();
    expect(invites).toHaveBeenCalledTimes(1);
    expect(preload).toHaveBeenCalledTimes(3);
  });

  test('an address that cannot be read does not fail Account: the row says so', async () => {
    const env = { api: apiOf({ invites: () => Promise.resolve([]), signInAddress: () => Promise.reject(new Error('no')) }), signedIn: signed(true) };
    expect(await loadSettings(env, q('section=account'), () => Promise.resolve())).toEqual({ invites: [], address: null });
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

  test('a screen whose chunk has landed draws its content in the first render, with no Suspense fallback, and keeps its state across re-renders', async () => {
    let mounts = 0;
    const Screen = ({ label }: { readonly label: string }) => { useEffect(() => { mounts += 1; }, []); return <p>{label}</p>; };
    const screen = lazyScreen(() => Promise.resolve({ default: Screen }));
    await screen.preload();
    const Shown = screen.Component;
    const view = render(<Suspense fallback={<div aria-busy="true" data-testid="fallback" />}><Shown label="one" /></Suspense>);
    /* Synchronously after the render: a lazy component would still be on its fallback here. */
    expect(view.queryByTestId('fallback')).toBeNull();
    expect(view.getByText('one')).toBeInTheDocument();
    view.rerender(<Suspense fallback={<div aria-busy="true" data-testid="fallback" />}><Shown label="two" /></Suspense>);
    expect(view.getByText('two')).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  test('a screen drawn before its chunk lands falls back, then draws the chunk once and is not remounted when the chunk is in', async () => {
    let mounts = 0;
    const Screen = ({ label }: { readonly label: string }) => { useEffect(() => { mounts += 1; }, []); return <p>{label}</p>; };
    const screen = lazyScreen(() => Promise.resolve({ default: Screen }));
    const Shown = screen.Component;
    const tree = (label: string) => <Suspense fallback={<div data-testid="fallback" />}><Shown label={label} /></Suspense>;
    const view = render(tree('one'));
    expect(view.getByTestId('fallback')).toBeInTheDocument();
    await screen.preload();
    expect(await view.findByText('one')).toBeInTheDocument();
    view.rerender(tree('two'));
    expect(view.getByText('two')).toBeInTheDocument();
    expect(mounts).toBe(1);
  });

  test('a chunk that failed is imported again on the next preload', async () => {
    const importer = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ default: () => null });
    const screen = lazyScreen(importer);
    await expect(screen.preload()).rejects.toThrow('offline');
    await screen.preload();
    expect(importer).toHaveBeenCalledTimes(2);
  });
});

describe('the alerts, updates, queue and log keys', () => {
  test('alerts, the queue and the log each have one key; the log and the settlement summary share it', () => {
    expect(alertsKey()).toBe('/alerts');
    expect(queueKey()).toBe('/admin/queue');
    expect(logKey()).toBe('/log');
  });

  test('updates are keyed by the open update, the writer asked for and its season; an address that asks the same thing keys the same', () => {
    expect(updatesKey(q(''))).toBe(updatesKey(q('foo=bar')));
    expect(updatesKey(q('update=a'))).not.toBe(updatesKey(q('')));
    expect(updatesKey(q('update=a'))).not.toBe(updatesKey(q('update=b')));
    expect(updatesKey(q('write=handover&season=2'))).not.toBe(updatesKey(q('write=handover&season=3')));
    expect(updatesKey(q('write=handover&season=2'))).not.toBe(updatesKey(q('')));
  });

  test('a handover season is asked only with the writer, and only a whole number from 1', () => {
    expect(updatesAsked(q('update=a'))).toEqual({ update: 'a', write: null, season: null });
    expect(updatesAsked(q('season=2'))).toEqual({ update: null, write: null, season: null });
    expect(updatesAsked(q('write=handover&season=2'))).toEqual({ update: null, write: 'handover', season: 2 });
    expect(updatesAsked(q('write=handover&season=0')).season).toBeNull();
    expect(updatesAsked(q('write=handover&season=3.5')).season).toBeNull();
    expect(updatesAsked(q('write=handover&season=abc')).season).toBeNull();
  });
});

describe('the alerts, updates, queue and log loaders', () => {
  const chunk = () => Promise.resolve();

  test('signed out, each answers the marker with no request, and the chunk is still loaded', async () => {
    const read = vi.fn();
    const env = { api: apiOf({ alertsPage: read, updatesPage: read, queuePage: read, logPage: read, estimate: read }), signedIn: signed(false) };
    const preload = vi.fn(chunk);
    expect(await loadAlerts(env, preload)).toBe(SIGNED_OUT_DOC);
    expect(await loadUpdates(env, q(''), preload)).toBe(SIGNED_OUT_DOC);
    expect(await loadQueue(env, preload)).toBe(SIGNED_OUT_DOC);
    expect(await loadLog(env, preload)).toBe(SIGNED_OUT_DOC);
    expect(read).not.toHaveBeenCalled();
    expect(preload).toHaveBeenCalledTimes(4);
  });

  test('alerts read the newest page, and updates read what the address names', async () => {
    const alertsPage = vi.fn(() => Promise.resolve({ alerts: [] }));
    const updatesPage = vi.fn(() => Promise.resolve({ updates: [] }));
    const env = { api: apiOf({ alertsPage, updatesPage }), signedIn: signed(true) };
    await loadAlerts(env, chunk);
    expect(alertsPage).toHaveBeenCalledWith(null);
    await loadUpdates(env, q('update=a&write=handover&season=2'), chunk);
    expect(updatesPage).toHaveBeenLastCalledWith('a', null, 2);
    await loadUpdates(env, q('update=a&season=2'), chunk);
    expect(updatesPage).toHaveBeenLastCalledWith('a', null, null);
  });

  test('the queue answers the page for an admin and a marker of its own for anyone else, which is no "can\'t be found"', async () => {
    const page = { queue: {} };
    const queuePage = vi.fn().mockResolvedValueOnce(page).mockResolvedValueOnce(null);
    const boards = vi.fn(() => Promise.resolve([{ id: 'b' }]));
    const env = { api: apiOf({ queuePage, boards }), signedIn: signed(true) };
    expect(await loadQueue(env, chunk)).toEqual({ ...page, boards: [{ id: 'b' }] });
    const other = await loadQueue(env, chunk);
    expect(other).toBe(NOT_ADMIN_DOC);
    expect(isNotAdminDoc(other)).toBe(true);
    expect(isNotAdminDoc(page)).toBe(false);
    expect(boards).toHaveBeenCalledTimes(2);
    expect(queuePage).toHaveBeenCalledTimes(2);
  });

  test('nothing a loader reads writes: no see_*, no mark read', async () => {
    const write = vi.fn();
    const api = apiOf({
      alertsPage: () => Promise.resolve({}), updatesPage: () => Promise.resolve({}), queuePage: () => Promise.resolve({}), boards: () => Promise.resolve([]),
      logPage: () => Promise.resolve({ acts: [] }), estimate: () => Promise.resolve({ lines: [] }),
      seeAlerts: write, seeSettlement: write, seeWelcome: write, markRead: write,
    });
    const env = { api, signedIn: signed(true) };
    await Promise.all([loadAlerts(env, chunk), loadUpdates(env, q(''), chunk), loadQueue(env, chunk), loadLog(env, chunk)]);
    expect(write).not.toHaveBeenCalled();
  });

  test('the log reads its page beside the estimate, and the estimate\'s Acts the page did not name', async () => {
    const logPage = vi.fn(() => Promise.resolve({ acts: [{ id: 'a1' }] }));
    const estimate = vi.fn(() => Promise.resolve({ lines: [{ act: 'a1' }, { act: 'a2' }, { act: null }, { act: 'a2' }] }));
    const actsById = vi.fn((ids: readonly string[]) => Promise.resolve(ids.map((id) => ({ id }))));
    const doc = await loadLog({ api: apiOf({ logPage, estimate, actsById }), signedIn: signed(true) }, chunk);
    expect(logPage).toHaveBeenCalledWith(null);
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(actsById).toHaveBeenCalledWith(['a2']);
    expect(doc).toMatchObject({ estimate: { lines: expect.any(Array) }, estimateActs: [{ id: 'a2' }] });
  });

  test('a failed estimate leaves the log without one, and a slow one is not waited for past its bound', async () => {
    const logPage = () => Promise.resolve({ acts: [] });
    expect(await loadLog({ api: apiOf({ logPage, estimate: () => Promise.reject(new Error('lost')) }), signedIn: signed(true) }, chunk)).toEqual({ page: { acts: [] }, estimate: null });
    vi.useFakeTimers();
    try {
      const slow = deferred<{ lines: [] }>();
      const landed = vi.fn();
      const env = { api: apiOf({ logPage, estimate: () => slow.promise }), signedIn: signed(true) };
      const doc = loadLog(env, chunk).then((d) => { landed(d); return d; });
      await vi.advanceTimersByTimeAsync(ESTIMATE_WAIT_MS - 1);
      expect(landed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      const d = await doc;
      expect(d).toMatchObject({ estimate: null });
      expect((d as { estimateLater?: Promise<unknown> }).estimateLater).toBeInstanceOf(Promise);
      slow.resolve({ lines: [] });
      expect(await (d as { estimateLater: Promise<unknown> }).estimateLater).toEqual({ lines: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  test('a chunk and the document of the log are awaited together', async () => {
    const gate = deferred();
    let landed = false;
    void loadLog({ api: apiOf({ logPage: () => Promise.resolve({ acts: [] }), estimate: () => Promise.resolve({ lines: [] }) }), signedIn: signed(true) }, () => gate.promise).then(() => { landed = true; });
    await settled();
    expect(landed).toBe(false);
    gate.resolve();
    await settled();
    expect(landed).toBe(true);
  });
});

describe('the log\'s estimate bound covers its Acts', () => {
  test('an actsById that never answers cannot hold the page: it lands at the bound, the estimate filling in later', async () => {
    vi.useFakeTimers();
    try {
      const logPage = () => Promise.resolve({ acts: [] });
      const estimate = () => Promise.resolve({ lines: [{ act: 'a1' }] });
      const actsById = () => new Promise<never>(() => {});
      const landed = vi.fn();
      const doc = loadLog({ api: apiOf({ logPage, estimate, actsById }), signedIn: signed(true) }, () => Promise.resolve()).then((d) => { landed(d); return d; });
      await vi.advanceTimersByTimeAsync(ESTIMATE_WAIT_MS - 1);
      expect(landed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      const d = await doc;
      expect(d).toMatchObject({ estimate: null });
      expect((d as { estimateLater?: unknown }).estimateLater).toBeInstanceOf(Promise);
    } finally {
      vi.useRealTimers();
    }
  });
});
