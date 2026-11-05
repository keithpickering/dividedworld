/**
 * The menu bar on every glass page (the web plan's glass amendment to Task 3; the glass plan,
 * section 7, boards 02 and 07): Back to the board first, with Esc as its key, then Alerts, Vending Machine, My
 * characters, Season, My log, Guide, Updates and Settings, the current one marked with aria-current. Signed out, the bar holds Back
 * alone, since every page on it needs an account. The arrow and the ESC key cap the boards draw on
 * Back are empty, hidden elements the stylesheet writes into (`data-kb-key`), so the link's name and
 * text are its words alone.
 *
 * An admin's bar has one more tab at the end, Admin, which opens the queue of The System's moves (engine/ui/admin/Queue.tsx); a player's
 * has none, and nothing about it is drawn or reserved for them.
 *
 * Esc anywhere on a glass page goes back, as the Back link does, unless something else has
 * answered it first (an overlay, which closes and leaves the page; a control that handled it), it
 * was typed into a text field, where Esc belongs to the field, or it is a held key's repeat or the
 * end of an IME composition (keys.ts). A modified or middle click on Back opens the board as the
 * browser would and leaves this page and its kept place alone. Where the bar's pages live is
 * GLASS_NAV's (nav.ts).
 *
 * On the Main board's layout the bar is the boards': 84px, its tabs skewed with their words set
 * upright, Back outlined in white with its ESC key cap before its words, the current tab lit. While
 * an overlay is open over the page the bar stays in view, dimmed and inert (Overlay.tsx).
 *
 * The bar is sticky: it stays at the top of the window while the page scrolls under it, on its own opaque ground, and the root's
 * scroll padding (shell.css) is its height, so a focused control is never scrolled under it.
 *
 * At the boards' width the tabs and Back are one row, never two: the tabs' padding and spacing step down as their count grows (the
 * boards: 13px and 1.5px past five, 10px and 1px past eight), and where they still do not fit the row scrolls sideways as the
 * phone's does, fading at the edge where more wait (`data-kb-fade`), the current tab scrolled into view.
 *
 * On a phone Back is on its own row and the pages are a strip under it that scrolls sideways, so
 * the current page's tab is scrolled into view as a page opens; with reduced motion it is there at
 * once. Back stays out of the strip, so no tab ever slides under it.
 */
import { useEffect, useRef, useState } from 'react';
import { motionReduced } from '../appearance.ts';
import { useKayfa } from '../context.tsx';
import { usePlayer } from '../player.tsx';
import { Link, useLocation } from '../router.tsx';
import { backHref, boardPlace, useBackToBoard } from './back.ts';
import { pageEscape, plainClick } from './keys.ts';
import { GLASS_NAV } from './nav.ts';
import './shell.css';

interface Tab { readonly label: string; readonly to: string; readonly current: (path: string) => boolean }

const TABS: readonly Tab[] = [
  { label: 'Alerts', to: GLASS_NAV.alerts, current: (p) => p === GLASS_NAV.alerts },
  { label: 'Vending Machine', to: GLASS_NAV.vending, current: (p) => p === GLASS_NAV.vending },
  { label: 'My characters', to: GLASS_NAV.characters, current: (p) => p === '/characters' || p.startsWith('/characters/') },
  { label: 'Season', to: GLASS_NAV.season, current: (p) => p === GLASS_NAV.season },
  { label: 'My log', to: GLASS_NAV.log, current: (p) => p === GLASS_NAV.log },
  { label: 'Guide', to: GLASS_NAV.guide, current: (p) => p === GLASS_NAV.guide },
  { label: 'Updates', to: GLASS_NAV.updates, current: (p) => p === GLASS_NAV.updates },
  { label: 'Settings', to: GLASS_NAV.settings, current: (p) => p === '/settings' || p === '/invites' },
];

/** The admin queue's tab, after the others, shown only to an admin (the server decides who is one; a refused or failed ask shows no tab). */
const ADMIN: Tab = { label: 'Admin', to: GLASS_NAV.admin, current: (p) => p === GLASS_NAV.admin || p.startsWith('/admin/') };

/** How crowded a bar of this many tabs is ('few' is an instance with five or fewer tabs), which the stylesheet steps the tabs' padding and spacing down on (the boards' `many` and `most`). */
function density(count: number): 'few' | 'many' | 'most' {
  return count > 8 ? 'most' : count > 5 ? 'many' : 'few';
}

export function MenuBar() {
  const { api } = useKayfa();
  const { session } = usePlayer();
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    setAdmin(false);
    if (!session.signedIn) return;
    let live = true;
    void api.isAdmin().then((a) => { if (live) setAdmin(a); }, () => { /* no tab */ });
    return () => { live = false; };
  }, [api, session.signedIn, session.account]);
  const { path } = useLocation();
  const back = useBackToBoard();
  const list = useRef<HTMLUListElement>(null);
  const shown = admin ? [...TABS, ADMIN] : TABS;
  const [fade, setFade] = useState<'none' | 'start' | 'end' | 'both'>('none');
  const bar = useRef<HTMLElement>(null);

  /* The bar stays at the top of the window while the page scrolls under it, so what the page scrolls to (a focused control, a link's target) stands clear of its foot. */
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--kb-glass-menu-height', `${Math.round(el.getBoundingClientRect().height)}px`);
    measure();
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    watch?.observe(el);
    return () => { watch?.disconnect(); root.style.removeProperty('--kb-glass-menu-height'); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageEscape(e)) return;
      e.preventDefault();
      back();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [back]);

  /*
   * The current tab is scrolled into view as the page opens, and again whenever the tab changes size while the page settles (the
   * display face loading, the text size taking hold): a position worked out against the first sizes is past the window's edge at
   * the last, at large text. The strip is left alone from the first touch, wheel or key the reader gives it.
   */
  useEffect(() => {
    const current = list.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!current) return;
    const show = (behavior: ScrollBehavior) => current.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior });
    show(motionReduced() ? 'auto' : 'smooth');
    const strip = list.current!;
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => show('auto')) : null;
    watch?.observe(current);
    watch?.observe(strip);
    const stop = () => watch?.disconnect();
    for (const e of ['pointerdown', 'wheel', 'keydown']) strip.addEventListener(e, stop, { once: true });
    return () => {
      stop();
      for (const e of ['pointerdown', 'wheel', 'keydown']) strip.removeEventListener(e, stop);
    };
  }, [path, session.signedIn, admin]);

  /* Where the tabs still do not fit, the row scrolls sideways and fades at the edge where more wait. */
  useEffect(() => {
    const strip = list.current;
    if (!strip) return;
    const measure = () => {
      const more = strip.scrollWidth - strip.clientWidth > 1;
      const before = more && strip.scrollLeft > 1;
      const after = more && strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setFade(before && after ? 'both' : before ? 'start' : after ? 'end' : 'none');
    };
    measure();
    let live = true;
    let frame: number | null = null;
    const soon = () => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; if (live) measure(); }); };
    strip.addEventListener('scroll', soon, { passive: true });
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
    watch?.observe(strip);
    /* The tabs widen as the display face loads while the strip's own width stays put. */
    for (const t of Array.from(strip.children)) watch?.observe(t);
    void document.fonts?.ready.then(() => { if (live) measure(); });
    return () => {
      live = false;
      if (frame !== null) cancelAnimationFrame(frame);
      strip.removeEventListener('scroll', soon);
      watch?.disconnect();
    };
  }, [session.signedIn, admin]);

  return (
    <nav ref={bar} className="kb-glass-menu" aria-label="Menu">
      <div className="kb-glass-menu-row">
        <Link
          to={backHref(boardPlace())}
          className="kb-glass-menu-back kb-glass-skew"
          aria-keyshortcuts="Escape"
          onClick={(e) => { if (!plainClick(e)) return; e.preventDefault(); back(); }}
        >
          <span className="kb-glass-upright">
            <span className="kb-glass-menu-arrow" aria-hidden="true" data-kb-key="‹" />
            <span className="kb-glass-menu-key" aria-hidden="true" data-kb-key="ESC" />
            Back to the board
          </span>
        </Link>
        {session.signedIn && (
          <ul ref={list} className="kb-glass-menu-list" data-kb-tabs={density(shown.length)} data-kb-fade={fade}>
            {shown.map((t) => (
              <li key={t.label}>
                <Link to={t.to} className="kb-glass-menu-tab kb-glass-skew" aria-current={t.current(path) ? 'page' : undefined}><span className="kb-glass-upright">{t.label}</span></Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </nav>
  );
}
