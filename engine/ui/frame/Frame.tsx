/**
 * The frame every board page sits in: the board's own banner, the page, and the Game HUD docked at
 * the bottom (the glass plan, section 7, boards 01 and 02). The forum is the game screen and the
 * HUD is its status bar; the glass's pages (My characters, Settings and the rest) are not in the
 * frame but in the glass's own page shell (engine/ui/glass/Page.tsx), reached from the HUD's Menu.
 *
 * The banner is the instance's name, and under it, a row of its own as the Main board draws it, the
 * board's navigation: Index and the boards, and Sign in when signed out. It holds no Sign out (that
 * is Settings › Account's) and none of the glass's pages. On a phone its links fold behind the
 * banner's button that reads Boards, so it is never confused with the HUD's Menu. Its Sign in leads
 * into the glass; the board's place for Back is kept by that move, as by every move into the glass
 * (keepBoardPlace, engine/ui/glass/back.ts), not by the link.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { signInHref } from '../account/next.ts';
import { useKayfa } from '../context.tsx';
import type { BoardSummary } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Link, searchOf, useLocation } from '../router.tsx';
import { Hud } from './Hud.tsx';
import './frame.css';

export function Frame({ children }: { readonly children: ReactNode }) {
  const { api, ui } = useKayfa();
  const { session } = usePlayer();
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<readonly BoardSummary[]>([]);
  const navId = useId();
  /*
   * A move to another page reads as one: the page starts at its top and focus is on it, so a
   * keyboard and a screen reader begin there, as after a load. An address with a fragment is the
   * page's to scroll to (a permalink), and a change of query alone is the same page.
   */
  const { path, query, hash, popped } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!hash && !popped) globalThis.scrollTo?.(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [path]);

  /* The boards are read for a session only; signed out the banner holds Index and Sign in. */
  useEffect(() => {
    let live = true;
    setBoards([]);
    if (!session.signedIn) return;
    void api.boards().then((b) => { if (live) setBoards(b); }, () => {});
    return () => { live = false; };
  }, [api, session.signedIn]);

  const here = searchOf(query);
  const links: readonly { readonly to: string; readonly label: string }[] = [
    { to: '/', label: 'Index' },
    ...boards.map((b) => ({ to: `/b/${b.slug}`, label: b.name })),
    ...(session.signedIn ? [] : [{ to: signInHref(path, here), label: 'Sign in' }]),
  ];

  return (
    <div className="kb-frame">
      <header className="kb-banner">
        <Link to="/" className="kb-logo">{ui.copy.siteName}</Link>
        <span className="kb-tagline kb-muted kb-small">{ui.copy.siteTagline}</span>
        <button type="button" className="kb-button kb-menu-button" aria-expanded={open} aria-controls={navId} onClick={() => setOpen((o) => !o)}>
          Boards
        </button>
      </header>
      <nav id={navId} className="kb-nav" aria-label="Main" data-kb-open={open || undefined}>
        <ul>
          {links.map((l) => (
            <li key={l.to}><Link to={l.to} onClick={() => setOpen(false)}>{l.label}</Link></li>
          ))}
        </ul>
      </nav>
      <main ref={main} className="kb-page" tabIndex={-1}>{children}</main>
      <Hud />
    </div>
  );
}
