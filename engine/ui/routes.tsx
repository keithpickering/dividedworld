/**
 * The screens' addresses and the page each is, matched in order. A composition root renders
 * <Routes> inside the frame, with the screens it has; an address that matches none says so plainly
 * and links back to the index, so no address is a dead end.
 */
import type { ReactNode } from 'react';
import { Link, useLocation } from './router.tsx';

export interface Route {
  /** A path with `:name` segments, e.g. `/t/:thread`. */
  readonly path: string;
  readonly render: (params: Readonly<Record<string, string>>) => ReactNode;
}

/** The params of a path against a pattern, or null when it does not match. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const a = path.split('/').filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(a[i]!);
    else if (seg !== a[i]) return null;
  }
  return params;
}

export function Routes({ routes }: { readonly routes: readonly Route[] }) {
  const { path } = useLocation();
  for (const r of routes) {
    const params = match(r.path, path);
    if (params) return <>{r.render(params)}</>;
  }
  return (
    <div className="kb-not-found">
      <h1 className="kb-heading">No such page</h1>
      <p>There is nothing at this address. <Link to="/">Back to the index</Link>.</p>
    </div>
  );
}
