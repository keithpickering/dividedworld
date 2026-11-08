/**
 * The sources a page's controls have claimed (docs/plans/2026-11-07-glass-load-plan.md, Task 3). A control that shows its own wait
 * (a menu tab, Back, a GlassLink, a `to` GlassButton) names its load's source and registers it here while it is mounted; the menu bar
 * reads the set, and draws the spinner at its end only for a load out whose source is none (a Back or Forward, a `navigate` that named
 * none) or one no mounted control has claimed, so the wait is never drawn twice, nor beside a tab already spinning. Page.tsx provides the
 * set; a control outside any provider (the HUD, which sits on the board) claims into nothing, and shows its own wait all the same.
 */
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { usePendingFrom } from '../router.tsx';

export interface Claims {
  /** Registers `source` until the returned cleanup runs; two controls may claim one source. */
  readonly claim: (source: string) => () => void;
  readonly has: (source: string) => boolean;
  readonly subscribe: (listener: () => void) => () => void;
}

export function makeClaims(): Claims {
  const counts = new Map<string, number>();
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((l) => l());
  return {
    claim(source) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
      tell();
      return () => {
        const left = (counts.get(source) ?? 1) - 1;
        if (left <= 0) counts.delete(source); else counts.set(source, left);
        tell();
      };
    },
    has: (source) => counts.has(source),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

const ClaimsContext = createContext<Claims | null>(null);

export function ClaimsProvider({ children }: { readonly children: ReactNode }) {
  const [claims] = useState(makeClaims);
  return <ClaimsContext.Provider value={claims}>{children}</ClaimsContext.Provider>;
}

/** Whether a provider is above; the menu bar makes its own where it stands alone. */
export function useHasClaims(): boolean {
  return useContext(ClaimsContext) !== null;
}

/* Layout effect where there is a DOM to lay out, so a claim stands in the commit that mounts the control, before the menu bar next renders. */
const useEarly = typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** Claims `source` while the caller is mounted (no source claims nothing); a no-op where no provider is above. */
export function useClaim(source: string | undefined): void {
  const claims = useContext(ClaimsContext);
  useEarly(() => (claims && source !== undefined ? claims.claim(source) : undefined), [claims, source]);
}

/** A pending-aware control: its own source (claimed while mounted) and whether the load that source started is out. `on` false makes it neither. */
export function usePendingControl(on = true): { readonly source: string; readonly pending: boolean } {
  const source = useId();
  useClaim(on ? source : undefined);
  const pending = usePendingFrom(on ? source : undefined);
  return useMemo(() => ({ source, pending }), [source, pending]);
}

/** Whether a load out from `source` (null: none named) is drawn by no mounted control, so the menu bar's end should show it. */
export function useUnclaimed(source: string | null | undefined): boolean {
  const claims = useContext(ClaimsContext);
  const snapshot = () => (source === undefined ? false : source === null ? true : !claims?.has(source));
  return useSyncExternalStore(claims?.subscribe ?? noSubscribe, snapshot, snapshot);
}

const noSubscribe = () => () => undefined;
