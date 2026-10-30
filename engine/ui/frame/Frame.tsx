/**
 * The frame every page sits in: a plain 2003 banner with the links (a Menu button on a phone), the
 * page, and the HUD docked at the bottom (the screens' design, section 2). The forum is the game
 * screen and the bar is its HUD.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import { Link, useLocation } from '../router.tsx';
import { Hud } from './Hud.tsx';
import './frame.css';

export interface FrameLink {
  readonly to: string;
  readonly label: string;
}

export function Frame({ links, children }: { readonly links: readonly FrameLink[]; readonly children: ReactNode }) {
  const { ui } = useKayfa();
  const [open, setOpen] = useState(false);
  const navId = useId();
  /*
   * A move to another page reads as one: the page starts at its top and focus is on it, so a
   * keyboard and a screen reader begin there, as after a load. An address with a fragment is the
   * page's to scroll to (a permalink), and a change of query alone is the same page.
   */
  const { path, hash, popped } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!hash && !popped) globalThis.scrollTo?.(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [path]);
  return (
    <div className="kb-frame">
      <header className="kb-banner">
        <Link to="/" className="kb-logo">{ui.copy.siteName}</Link>
        <span className="kb-tagline kb-muted kb-small">{ui.copy.siteTagline}</span>
        <button type="button" className="kb-button kb-menu-button" aria-expanded={open} aria-controls={navId} onClick={() => setOpen((o) => !o)}>
          Menu
        </button>
        <nav id={navId} className="kb-nav" aria-label="Site" data-kb-open={open || undefined}>
          <ul>
            {links.map((l) => (
              <li key={l.to}><Link to={l.to} onClick={() => setOpen(false)}>{l.label}</Link></li>
            ))}
          </ul>
        </nav>
      </header>
      <main ref={main} className="kb-page" tabIndex={-1}>{children}</main>
      <Hud />
    </div>
  );
}
