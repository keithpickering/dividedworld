/**
 * The screens' addresses and the page each is, matched in order. A composition root renders
 * <Routes> inside the frame, with the screens it has; an address that matches none says so plainly
 * and links back to the index, so no address is a dead end.
 */
import { useLayoutEffect, type ReactNode } from 'react';
import { CannotDisplay, CannotFind } from './frame/Unavailable.tsx';
import { addressOf, match, useRouterInternals, type RouteLike } from './router.tsx';

export interface Route extends RouteLike {
  /** A path with `:name` segments, e.g. `/t/:thread`. */
  readonly path: string;
  readonly render: (params: Readonly<Record<string, string>>, doc?: unknown) => ReactNode;
}

export { match };

/** The screens the app draws for a failed load and an address no route matches; without them the board's two pages are drawn. */
export interface Failures {
  readonly display: (p: { readonly address: string; readonly onRetry: () => void }) => ReactNode;
  readonly find: (p: { readonly address: string }) => ReactNode;
}

export function Routes({ routes, failures }: { readonly routes: readonly Route[]; readonly failures?: Failures }) {
  const { shown, retry, attach } = useRouterInternals();
  useLayoutEffect(() => { attach(routes); });
  const address = addressOf(shown.location);
  if (shown.failure === 'display') return failures ? <>{failures.display({ address, onRetry: retry })}</> : <CannotDisplay address={address} onRetry={retry} />;
  if (shown.failure === 'find') return failures ? <>{failures.find({ address })}</> : <CannotFind address={address} />;
  for (const r of routes) {
    const params = match(r.path, shown.location.path);
    if (!params) continue;
    if (r.load && !shown.ready) return null;
    return <>{r.render(params, shown.doc)}</>;
  }
  return failures ? <>{failures.find({ address })}</> : <CannotFind address={address} />;
}
