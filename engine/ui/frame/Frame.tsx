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
 *
 * The page ends in the footer (the credit and the instance's badges). The frame also holds what playing a card is (engine/ui/cards/play.tsx): which card is armed, whether the
 * hand is open and for which post, and the play form, so the HUD's hand and every post's own buttons read
 * one state. It also holds the page's one tip (engine/ui/tips/Tips.tsx), above the HUD and the page both so a spotlight can cut out either.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { signInHref } from '../account/next.ts';
import { useBoot } from '../boot.tsx';
import { useKayfa } from '../context.tsx';
import type { BoardSummary } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Icon, type IconName } from '../board/Icons.tsx';
import { Link, searchOf, useLocation, useNavigation } from '../router.tsx';
import { PlayProvider } from '../cards/play.tsx';
import { BannerSearch } from '../search/BannerSearch.tsx';
import { TipsProvider } from '../tips/Tips.tsx';
import { Hud } from './Hud.tsx';
import { Loading } from './Loading.tsx';
import './frame.css';

export function Frame({ children }: { readonly children: ReactNode }) {
  const { api, ui } = useKayfa();
  const { session } = usePlayer();
  const boot = useBoot();
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<readonly BoardSummary[]>([]);
  const navId = useId();
  const { pending } = useNavigation();
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
    /*
     * A screen that came with the move may have put focus where it means it (a spun thread's ORIGIN box). A screen's effects run before this
     * one, since the new page now commits with the new address; focus already inside the page is left where the screen put it.
     */
    const there = document.activeElement;
    if (there && there !== main.current && main.current?.contains(there)) return;
    main.current?.focus({ preventScroll: true });
  }, [path]);

  /*
   * The boards come from boot, which the first load read once for the frame and the HUD; a session that changed after boot (a sign-in on
   * this page) reads them itself until boot is read again. Signed out the banner holds Index and Sign in.
   */
  const booted = boot !== null;
  useEffect(() => {
    let live = true;
    setBoards([]);
    if (!session.signedIn || booted) return;
    void api.boards().then((b) => { if (live) setBoards(b); }, () => {});
    return () => { live = false; };
  }, [api, session.signedIn, booted]);
  const shownBoards = boot ? boot.boards : boards;

  const badges = ui.copy.badges ?? [];
  const here = searchOf(query);
  const links: readonly { readonly to: string; readonly label: string; readonly icon?: IconName }[] = [
    { to: '/', label: 'Index', icon: 'home' },
    ...shownBoards.map((b) => ({ to: `/b/${b.slug}`, label: b.name, icon: 'board' as const })),
    ...(session.signedIn ? [] : [{ to: signInHref(path, here), label: 'Sign in' }]),
  ];
  /*
   * Search (the search design, section 7, as amended by the owner): signed in, the banner's right side is a column, the host line with its
   * loading meter on top and the search box on a row of its own under it (section 7 had the box take the host line's place; the host line
   * now always shows). The boards bar ends in a Search link. On /search the page has its own keyword field, so the box is not drawn there.
   * Signed out there is neither (a visitor reads no thread).
   */
  const onSearch = path === '/search';
  const box = session.signedIn && !onSearch;

  return (
    <TipsProvider>
      <PlayProvider>
        <div className="kb-frame" data-kb-loading={pending ? true : undefined}>
          <header className="kb-banner">
            <Link to="/" className="kb-logo">{ui.copy.siteName}</Link>
            <div className="kb-banner-side">
              <div className="kb-banner-host">
                <span className="kb-tagline kb-muted kb-small">{ui.copy.siteTagline}</span>
                <Loading />
              </div>
              {box && <BannerSearch />}
            </div>
            <button type="button" className="kb-button kb-menu-button" aria-expanded={open} aria-controls={navId} onClick={() => setOpen((o) => !o)}>
              Boards
            </button>
          </header>
          <nav id={navId} className="kb-nav" aria-label="Main" data-kb-open={open || undefined}>
            <ul>
              {links.map((l) => (
                <li key={l.to}><Link to={l.to} onClick={() => setOpen(false)}>{l.icon && <Icon name={l.icon} />}{l.label}</Link></li>
              ))}
              {session.signedIn && (
                <li className="kb-nav-search">
                  <Link to="/search" aria-current={onSearch ? 'page' : undefined} onClick={() => setOpen(false)}>
                    <Icon name="search" />Search
                  </Link>
                </li>
              )}
            </ul>
          </nav>
          <main ref={main} className="kb-page" tabIndex={-1} aria-busy={pending ? true : undefined}>{children}</main>
          {/* The footer ends every board page: the credit and the instance's badges, which are decoration, and it links nothing. */}
          <footer className="kb-footer">
            Powered by KayfaBB
            {badges.length > 0 && (
              <div className="kb-badges" aria-hidden="true">
                {badges.map(([a, b]) => <span key={`${a} ${b}`} className="kb-badge"><span>{a}</span><span>{b}</span></span>)}
              </div>
            )}
          </footer>
          {/* The glass's violet laid toward the window's edges (frame.css); it is paint, so it is out of the reading order. */}
          <div className="kb-vignette" aria-hidden="true" />
          <Hud />
        </div>
      </PlayProvider>
    </TipsProvider>
  );
}
