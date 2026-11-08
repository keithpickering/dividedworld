/**
 * The glass's text link: the router's `Link`, with the Signal spinner after its text while the load it started is out
 * (docs/plans/2026-11-07-glass-load-design.md). It names its own source and claims it for the menu bar (claims.tsx), so the
 * menu bar's end shows no second spinner. It is the glass screens' link to another screen; a link to a place within the page is
 * the router's `Link`, which has no wait to show.
 */
import type { ComponentProps } from 'react';
import { Link } from '../router.tsx';
import { usePendingControl } from './claims.tsx';
import { Spinner } from './Spinner.tsx';
import './Link.css';

export function GlassLink({ children, className, source: _source, ...props }: ComponentProps<typeof Link>) {
  const { source, pending } = usePendingControl();
  return (
    <Link {...props} source={source} className={className ? `kb-glass-link ${className}` : 'kb-glass-link'} data-kb-pending={pending ? '' : undefined}>
      {children}
      {pending && <Spinner />}
    </Link>
  );
}
