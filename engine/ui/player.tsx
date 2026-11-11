/**
 * The signed-in player as the HUD and every screen see them: their session, their own
 * characters, the HUD's character, their wallet, the cards they hold, and the live estimate.
 *
 * The HUD's character is the player's own choice on this device: kept in the browser under the
 * account (`kb-hud:<account>`), sent nowhere, broadcast to nobody and carried by no address
 * ("What could vary with a private fact"). Only a character that has debuted and is not retired
 * can be chosen, since only one of those can act.
 *
 * The estimate is asked for on events, never on a timer (the clues design; the estimate function's
 * header): when the HUD opens, when a reaction lands on one of the player's own Acts, and after the
 * player's own reaction. An ask while one is out, or before the last answer's `freshAfter`, is held
 * and answered by one ask at `freshAfter`, however many came; so a post under a storm of reactions
 * costs one read of the window every thirty seconds at most, and none once the storm passes.
 *
 * At a settlement the wallet moves; the wallet last shown on this device (`kb-wallet-seen:<account>`)
 * is where the orbs' cascade runs from.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Answer, Boot, Bought, Estimate, HeldCard, Id, KayfaApi, MyCharacter, Opened, Session, Slot, Wallet } from './data/api.ts';
import { clearDrafts } from './composer/draft.ts';

export interface Player {
  readonly session: Session;
  /** Whether the session has been read yet: until then `session` stands signed out without being known to be. */
  readonly sessionKnown: boolean;
  /** Every character the player plays, waiting and retired ones included. */
  readonly characters: readonly MyCharacter[];
  /** Those that can act now: debuted and not retired. */
  readonly actingCharacters: readonly MyCharacter[];
  /**
   * The masks whose own posts the player answers for: every debuted one, retired among them. Only what is on a post the mask
   * wrote is saved through it (a Whoops! washed clean, supabase/migrations/0038_retired_author_washes.sql); every other act
   * goes through `actingCharacters`.
   */
  readonly writingCharacters: readonly MyCharacter[];
  readonly hudCharacter: MyCharacter | null;
  readonly setHudCharacter: (id: Id) => void;
  readonly wallet: Wallet | null;
  /** The wallet last shown on this device, when a settlement has moved it since: the cascade's start. */
  readonly walletSeen: number | null;
  readonly markWalletSeen: () => void;
  /** The estimate's sum, signed hundredths. */
  readonly pending: number;
  readonly estimate: Estimate | null;
  readonly cards: readonly HeldCard[];
  /** A reaction landed on one of the player's own Acts, or the player reacted: ask for the estimate. */
  readonly reactionLanded: () => void;
  /** Read the player's own rows again, after an action of theirs that changes them. */
  readonly refresh: () => Promise<boolean>;
  /** The last read of the player's own rows failed, so `characters` may be empty for want of a read, not because there are none: a screen says so rather than draw its empty state. */
  readonly charactersFailed: boolean;
  /** Buy a card from its slot of the Vending Machine; once it is bought the wallet and the hand are read again, so every screen shows the new ones. */
  readonly buyCard: (slot: Slot) => Promise<Answer<Bought>>;
  /** Buy a pack from its slot, the same way: the wallet and the hand are read again, and the cards it gave come back in pull order. */
  readonly buyPack: (slot: Slot) => Promise<Answer<Opened>>;
  readonly loaded: boolean;
}

const PlayerContext = createContext<Player | null>(null);

const SIGNED_OUT: Session = { signedIn: false, account: null };

const store = {
  get(key: string): string | null {
    try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
  },
  set(key: string, value: string): void {
    try { globalThis.localStorage?.setItem(key, value); } catch { /* a private window keeps nothing; the default holds */ }
  },
};

/** Where this device keeps the account's HUD character. */
export const hudKey = (account: Id) => `kb-hud:${account}`;

const canAct = (c: MyCharacter) => c.debutedAt !== null && c.retiredAt === null;

/** The player's rows as the provider holds them, with the account they were read for. */
interface Held {
  readonly for: Id | null;
  readonly characters: readonly MyCharacter[];
  readonly chosen: Id | null;
  readonly wallet: Wallet | null;
  readonly walletSeen: number | null;
  readonly cards: readonly HeldCard[];
  readonly loaded: boolean;
  /** The last read failed and none has landed since. */
  readonly failed: boolean;
}

/** Nothing read yet for `account`. */
const emptyFor = (account: Id | null): Held => ({ for: account, characters: [], chosen: null, wallet: null, walletSeen: null, cards: [], loaded: false, failed: false });

/**
 * What the first load already read (the forum-load plan, Task 12): the session, boot's rows and the estimate if it landed in time
 * (else its ask, still out, which lands in the provider on its own). The provider starts from these, reads none of them again on mount,
 * and refreshes as it always did.
 */
export interface PlayerInitial {
  readonly session: Session;
  readonly boot: Boot | null;
  readonly estimate: Estimate | null;
  /** The estimate's ask when it had not landed: its answer is taken as an ask's own; a failure is no estimate. */
  readonly estimateLater?: Promise<Estimate | null>;
}

/** The rows boot brought, held for its account as a refresh would hold them. */
function heldFrom(boot: Boot): Held {
  const account = boot.account;
  const seen = account ? store.get(`kb-wallet-seen:${account}`) : null;
  return {
    for: account, characters: boot.characters, wallet: boot.wallet, cards: boot.cards, loaded: true, failed: false,
    walletSeen: seen !== null && Number(seen) !== boot.wallet.balance ? Number(seen) : null,
    chosen: account ? store.get(hudKey(account)) : null,
  };
}

export function PlayerProvider({ api, initial, children }: { readonly api: KayfaApi; readonly initial?: PlayerInitial; readonly children: ReactNode }) {
  const [session, setSession] = useState<Session>(() => initial?.session ?? SIGNED_OUT);
  const [sessionKnown, setSessionKnown] = useState(() => initial !== undefined);
  /*
   * What the provider holds is kept with the account it was read for, and read in render against
   * the account signed in now: a value read for another account, or for none, reads as not loaded
   * and empty in the very commit the account changes, before any effect has run. So a signed-in
   * load never shows the empty roster for a commit, and the next player on a shared device never
   * sees the last one's characters, wallet, cards or HUD character (issue #56).
   */
  const [held, setHeld] = useState<Held>(() => (initial?.boot ? heldFrom(initial.boot) : emptyFor(null)));
  const [estimateHeld, setEstimateHeld] = useState<{ readonly for: Id | null; readonly estimate: Estimate | null }>(() => ({ for: initial?.boot ? initial.boot.account : null, estimate: initial?.boot ? initial.estimate : null }));
  /* What the first load read, for the account it was read for: nothing is read again for it on mount (until the account changes). */
  const adopted = useRef(initial?.boot ?? null);

  const account = session.account;
  /* Nothing read yet for the account signed in now: one value per account, not a new one each render. */
  const empty = useMemo(() => emptyFor(account), [account]);
  const mine = held.for === account ? held : empty;
  const { characters, chosen, wallet, walletSeen, cards } = mine;
  const charactersFailed = account !== null && mine.failed;
  /* No account has nothing to load; an account's rows are loaded once they were read for it. */
  const loaded = account === null ? true : mine.loaded;
  const estimate = estimateHeld.for === account ? estimateHeld.estimate : null;

  /* The account the screen is on now: an answer for another one (a sign-out or a switch since it was asked) is dropped. */
  const current = useRef<Id | null>(null);
  current.current = account;

  /* Each call is numbered: an earlier read landing after a later one changes nothing, and answers as the later one's rows stand. */
  const calls = useRef(0);
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!account) return true;
    const mineCall = ++calls.current;
    try {
      const [chars, w, hand] = await Promise.all([api.myCharacters(), api.wallet(), api.myCards()]);
      if (current.current !== account || calls.current !== mineCall) return true;
      const seen = store.get(`kb-wallet-seen:${account}`);
      setHeld({
        for: account, characters: chars, wallet: w, cards: hand, loaded: true, failed: false,
        walletSeen: seen !== null && Number(seen) !== w.balance ? Number(seen) : null,
        chosen: store.get(hudKey(account)),
      });
      return true;
    } catch {
      /* The rows as they were: the next action or page asks again. Loading still ends, so the HUD is never blank. */
      if (current.current === account && calls.current === mineCall) setHeld((h) => ({ ...(h.for === account ? h : emptyFor(account)), loaded: true, failed: true }));
      return false;
    }
  }, [api, account]);

  useEffect(() => {
    let live = true;
    /*
     * A session that cannot be read is read as signed out, so a screen shows its sign-in line rather than nothing. With the first load's
     * session in hand it is read once more here, since a change between the first load and this effect (before the subscription below) would
     * otherwise be lost: that read is taken only if no change was heard meanwhile and it differs from what is held, and a failure keeps it.
     */
    let heard = false;
    void api.session().then(
      (s) => {
        if (!live) return;
        if (!initial) { setSession(s); setSessionKnown(true); return; }
        if (!heard && (s.signedIn !== initial.session.signedIn || s.account !== initial.session.account)) setSession(s);
      },
      () => { if (live && !initial) { setSession(SIGNED_OUT); setSessionKnown(true); } },
    );
    const off = api.onSession((s) => {
      heard = true;
      /*
       * Signing out, or switching to another account, takes the account's unsent drafts off this
       * device; signed in with no account for a moment (a token refresh, a whoami that failed) keeps them.
       */
      const was = current.current;
      if (was && (!s.signedIn || (s.account !== null && s.account !== was))) clearDrafts(was);
      setSession(s);
      setSessionKnown(true);
    });
    return () => { live = false; off(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is the first load's, read on mount only
  }, [api]);

  useEffect(() => {
    /* The first load's rows are kept only for the account they were read for: any other state, signed out included, forgets them, so signing in again as the same account reads afresh. */
    if (adopted.current && adopted.current.account !== account) adopted.current = null;
    if (!account) return;
    /* The rows the first load brought are the account's already: read again only for another account, or after an action. */
    if (adopted.current?.account === account) return;
    void refresh();
  }, [account, refresh]);

  /*
   * The estimate's asks: one out at a time, none before freshAfter, a held ask answered once at
   * freshAfter. Each account has its own generation: what an earlier one asked lands nowhere.
   */
  const asking = useRef<{ gen: number; out: boolean; held: boolean; timer: ReturnType<typeof setTimeout> | null; freshAt: number }>({ gen: 0, out: false, held: false, timer: null, freshAt: 0 });
  /* One ask at a time: `source` is an ask already out (the first load's), else the estimate is asked now. */
  const run = useCallback((source?: Promise<Estimate | null>) => {
    const a = asking.current;
    /*
     * An ask is its account's: kept by something that outlived the account (the picker's choose,
     * answering after its await), it asks nothing once another account is signed in, so the
     * other account's estimate is never filed as this one's.
     */
    if (!account || current.current !== account) return;
    /*
     * The same check on the held timer and on the answer below is defense in depth: with the
     * generation and this check, either can only run between the next account's render and the
     * cleanup that resets them. This one is the check the tests hold.
     */
    const gen = a.gen;
    const later = (ms: number) => { a.timer = setTimeout(() => { if (a.gen !== gen || current.current !== account) return; a.timer = null; a.held = false; run(); }, ms); };
    const wait = a.freshAt - Date.now();
    if (!source && (a.out || wait > 0)) {
      a.held = true;
      if (!a.out && a.timer === null) later(wait);
      return;
    }
    a.out = true;
    void (source ?? api.estimate()).then((e) => {
      if (a.gen !== gen || current.current !== account || !e) return;
      setEstimateHeld({ for: account, estimate: e });
      /* Counted from receipt, as the function's header says: freshAfter - asOf from now. */
      const hold = e.asOf && e.freshAfter ? Date.parse(e.freshAfter) - Date.parse(e.asOf) : 0;
      a.freshAt = Date.now() + Math.max(0, hold);
    }, () => { /* No estimate is a ghost fill of nothing; the next event asks again. */ }).finally(() => {
      if (a.gen !== gen) return;
      a.out = false;
      if (a.held && a.timer === null) later(Math.max(0, a.freshAt - Date.now()));
    });
  }, [api, account]);
  const ask = useCallback(() => run(), [run]);

  useEffect(() => {
    if (!account) return;
    const a = asking.current;
    const first = adopted.current;
    if (first?.account === account) {
      /* The first load's estimate: held already if it landed in time, else its ask is taken as the one out; a failed one is no estimate. */
      const e = initial?.estimate ?? null;
      if (e) {
        const hold = e.asOf && e.freshAfter ? Date.parse(e.freshAfter) - Date.parse(e.asOf) : 0;
        a.freshAt = Date.now() + Math.max(0, hold);
      } else run(initial?.estimateLater ?? Promise.resolve(null));
    } else ask();
    return () => {
      if (a.timer) clearTimeout(a.timer);
      a.gen += 1;
      a.timer = null;
      a.out = false;
      a.held = false;
      a.freshAt = 0;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is the first load's, read for its own account only
  }, [account, ask, run]);

  const buyCard = useCallback(async (slot: Slot): Promise<Answer<Bought>> => {
    const bought = await api.buyCard(slot);
    /* A lost answer may have spent the Aura, so the rows are read again whatever came back. */
    if (bought.ok || bought.uncertain) await refresh();
    return bought;
  }, [api, refresh]);
  const buyPack = useCallback(async (slot: Slot): Promise<Answer<Opened>> => {
    const opened = await api.buyPack(slot);
    if (opened.ok || opened.uncertain) await refresh();
    return opened;
  }, [api, refresh]);

  const actingCharacters = useMemo(() => characters.filter(canAct), [characters]);
  const writingCharacters = useMemo(() => characters.filter((c) => c.debutedAt !== null), [characters]);
  const hudCharacter = actingCharacters.find((c) => c.id === chosen) ?? actingCharacters[0] ?? null;

  const setHudCharacter = useCallback((id: Id) => {
    setHeld((h) => (h.for === account ? { ...h, chosen: id } : h));
    if (account) store.set(hudKey(account), id);
  }, [account]);

  const markWalletSeen = useCallback(() => {
    if (!account || !wallet) return;
    store.set(`kb-wallet-seen:${account}`, String(wallet.balance));
    setHeld((h) => (h.for === account ? { ...h, walletSeen: null } : h));
  }, [account, wallet]);

  /* A first visit on this device has seen nothing to cascade from: start from the wallet as it is. */
  useEffect(() => {
    if (account && wallet && store.get(`kb-wallet-seen:${account}`) === null) store.set(`kb-wallet-seen:${account}`, String(wallet.balance));
  }, [account, wallet]);

  const pending = estimate ? estimate.entries.reduce((s, e) => s + e.amount, 0) : 0;

  const value = useMemo<Player>(() => ({
    session, sessionKnown, characters, actingCharacters, writingCharacters, hudCharacter, setHudCharacter, wallet, walletSeen, markWalletSeen,
    pending, estimate, cards, reactionLanded: ask, refresh, charactersFailed, buyCard, buyPack, loaded,
  }), [session, sessionKnown, characters, actingCharacters, writingCharacters, hudCharacter, setHudCharacter, wallet, walletSeen, markWalletSeen, pending, estimate, cards, ask, refresh, charactersFailed, buyCard, buyPack, loaded]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): Player {
  const p = useContext(PlayerContext);
  if (!p) throw new Error('a screen is rendered inside a PlayerProvider');
  return p;
}
