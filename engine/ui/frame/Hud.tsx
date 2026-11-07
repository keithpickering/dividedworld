/**
 * The Game HUD, docked at the bottom of every board page, in the glass (the web plan's glass
 * amendment to Task 3; the glass plan, sections 5, 7 and 8). Three groups: the character plate
 * (the avatar, which opens My characters; the name; the class tag only its player sees; the swap),
 * the aura (the orbs, which open My log, and the clock to the next settlement), and Menu beside the
 * hand. Its top edge is a tab over the aura, cut by the shapes' HUD tab polygon from four points
 * the aura's own position sets (`--tab-a` to `--tab-d`), with the seam drawn along the same points.
 * The hand's sheet is a region of its own, beside the HUD and drawn above it (the Phone board).
 * Menu shows its key cap, ESC, for the eye and hides it from the accessibility tree, so the button's
 * name is its word alone, Menu, taken from its content and not set over it; the key is
 * aria-keyshortcuts'.
 *
 * It is the player's alone: what it shows is their own rows, and changing the character sends
 * nothing anywhere (player.tsx). Menu and Esc anywhere on the board open the glass at My characters;
 * an Esc another control handled, or one typed in a text field, is that control's, and a held Esc's
 * repeats and the Esc that ends an IME composition open nothing (engine/ui/glass/keys.ts). While the
 * hand is open, Esc closes the hand. No control here keeps the board's place for Back: the router's
 * move from a board route into the glass does (keepBoardPlace, engine/ui/glass/back.ts), so every
 * way into the glass keeps it, these and any link elsewhere on the page alike. A modified or middle
 * click on the avatar or the orbs opens its page as the browser would and leaves this one alone.
 * Menu navigates rather than opening a menu, so it claims no popup.
 *
 * Alerts (the alerts plan, Task 10; the alerts design, section 8) is a link to the Alerts page with a bell and a gold count of what is new
 * (`alertsUnread`: 1 to 9, "9+" at the bound, nothing at none), above Hand beside the clock on the Main board's layout and a bell between "Posting
 * as" and Menu on the Phone board's. The count is read on each page and on each alert that arrives; what arrives live also toasts above the seam
 * (engine/ui/alerts/Toasts.tsx), which wait while the hand is open. On the Phone board Menu shortens to its glyph, its word kept for a screen
 * reader, when the row would cut the mask's name.
 *
 * The hand opens as a region and takes focus, so a keyboard is in it at once; its Close the hand
 * button, or Esc, closes it and returns focus to the hand. What it holds is the cards' (engine/ui/cards/Hand.tsx):
 * a sheet above the bar on the Phone board's layout, and on the Main board's the cards themselves,
 * fanned through the seam over the hand button. It is not a modal: the HUD stays live under it, as
 * the boards draw it, since the hand is how a card is picked to play on the board behind.
 *
 * The swap is named "Swap mask" on the Main board's layout and "Posting as" on the Phone board's.
 * Which layout it is comes from useBoard (engine/ui/glass/useBoard.ts): the Main board's from the
 * width worked out from the instance's sizes (engine/ui/glass/board.ts), drawn
 * at the window's scale below 1440px, and the Phone board's below that width. The glass pages
 * switch at the same width.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { Character } from '../data/api.ts';
import { useKayfa } from '../context.tsx';
import { playIn, playOut, type Stop } from '../glass/play.ts';
import { overlay as overlayPreset, useFeel } from '../glass/motion.ts';
import { usePlayer } from '../player.tsx';
import { registerHref, signInHref } from '../account/next.ts';
import { isLeaving } from '../glass/Held.tsx';
import { publishHudTab } from './hud-tab.ts';
import { dayAndTime } from '../characters/format.ts';
import { useBoot } from '../boot.tsx';
import { Link, searchOf, useLocation, useNavigate, useRouterInternals } from '../router.tsx';
import { Hand } from '../cards/Hand.tsx';
import { facesOf, withCardEconomy } from '../cards/faces.ts';
import { usePlay } from '../cards/play.tsx';
import { Orbs } from '../orbs/Orbs.tsx';
import { cascade, CASCADE_BEAT_MS, orbFills } from '../orbs/fill.ts';
import { motionReduced, useTextSize } from '../appearance.ts';
import { ALERTS_UNREAD_BOUND } from '../data/api.ts';
import { Toasts } from '../alerts/Toasts.tsx';
import { useAlertFeed } from '../alerts/useAlertFeed.ts';
import { HUD_CLASS } from '../glass/place.ts';
import { Smoke, useSurfaceStyle } from '../glass/Smoke.tsx';
import { pageEscape } from '../glass/keys.ts';
import { GLASS_NAV } from '../glass/nav.ts';
import { useBoard } from '../glass/useBoard.ts';
import { useTour } from '../tips/tour.ts';
import { useTip, useTipsStore } from '../tips/Tips.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';

/** The tab's slopes: 28px across, 24px tall, its top 20px wider than the aura each side, as the Main board draws them. */
const SLOPE = 28;
const TAB = 24;
const TAB_OUT = 20;
/** The room the mask picker's arrow takes beside the name, in the phone's px. */
const PICKER_ARROW = 28;
/** The room the picker's own chevron takes at the name's right, in the phone's px (the name is drawn by the HUD, and stops short of it). */
const PICKER_CHEVRON = 16;

/** The count as the HUD says it: nothing at none, the number to 9, "9+" at the bound. */
export const unreadText = (n: number | null): string | null => (n === null || n <= 0 ? null : n >= ALERTS_UNREAD_BOUND ? `${ALERTS_UNREAD_BOUND - 1}+` : String(n));

export function Hud() {
  const { api, instance, settings, ui } = useKayfa();
  const player = usePlayer();
  const location = useLocation();
  const navigate = useNavigate();
  const { board, scale } = useBoard();
  const wide = board === 'main';
  const [readFace, setFace] = useState<Character | null>(null);
  const [readNext, setNext] = useState<string | null>(null);
  const [tab, setTab] = useState<readonly [number, number, number, number] | null>(null);
  const handButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const aura = useRef<HTMLDivElement>(null);
  const plate = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLSelectElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const wordProbe = useRef<HTMLSpanElement>(null);
  /* How much of the phone's name size the picker's name keeps so its widest word fits its room, from 0 to 1 (frame.css floors the size, then wraps inside a word). */
  const [fit, setFit] = useState(1);
  /* On the Phone board: Menu is its glyph, because the row would cut the mask's name with the word; and Menu's width with the word, kept for judging that. */
  const [compact, setCompact] = useState(false);
  const menuWide = useRef(0);
  const drawerId = useId();
  /* Priced as the server prices them now (withCardEconomy). */
  const faces = useMemo(() => facesOf(instance.cards, ui.cards, withCardEconomy(instance.settings, settings.cardEconomy)), [instance, ui.cards, settings.cardEconomy]);
  const selectId = useId();
  /* Each of the two surfaces here draws its own recipe's calm under its text (useSurfaceStyle, engine/ui/glass/Smoke.tsx). */
  const hudCalm = useSurfaceStyle('hud');
  const handCalm = useSurfaceStyle('hand');
  const hud = player.hudCharacter;
  /* Hidden from the online lists (My characters' switch): a tag in plain words, beside the class on the Main board and the mask on the phone. */
  const hiddenMark = hud?.presenceHidden ? (
    <span className="kb-hud-hidden kb-glass-skew-tag">
      <span aria-hidden="true">Hidden</span>
      <span className="kb-visually-hidden">hidden from online lists</span>
    </span>
  ) : null;
  /* Whether the hand is open and which card is armed are the Frame's (cards/play.tsx): a post's own buttons read them too. */
  const play = usePlay();
  if (!play) throw new Error('the HUD is drawn inside the Frame');
  const { handOpen, setHandOpen, armed } = play;
  const signedIn = player.session.signedIn;
  const boot = useBoot();
  /* The count comes from the shown page's document when its route loads one, else from boot, then from a read on each move (useAlertFeed). */
  const { shown } = useRouterInternals();
  const loader = shown.route?.load !== undefined;
  const docUnread = loader && shown.ready ? (shown.doc as { readonly unread?: unknown } | null | undefined)?.unread : undefined;
  const feed = useAlertFeed(api, player.session.account, location.path, { boot: boot?.unread ?? null, loader, doc: typeof docUnread === 'number' ? docUnread : null });
  const unread = unreadText(feed.unread);

  /* The welcome is read once by the TipsProvider; the HUD tour's gate is the HUD's acting character (debuted, not retired), narrower than "the account has a character" because the plate and the hand need it. */
  const tips = useTipsStore();
  const welcomed = useSyncExternalStore(tips.subscribe, tips.welcomed, tips.welcomed);
  useTour({ plate, orbs: aura, hand: handButton }, signedIn && player.loaded && hud !== null && welcomed);
  /* The ghost tip: the first time the orbs show an estimate (a pending amount), pointing at the orbs' box (the legend that says Ghost is
     in it). Unlike the tour, it is deliberately not gated on the welcome: the plan says the first estimate. */
  useTip('ghost', aura, { when: signedIn && player.wallet !== null && player.pending !== 0 });

  const hudId = hud?.id ?? null;
  /* Boot's faces are in the first render; a mask boot does not hold (made after it) is read, and a later page asks again. */
  const bootFace = hudId && boot ? boot.faces.find((f) => f.id === hudId) ?? null : null;
  const face = bootFace ?? readFace;
  useEffect(() => {
    let live = true;
    setFace(null);
    if (!hudId || bootFace) return;
    /* No face is the initial in the slot; a later page asks again. */
    void api.characters([hudId]).then((cs) => { if (live) setFace(cs[0] ?? null); }, () => {});
    return () => { live = false; };
  }, [api, hudId, bootFace]);

  const booted = boot !== null;
  const next = booted ? boot.nextSettlementAt : readNext;
  useEffect(() => {
    let live = true;
    setNext(null);
    if (!signedIn || booted) return;
    void api.nextSettlementAt().then((at) => { if (live) setNext(at); }, () => {});
    return () => { live = false; };
  }, [api, signedIn, booted]);

  /* Once the cascade has played (or at once, under reduced motion), this device has seen the new wallet. */
  const { walletSeen, markWalletSeen } = player;
  const balance = player.wallet?.balance ?? null;
  const cap = player.wallet?.cap ?? null;
  useEffect(() => {
    if (walletSeen === null || balance === null || cap === null) return;
    const steps = cascade(walletSeen, balance, cap);
    const t = setTimeout(markWalletSeen, motionReduced() ? 0 : steps.length * CASCADE_BEAT_MS + 600);
    return () => clearTimeout(t);
  }, [balance, cap, walletSeen, markWalletSeen]);

  /*
   * What sits above the HUD (the hand's sheet, the new-posts bar) and the page's foot need the HUD's
   * real height, as the window draws it: on the Phone board's layout its rows grow with what they
   * hold, and on the Main board's it is scaled with the window. The tab's four points follow the
   * aura's own box, so the tab sits over the orbs at every width.
   *
   * The HUD is drawn at the board's scale (`zoom`, frame.css), and a box measured here is the
   * window's, so the height is set as it stands, for what sits outside the HUD, and the tab's points
   * are divided by the HUD's zoom, since they are set on the HUD and drawn at it.
   *
   * Watching the section and the bar's three groups is enough: the HUD's height changes only with
   * the section's box, and the aura moves only when the section's width or the size of a group
   * beside it changes (a longer name in the plate, the hand's count) or it changes size itself.
   * Each of those resizes something watched here, so no move of the tab goes unmeasured. A change of
   * scale alone resizes nothing in the HUD's own lengths, so it measures again on its own.
   */
  useEffect(() => {
    const el = section.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const measure = () => {
      const s = el.getBoundingClientRect();
      root.style.setProperty('--kb-hud-measured', `${Math.ceil(s.height)}px`);
      const a = aura.current?.getBoundingClientRect();
      /* A browser that draws zoom but has no currentCSSZoom (older Safari) draws it at the board's scale. */
      const zoom = el.currentCSSZoom ?? scale;
      if (a && a.width > 0) {
        const left = Math.round((a.left - s.left) / zoom) - TAB_OUT;
        const right = Math.round((a.left - s.left + a.width) / zoom) + TAB_OUT;
        setTab((t) => (t && t[1] === left && t[2] === right ? t : [left - SLOPE, left, right, right + SLOPE]));
      }
      /* Where the bar starts in the glass, so the bar can cut what it draws to the tab's shape (frame.css). */
      const bar = el.querySelector('.kb-hud-bar')?.getBoundingClientRect();
      if (bar) el.style.setProperty('--kb-hud-bar-shift', `${Math.round((bar.left - s.left) / zoom)}px`);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    for (const group of el.querySelectorAll('.kb-hud-bar > *')) watch.observe(group);
    return () => { watch.disconnect(); root.style.removeProperty('--kb-hud-measured'); };
  }, [signedIn, board, scale]);

  /* The tab's box on the window, for the crossing to open from and close back into (hud-tab.ts); read when the crossing starts, so it is never stale. */
  useEffect(() => publishHudTab(() => {
    const a = aura.current?.getBoundingClientRect() ?? section.current?.getBoundingClientRect();
    return a && a.width > 0 ? { x: a.left, y: a.top, width: a.width, height: a.height } : null;
  }), []);

  /*
   * Menu is its word unless the word would cut the mask's name. The name is measured as the picker draws it (a hidden copy of it, in the picker's
   * face), against the picker's room as it would be with Menu's word: the room now, less what shortening gave it. Judged that way the answer does
   * not flip back and forth as the picker grows when Menu shortens. It is judged again whenever the bar, the name or the picker changes size.
   */
  const hudName = hud?.name ?? null;
  const shortened = useRef(false);
  shortened.current = compact;
  /* A change of text size changes the word's width and every other: what was kept of the word's width is let go, Menu is drawn with its word, and judged again. */
  const size = useTextSize();
  const sizeJudged = useRef(size);
  const [redraw, setRedraw] = useState(0);
  useEffect(() => {
    if (sizeJudged.current !== size) {
      sizeJudged.current = size;
      if (shortened.current) { shortened.current = false; setCompact(false); setRedraw((n) => n + 1); return undefined; }
    }
    const bar = section.current;
    const choose = picker.current;
    const word = probe.current;
    const widest = wordProbe.current;
    const menu = menuButton.current;
    if (wide || !bar || !choose || !word || !widest || !menu || typeof ResizeObserver === 'undefined') { setCompact(false); setFit(1); return undefined; }
    const judge = () => {
      const menuNow = menu.getBoundingClientRect().width;
      if (!shortened.current) menuWide.current = menuNow;
      /* Shortened, the picker has grown by what Menu gave back; with the word it would be that much narrower. */
      const room = choose.getBoundingClientRect().width - (shortened.current ? Math.max(0, menuWide.current - menuNow) : 0);
      const cut = word.getBoundingClientRect().width + PICKER_ARROW > room;
      shortened.current = cut;
      setCompact(cut);
      /* The name is drawn over the picker (frame.css) and wraps at its spaces, so what must fit is its widest word: the size it keeps is what the room allows. */
      const wordWidth = widest.getBoundingClientRect().width;
      const roomNow = choose.getBoundingClientRect().width - PICKER_CHEVRON;
      setFit(wordWidth > 0 && roomNow > 0 ? Math.min(1, roomNow / wordWidth) : 1);
    };
    judge();
    const watch = new ResizeObserver(judge);
    for (const el of [bar, choose, word, widest]) watch.observe(el);
    return () => watch.disconnect();
  }, [wide, hudName, board, scale, size, redraw]);

  /* The opened hand takes focus, so the keyboard is in it at once. */
  useEffect(() => { if (handOpen) drawer.current?.focus(); }, [handOpen]);

  /*
   * The hand drawer opens from the hand button and its close plays out (glass/play.ts, motion.ts `overlay`). It stays on the page, so on a close it is
   * kept shown, inert and hidden from a reader, until its exit ends. Under Off it is hidden at once, as it was.
   */
  const feel = useFeel(ui.glass.motion);
  const [drawerLeaving, setDrawerLeaving] = useState(false);
  /* Marked in the render that closes it (state set while rendering is re-rendered before it commits), so no commit ever hides the drawer that is about to play out, and it is measured where it stands. */
  const [shownOpen, setShownOpen] = useState(handOpen);
  if (shownOpen !== handOpen) {
    setShownOpen(handOpen);
    setDrawerLeaving(!handOpen && feel !== null);
  }
  const drawerWas = useRef(handOpen);
  /* The drawer's running play: the next run, and the unmount, stop it, so a superseded exit never clears the entrance that replaced it. */
  const drawerRun = useRef<Stop | null>(null);
  useLayoutEffect(() => () => { drawerRun.current?.(); drawerRun.current = null; }, []);
  useLayoutEffect(() => {
    if (drawerWas.current === handOpen) return;
    drawerWas.current = handOpen;
    drawerRun.current?.();
    drawerRun.current = null;
    const el = drawer.current;
    if (!el || !feel) { setDrawerLeaving(false); return; }
    const a = handButton.current?.getBoundingClientRect();
    const place = () => {
      const b = el.getBoundingClientRect();
      return a && b.width > 0 ? { x: a.left + a.width / 2 - b.left, y: a.top + a.height / 2 - b.top } : undefined;
    };
    if (handOpen) { setDrawerLeaving(false); drawerRun.current = playIn(el, overlayPreset(feel, place())); return; }
    let over = false;
    const end = () => { if (!over) { over = true; setDrawerLeaving(false); } };
    drawerRun.current = playOut(el, overlayPreset(feel, place()), end);
  }, [handOpen, feel]);

  /* Esc on the board: the hand's when it is open, else the menu's. */
  useEffect(() => {
    if (!signedIn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat || e.isComposing) return;
      /* A frame that is leaving (the crossing holds it, inert, under the glass) takes no key: input is the arriving page's from the first frame. */
      if (isLeaving(section.current)) return;
      /* An armed card is put back first, and the hand, if it is open, stays; the next Esc is the hand's. */
      if (armed !== null) {
        e.preventDefault();
        play.arm(null);
        return;
      }
      if (handOpen) {
        e.preventDefault();
        setHandOpen(false);
        handButton.current?.focus();
        return;
      }
      if (!pageEscape(e)) return;
      e.preventDefault();
      navigate(GLASS_NAV.characters);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [signedIn, handOpen, armed, play, setHandOpen, navigate]);

  /* A card in the hand is armed, or put back if it was the armed one; a post then offers it (cards/PlayActions.tsx). */
  const pick = (face: { readonly key: string }) => {
    play.arm(armed === face.key ? null : face.key);
    /* The Phone board's sheet covers the foot of the page, where the posts to pick are: it is put away, and the armed card waits in the hand. */
    if (!wide) {
      setHandOpen(false);
      /* The sheet held the keyboard's place and is hidden now: it goes to the hand button, which is the armed card's words. */
      handButton.current?.focus();
    }
  };

  const held = player.cards.reduce((n, c) => n + c.held, 0);
  /*
   * On the Phone board's layout an armed card is the hand button's words, and one press puts it back
   * (the owner's answer on #80): the sheet is put away once a card is armed, so the HUD is where the
   * player is told, and where the way out is. The name holds the visible words first (WCAG 2.5.3).
   * The Main board keeps the fan open with the armed card and its tag, and Esc.
   */
  const armedName = !wide && armed !== null ? instance.cards.find((c) => c.key === armed)?.name ?? armed : null;
  const handName = armedName !== null ? `Armed · ${armedName}, press to put it back` : `Hand, ${held} ${held === 1 ? 'postcard' : 'postcards'}${handOpen ? ', open' : ''}`;
  const className = hud ? instance.classes.find((c) => c.key === hud.class)?.name ?? hud.class : null;
  const tabVars = tab ? { '--tab-a': `${tab[0]}px`, '--tab-b': `${tab[1]}px`, '--tab-c': `${tab[2]}px`, '--tab-d': `${tab[3]}px` } as CSSProperties : undefined;
  const seam = tab ? `0,${TAB + 6} ${tab[0]},${TAB + 6} ${tab[1]},6 ${tab[2]},6 ${tab[3]},${TAB + 6} 10000,${TAB + 6}` : `0,${TAB + 6} 10000,${TAB + 6}`;

  return (
    <>
      {signedIn && (
        <div ref={drawer} id={drawerId} className="kb-glass kb-hand-drawer" role="region" aria-label="Your hand" tabIndex={-1} hidden={!handOpen && !drawerLeaving} {...(drawerLeaving && !handOpen ? { inert: true, 'aria-hidden': true, 'data-kb-exiting': '' } : {})} style={handCalm}>
          <Smoke surface="hand">
            <Hand
              held={player.cards} faces={faces} vendingHref={GLASS_NAV.vending}
              armed={armed}
              onPick={hud ? pick : undefined}
              onClose={() => { setHandOpen(false); handButton.current?.focus(); }}
            />
          </Smoke>
        </div>
      )}
      <section ref={section} className={HUD_CLASS} aria-label="Game HUD" style={tabVars}>
        <div className="kb-glass kb-hud-glass" style={hudCalm}>
          <Smoke surface="hud" holder="kb-hud-ground kb-glass-hud-tab">
            <svg className="kb-hud-seam" aria-hidden="true" focusable="false" preserveAspectRatio="none">
              <polyline className="kb-glass-seam-glow" points={seam} />
              <polyline className="kb-glass-seam-core" points={seam} />
            </svg>
            <div className="kb-hud-bar">
              <CalmRegion calm={wide} ref={plate} className={`kb-hud-plate${!signedIn ? ' kb-hud-plate--door' : ''}${!signedIn || (player.loaded && hud) ? ' kb-hud-plate--cast' : ''}`}>
                <div className="kb-hud-plate-in">
                  {!signedIn ? (
                    <CalmRegion calm={!wide} className="kb-hud-door">
                      <span className="kb-hud-door-mark" aria-hidden="true">?</span>
                      <div className="kb-hud-door-words">
                        {/* A heading, not a bare element: the HUD is a labeled region, and its prompt is what a screen reader should find in it; it sits under the page's h1 in rank, though the HUD comes first in the document. */}
                        <h2 className="kb-hud-door-title kb-glass-display">{ui.frontDoor.prompt.title}</h2>
                        <p className="kb-hud-door-line">{ui.frontDoor.prompt.line}</p>
                      </div>
                    </CalmRegion>
                  ) : !player.loaded ? null : !hud ? (
                    <Link to="/characters/new" className="kb-hud-make kb-glass-cut-button">Make a character</Link>
                  ) : (
                    <>
                      <Link
                        to={GLASS_NAV.characters}
                        className="kb-hud-avatar"
                        aria-label="My characters"
                      >
                        {face?.avatarSquare ? <img src={face.avatarSquare} alt="" /> : <span className="kb-hud-avatar-none" aria-hidden="true">{hud.name.slice(0, 1)}</span>}
                      </Link>
                      <span className="kb-hud-who">
                        <span className="kb-hud-name kb-glass-display" style={{ '--kb-name-chars': hud.name.length } as CSSProperties}>{hud.name}</span>
                        <span className="kb-hud-class-line">
                          <span className="kb-hud-class kb-glass-skew-tag" style={{ '--kb-hud-class-fill': `var(--kb-glass-class-${hud.class}-fill)`, '--kb-hud-class-ink': `var(--kb-glass-class-${hud.class}-ink)` } as CSSProperties}>
                            {className}
                          </span>
                          <span className="kb-hud-secret">
                            <svg aria-hidden="true" focusable="false" width="15" height="16" viewBox="0 0 11 12"><rect x="1" y="5" width="9" height="6.5" rx="1" /><path d="M3 5 V3.4 a2.5 2.5 0 0 1 5 0 V5" /></svg>
                            Only you see this
                          </span>
                          {wide && hiddenMark}
                        </span>
                      </span>
                      <CalmRegion as="span" calm={!wide} className="kb-hud-swap">
                        <label htmlFor={selectId} className="kb-hud-swap-label">{wide ? 'Swap mask' : 'Posting as'}</label>
                        {/* The phone's HUD has no name line: the mark stands by the mask it names. */}
                        {!wide && hiddenMark}
                        {!wide && <span ref={probe} className="kb-hud-name-probe" aria-hidden="true">{hud.name}</span>}
                        {!wide && <span ref={wordProbe} className="kb-hud-name-probe kb-hud-name-probe--word" aria-hidden="true">{hud.name}</span>}
                        <span className="kb-hud-pick" style={{ '--kb-hud-chevron': `${PICKER_CHEVRON}px` } as CSSProperties}>
                          <select ref={picker} id={selectId} className="kb-hud-select" value={hud.id} onChange={(e) => player.setHudCharacter(e.target.value)}>
                            {player.actingCharacters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                          {/* The phone's picker shows the name here, over its own text (which is clear): a native picker clips the name to its box, this wraps it and sizes it to fit. */}
                          {!wide && <span className="kb-hud-picked" aria-hidden="true" style={{ '--kb-hud-pick-fit': fit } as CSSProperties}>{hud.name}</span>}
                          {!wide && <svg className="kb-hud-chevron" aria-hidden="true" focusable="false" width="14" height="10" viewBox="0 0 14 10"><path d="M1 2l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>}
                        </span>
                      </CalmRegion>
                    </>
                  )}
                </div>
              </CalmRegion>
              {signedIn && (
                <CalmRegion ref={aura} className="kb-hud-aura">
                  <p className="kb-hud-aura-legend"><span>Aura</span><span className="kb-hud-aura-ghost">Ghost = estimate until settlement</span></p>
                  {player.wallet && (
                    <Link
                      to={GLASS_NAV.log}
                      className="kb-hud-orbs"
                    >
                      <span className="kb-visually-hidden">My log: </span>
                      <Orbs settled={player.wallet.balance} pending={player.pending} cap={player.wallet.cap ?? settings.walletCap} cascadeFrom={player.walletSeen} />
                    </Link>
                  )}
                </CalmRegion>
              )}
              {/* Signed out, the Aura notch is the signed-in one's with its sockets empty, so the door previews the game it opens onto. */}
              {!signedIn && (
                <CalmRegion ref={aura} className="kb-hud-aura kb-hud-aura--empty">
                  <p className="kb-hud-aura-legend"><span>Aura</span></p>
                  <span className="kb-hud-sockets" aria-hidden="true">
                    {Array.from({ length: orbFills(0, 0, settings.walletCap).orbs.length }, (_, i) => <span key={i} className="kb-hud-socket" />)}
                  </span>
                  <p className="kb-hud-aura-line">No mask, no Aura, no hand yet. Your first character fills them.</p>
                </CalmRegion>
              )}
              {!signedIn && (
                <CalmRegion className="kb-hud-door-actions">
                  {/* Tab order is the drawn order: Sign in then Register across the Main board's row, Register (full width) then Sign in on the Phone board's sheet. */}
                  <ButtonRow align="end">
                    {(() => {
                      const signInButton = <GlassButton key="in" to={signInHref(location.path, searchOf(location.query))} kind={settings.registrationMode === 'closed' ? 'primary' : 'secondary'} className="kb-hud-door-in">Sign in</GlassButton>;
                      if (settings.registrationMode === 'closed') return signInButton;
                      const registerButton = (
                        <GlassButton key="join" to={registerHref(location.path, searchOf(location.query))} kind="primary" className="kb-hud-door-join">
                          {settings.registrationMode === 'invite' ? 'Register with an invite' : 'Register'}
                        </GlassButton>
                      );
                      return wide ? [signInButton, registerButton] : [registerButton, signInButton];
                    })()}
                  </ButtonRow>
                  {settings.registrationMode === 'invite' && <p className="kb-hud-door-note">No invite? Ask someone who plays.</p>}
                  {settings.registrationMode === 'closed' && <p className="kb-hud-door-note">Registration is closed for now.</p>}
                </CalmRegion>
              )}
              {signedIn && (
                <div className="kb-hud-side">
                  <CalmRegion as="p" className="kb-hud-clock">
                    <span className="kb-hud-clock-label">Next settlement</span>
                    {next ? <time className="kb-hud-clock-time kb-num" dateTime={next}>{dayAndTime(next)}</time> : <span className="kb-hud-clock-time">not yet set</span>}
                  </CalmRegion>
                  <Link
                    to={GLASS_NAV.alerts}
                    className="kb-hud-alerts kb-glass-skew"
                    data-kb-held={handOpen ? '' : undefined}
                    aria-label={unread === null ? 'Alerts' : `Alerts ${unread} new`}
                  >
                    <svg className="kb-hud-bell kb-glass-upright" aria-hidden="true" focusable="false" width="22" height="24" viewBox="0 0 22 24">
                      <path d="M11 2.5c-3.6 0-6.2 2.8-6.2 6.4v4.6L2.5 17.6h17l-2.3-4.1V8.9c0-3.6-2.6-6.4-6.2-6.4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      <path d="M8.2 20.2a2.9 2.9 0 0 0 5.6 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <span className="kb-hud-alerts-word kb-glass-upright">Alerts</span>
                    {' '}
                    {unread !== null && <span className="kb-hud-alerts-count kb-glass-upright kb-num" aria-hidden="true">{unread}</span>}
                  </Link>
                  <div className="kb-hud-actions">
                    <button
                      ref={menuButton}
                      type="button"
                      className="kb-hud-menu kb-glass-skew"
                      aria-keyshortcuts="Escape"
                      onClick={() => navigate(GLASS_NAV.characters)}
                    >
                      <kbd className="kb-hud-key kb-glass-upright" aria-hidden="true">ESC</kbd>
                      <span className={compact ? 'kb-visually-hidden' : 'kb-glass-upright'}>Menu</span>
                      {compact && (
                        <svg className="kb-hud-menu-glyph kb-glass-upright" aria-hidden="true" focusable="false" width="22" height="18" viewBox="0 0 22 18">
                          <path d="M2 3h18M2 9h18M2 15h18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                    <button
                      ref={handButton}
                      type="button"
                      className="kb-hud-hand kb-glass-skew"
                      {...(armedName === null ? { 'aria-expanded': handOpen, 'aria-controls': drawerId } : {})}
                      aria-label={handName}
                      data-kb-armed={armedName !== null ? 'true' : undefined}
                      onClick={() => (armedName !== null ? play.arm(null) : setHandOpen(!handOpen))}
                    >
                      {armedName !== null
                        ? <span className="kb-hud-hand-armed kb-glass-upright">Armed · {armedName}</span>
                        : <><span className="kb-glass-upright">Hand</span> <span className="kb-hud-hand-count kb-glass-upright kb-num">{held}</span></>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Smoke>
        </div>
      </section>
      {signedIn && (
        <Toasts
          key={player.session.account ?? ''}
          arrivals={feed.arrivals}
          hold={handOpen}
          returnFocus={() => section.current?.querySelector<HTMLElement>('.kb-hud-alerts')?.focus()}
        />
      )}
    </>
  );
}
