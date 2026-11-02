/**
 * The tips' provider and the calls components make (docs/plans/2026-11-02-onboarding-plan.md, Task 4). `TipsProvider` sits in the board's
 * frame, beside the thread's `CalloutProvider`, reads the account's tips (`Preferences.tips`, `tipsSeen`), holds the page's one tip
 * (store.ts decides which) and draws it as the spotlight (Spotlight.tsx), in the instance's developer persona's voice (`InstanceUi.onboarding`).
 *
 * A component asks with `useTip(key, target, { when, step, group })`; the provider shows it when the page's budget, the account's
 * state and the pacing allow, and not otherwise. Got it calls `seeTip`; Skip all tips calls `skipTips`. A visitor has no account to
 * remember a tip on, so none shows.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useKayfa } from '../context.tsx';
import { usePlayer } from '../player.tsx';
import { DEFAULT_DEVELOPER } from '../../rules/instance.ts';
import type { TipKey } from './keys.ts';
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
  const apiRef = useRef(api);
  apiRef.current = api;
  const store = useMemo(() => createTipsStore({ see: (key) => apiRef.current.seeTip(key), skip: () => apiRef.current.skipTips() }), []);

  /* The account's own state, read once for the page: a visitor, or a failed read, has none and nothing shows. */
  useEffect(() => {
    let live = true;
    store.load(null);
    if (session.signedIn) void api.preferences().then((p) => { if (live) store.load({ tips: p.tips, seen: p.tipsSeen }); }, () => {});
    return () => { live = false; };
  }, [api, store, session.signedIn]);

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
          onGotIt={store.see}
          onSkip={store.skip}
        />
      )}
    </TipsCtx.Provider>
  );
}

export interface TipOptions {
  /** Whether the tip is wanted now (its real thing is on screen). Default true. */
  readonly when?: boolean;
  /** Where it is in a sequence, shown as "2 of 3". */
  readonly step?: TipStep;
  /** Tips of one group take turns on the page's budget (the tour's steps share one). */
  readonly group?: string;
}

/**
 * Ask for the tip `key` this page load, pointing at `target` (a ref to the element, read when the tip is decided). The provider shows
 * at most one tip a load, and none while the player types or a game effect holds the screen; a tip that cannot show waits for the next
 * load. Nothing here reads anything but the player's own screen.
 */
export function useTip(key: TipKey, target: RefObject<HTMLElement | null>, options: TipOptions = {}): void {
  const store = useTipsStore();
  const { when = true, group } = options;
  const n = options.step?.n;
  const of = options.step?.of;
  useEffect(() => {
    if (!when) return;
    return store.want({ key, target: () => target.current, group, ...(n !== undefined && of !== undefined ? { step: { n, of } } : {}) });
  }, [store, key, target, when, group, n, of]);
}

/** Say that a game effect holds the screen while `held` (a takeover, Stick Around's view); a tip is not shown over it. */
export function useHoldScreen(): (held: boolean) => void {
  const store = useTipsStore();
  const who = useId();
  useEffect(() => () => store.hold(who, false), [store, who]);
  return useCallback((held: boolean) => store.hold(who, held), [store, who]);
}

