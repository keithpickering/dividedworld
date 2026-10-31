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
import type { Answer, Bought, Estimate, HeldCard, Id, KayfaApi, MyCharacter, Session, Wallet } from './data/api.ts';
import { clearDrafts } from './composer/draft.ts';

export interface Player {
  readonly session: Session;
  /** Whether the session has been read yet: until then `session` stands signed out without being known to be. */
  readonly sessionKnown: boolean;
  /** Every character the player plays, waiting and retired ones included. */
  readonly characters: readonly MyCharacter[];
  /** Those that can act now: debuted and not retired. */
  readonly actingCharacters: readonly MyCharacter[];
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
  readonly refresh: () => Promise<void>;
  /** Buy a card from the Vending Machine; once it is bought the wallet and the hand are read again, so every screen shows the new ones. */
  readonly buyCard: (card: string) => Promise<Answer<Bought>>;
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
}

/** Nothing read yet for `account`. */
const emptyFor = (account: Id | null): Held => ({ for: account, characters: [], chosen: null, wallet: null, walletSeen: null, cards: [], loaded: false });

export function PlayerProvider({ api, children }: { readonly api: KayfaApi; readonly children: ReactNode }) {
  const [session, setSession] = useState<Session>(SIGNED_OUT);
  const [sessionKnown, setSessionKnown] = useState(false);
  /*
   * What the provider holds is kept with the account it was read for, and read in render against
   * the account signed in now: a value read for another account, or for none, reads as not loaded
   * and empty in the very commit the account changes, before any effect has run. So a signed-in
   * load never shows the empty roster for a commit, and the next player on a shared device never
   * sees the last one's characters, wallet, cards or HUD character (issue #56).
   */
  const [held, setHeld] = useState<Held>(() => emptyFor(null));
  const [estimateHeld, setEstimateHeld] = useState<{ readonly for: Id | null; readonly estimate: Estimate | null }>({ for: null, estimate: null });

  const account = session.account;
  /* Nothing read yet for the account signed in now: one value per account, not a new one each render. */
  const empty = useMemo(() => emptyFor(account), [account]);
  const mine = held.for === account ? held : empty;
  const { characters, chosen, wallet, walletSeen, cards } = mine;
  /* No account has nothing to load; an account's rows are loaded once they were read for it. */
  const loaded = account === null ? true : mine.loaded;
  const estimate = estimateHeld.for === account ? estimateHeld.estimate : null;

  /* The account the screen is on now: an answer for another one (a sign-out or a switch since it was asked) is dropped. */
  const current = useRef<Id | null>(null);
  current.current = account;

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const [chars, w, hand] = await Promise.all([api.myCharacters(), api.wallet(), api.myCards()]);
      if (current.current !== account) return;
      const seen = store.get(`kb-wallet-seen:${account}`);
      setHeld({
        for: account, characters: chars, wallet: w, cards: hand, loaded: true,
        walletSeen: seen !== null && Number(seen) !== w.balance ? Number(seen) : null,
        chosen: store.get(hudKey(account)),
      });
    } catch {
      /* The rows as they were: the next action or page asks again. Loading still ends, so the HUD is never blank. */
      if (current.current === account) setHeld((h) => ({ ...(h.for === account ? h : emptyFor(account)), loaded: true }));
    }
  }, [api, account]);

  useEffect(() => {
    let live = true;
    void api.session().then((s) => { if (live) { setSession(s); setSessionKnown(true); } });
    const off = api.onSession((s) => {
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
  }, [api]);

  useEffect(() => {
    if (account) void refresh();
  }, [account, refresh]);

  /*
   * The estimate's asks: one out at a time, none before freshAfter, a held ask answered once at
   * freshAfter. Each account has its own generation: what an earlier one asked lands nowhere.
   */
  const asking = useRef<{ gen: number; out: boolean; held: boolean; timer: ReturnType<typeof setTimeout> | null; freshAt: number }>({ gen: 0, out: false, held: false, timer: null, freshAt: 0 });
  const ask = useCallback(() => {
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
    const later = (ms: number) => { a.timer = setTimeout(() => { if (a.gen !== gen || current.current !== account) return; a.timer = null; a.held = false; ask(); }, ms); };
    const wait = a.freshAt - Date.now();
    if (a.out || wait > 0) {
      a.held = true;
      if (!a.out && a.timer === null) later(wait);
      return;
    }
    a.out = true;
    void api.estimate().then((e) => {
      if (a.gen !== gen || current.current !== account) return;
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

  useEffect(() => {
    if (!account) return;
    ask();
    const a = asking.current;
    return () => {
      if (a.timer) clearTimeout(a.timer);
      a.gen += 1;
      a.timer = null;
      a.out = false;
      a.held = false;
      a.freshAt = 0;
    };
  }, [account, ask]);

  const buyCard = useCallback(async (card: string): Promise<Answer<Bought>> => {
    const bought = await api.buyCard(card);
    /* A lost answer may have spent the Aura, so the rows are read again whatever came back. */
    if (bought.ok || bought.uncertain) await refresh();
    return bought;
  }, [api, refresh]);

  const actingCharacters = useMemo(() => characters.filter(canAct), [characters]);
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
    session, sessionKnown, characters, actingCharacters, hudCharacter, setHudCharacter, wallet, walletSeen, markWalletSeen,
    pending, estimate, cards, reactionLanded: ask, refresh, buyCard, loaded,
  }), [session, sessionKnown, characters, actingCharacters, hudCharacter, setHudCharacter, wallet, walletSeen, markWalletSeen, pending, estimate, cards, ask, refresh, buyCard, loaded]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): Player {
  const p = useContext(PlayerContext);
  if (!p) throw new Error('a screen is rendered inside a PlayerProvider');
  return p;
}
