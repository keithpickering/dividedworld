/**
 * The tips' provider and the calls components make (docs/plans/2026-11-02-onboarding-plan.md, Task 4). `TipsProvider` sits in the board's
 * frame, beside the thread's `CalloutProvider`, reads the account's tips (`Preferences.tips`, `tipsSeen`), holds the page's one tip
 * (store.ts decides which) and draws it as the spotlight (Spotlight.tsx), in the instance's developer persona's voice (`InstanceUi.onboarding`).
 *
 * A component asks with `useTip(key, target, { when, step, group })`; the provider shows it when the page's budget, the account's
 * state and the pacing allow, and not otherwise. Got it calls `seeTip`; Skip all tips calls `skipTips`. A visitor has no account to
 * remember a tip on, so none shows. The provider's own preferences (the tilt choice its shine tip turns on) are saved through the page's one
 * holder of the account's choices (account/pagePreferences.ts), never from what boot read when the page loaded.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useBoot } from '../boot.tsx';
import { useKayfa } from '../context.tsx';
import { usePlayer } from '../player.tsx';
import { DEFAULT_DEVELOPER } from '../../rules/instance.ts';
import type { TipKey } from './keys.ts';
import { motionReduced } from '../appearance.ts';
import { watchShinyInView } from '../shine/loop.ts';
import { allowTilt, subscribeTilt, tiltAnswered, tiltState, tiltSupported } from '../shine/tilt.ts';
import type { Preferences } from '../data/api.ts';
import { usePreferenceSaves } from '../account/preferences.ts';
import { Spotlight } from './Spotlight.tsx';
import { createTipsStore, type TipStep, type TipsStore } from './store.ts';

export type { TipStep, TipsStore } from './store.ts';
export type { TipKey } from './keys.ts';

/** With no provider (a story of one screen, a test of one component) nothing is gated and no tip is ever shown. */
const open: TipsStore = createTipsStore({ see: async () => {}, skip: async () => {} }, { ungated: true });
const TipsCtx = createContext<TipsStore>(open);

export const useTipsStore = (): TipsStore => useContext(TipsCtx);

export function TipsProvider({ children }: { readonly children: ReactNode }) {
  const { api, instance, ui } = useKayfa();
  const { session } = usePlayer();
  const boot = useBoot();
  const apiRef = useRef(api);
  apiRef.current = api;
  const store = useMemo(() => createTipsStore({ see: (key) => apiRef.current.seeTip(key), skip: () => apiRef.current.skipTips() }), []);

  /* The account's own state, read once for the page: a visitor, or a failed read, has none and nothing shows. */
  const [account, setAccount] = useState<Preferences | null>(null);
  useEffect(() => {
    let live = true;
    store.load(null);
    setAccount(null);
    /* Boot's preferences are the account's as the page loaded, for the tips: a session that changed after boot reads its own. The tilt choice and
       every other setting come from the page's holder of the account's choices (account/pagePreferences.ts), which boot only seeds when it holds nothing. */
    if (boot) { store.load({ tips: boot.preferences.tips, seen: boot.preferences.tipsSeen, welcomedAt: boot.preferences.welcomedAt }); setAccount(boot.preferences); }
    else if (session.signedIn) void api.preferences().then((p) => { if (live) { store.load({ tips: p.tips, seen: p.tipsSeen, welcomedAt: p.welcomedAt }); setAccount(p); } }, () => {});
    return () => { live = false; };
  }, [api, store, session.signedIn, boot]);

  /* The tilt choice is saved the way Settings saves it (a refusal puts it back), merged onto the choices the page holds now, so a setting changed
     in Settings after the page loaded is never put back to boot's; and the account's choice is read for the tilt state with it. */
  const { prefs, change } = usePreferenceSaves(session.account, account);
  const changeRef = useRef(change);
  changeRef.current = change;
  const read = prefs !== null;

  /* The shine tip: the first shiny post in view, on a phone that can tilt and has not been asked (design section 4). The loop names the
     host's canvas; this asks again whenever the canvas or the tilt state changes (a grant or a choice made elsewhere withdraws it). */
  useEffect(() => {
    if (!read) return undefined;
    let canvas: HTMLCanvasElement | null = null;
    let wanted: HTMLCanvasElement | null = null;
    let unwant: (() => void) | null = null;
    const sync = () => {
      /* The state no longer calls for the tip (a grant or a choice made elsewhere): withdrawn, open or not. */
      if (!askForTilt()) {
        unwant?.();
        unwant = null;
        wanted = null;
        return;
      }
      if (canvas === null || canvas === wanted) return;
      /* Open, the tip is being read: a new host in view does not take it away, and it stays on the post it opened on. */
      if (unwant && store.isOpen('shine')) return;
      unwant?.();
      const next = canvas;
      wanted = next;
      unwant = store.want({
        key: 'shine',
        target: () => next,
        action: {
          run: () => {
            /* Synchronously, in the tap: iOS asks for the orientation only here. Then the same choice, saved the way Settings saves it. */
            void allowTilt();
            changeRef.current({ tilt: 'on' });
          },
        },
      });
    };
    const stop = watchShinyInView((c) => { canvas = c; sync(); });
    const unsubscribe = subscribeTilt(sync);
    return () => { stop(); unsubscribe(); unwant?.(); };
  }, [store, read]);

  const active = useSyncExternalStore(store.subscribe, store.active, store.active);
  const persona = instance.developer ?? DEFAULT_DEVELOPER;
  const words = active ? ui.onboarding.tips[active.key] : undefined;
  return (
    <TipsCtx.Provider value={store}>
      {children}
      {active && words && (
        <Spotlight
          tipKey={active.key}
          title={words.title}
          line={words.line}
          step={active.step}
          target={active.target}
          persona={{ name: persona.name, picture: persona.avatar === undefined ? undefined : ui.avatars?.[persona.avatar] }}
          action={active.action && words.action !== undefined ? { label: words.action, run: active.action.run } : undefined}
          onGotIt={store.see}
          onSkip={store.skip}
        />
      )}
    </TipsCtx.Provider>
  );
}

/** Whether a tip about turning tilt on is wanted: a coarse pointer that can tilt, under full motion, not yet asked, and not already on. */
function askForTilt(): boolean {
  if (motionReduced() || !tiltSupported() || !(window.matchMedia?.('(pointer: coarse)').matches ?? false)) return false;
  const state = tiltState();
  return state === 'needs-allow' || (state === 'off' && !tiltAnswered());
}

export interface TipOptions {
  /** Whether the tip is wanted now (its real thing is on screen). Default true. */
  readonly when?: boolean;
  /** Where it is in a sequence, shown as "2 of 3". */
  readonly step?: TipStep;
  /** Tips of one group take turns on the page's budget (the tour's steps share one). */
  readonly group?: string;
  /** A button before Got it (the instance words its label, `InstanceUi.onboarding.tips`); it runs inside the click, then the tip is seen. */
  readonly action?: { readonly run: () => void };
}

/**
 * Ask for the tip `key` this page load, pointing at `target` (a ref to the element, read when the tip is decided). The provider shows
 * at most one tip a load, and none while the player types or a game effect holds the screen; a tip that cannot show waits for the next
 * load. Nothing here reads anything but the player's own screen.
 */
export function useTip(key: TipKey, target: RefObject<HTMLElement | null>, options: TipOptions = {}): void {
  const store = useTipsStore();
  const { when = true, group, action } = options;
  /* The action's identity is not a reason to ask again: an inline `{ run }` is new every render. Whether there is one is. */
  const actionRef = useRef(action);
  actionRef.current = action;
  const hasAction = action !== undefined;
  const n = options.step?.n;
  const of = options.step?.of;
  useEffect(() => {
    if (!when) return;
    return store.want({ key, target: () => target.current, group, ...(hasAction ? { action: { run: () => actionRef.current?.run() } } : {}), ...(n !== undefined && of !== undefined ? { step: { n, of } } : {}) });
  }, [store, key, target, when, group, hasAction, n, of]);
}

/** Say that a game effect holds the screen while `held` (a takeover, Stick Around's view); a tip is not shown over it. */
export function useHoldScreen(): (held: boolean) => void {
  const store = useTipsStore();
  const who = useId();
  useEffect(() => () => store.hold(who, false), [store, who]);
  return useCallback((held: boolean) => store.hold(who, held), [store, who]);
}

