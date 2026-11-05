/**
 * The Strategy Guide at /guide (the onboarding design, sections 8 and 10; the plan's Task 8; boards
 * docs/research/2026-11-02-onboarding/02-guide.html and 04-phone.html): a glass page in the instance's developer persona's voice, one long
 * article beside contents that stay in view and mark the section on screen in cyan. The article is the instance's Markdown
 * (`InstanceUi.guide`, read by markdown.ts), its markers filled from the live instance (markers.tsx) and its numbers from the live
 * settings, so it is true after every retune and the engine names no class, card or number. Each second-level heading is a section with
 * an anchor (`/guide#classes`), which a tip, an alert or another page can open the guide at. On a phone the contents fold into a menu.
 *
 * The persona's voice is allowed here and only because the guide is committed to the repository and approved by the owner in review
 * (CLAUDE.md, "The fiction may lie; the log never does"); it is out of character and says nothing untrue.
 *
 * Signed out the board is hidden, and so is the guide, as the Updates page is (the design's section 1): the sign-in prompt stands in its
 * place. It makes no request of its own but the session's.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { motionReduced } from '../appearance.ts';
import { useKayfa } from '../context.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { Link, useLocation } from '../router.tsx';
import { Classes, CardList, Letter, ReactionGrid } from './markers.tsx';
import { parse, sectionsOf, settingText, type MarkerName } from './markdown.ts';
import { Blocks, DASH, type Fill } from './render.tsx';
import './guide.css';

const possessive = (name: string) => (name.endsWith('s') ? `${name}'` : `${name}'s`);

export function Guide() {
  const { instance, ui, settings } = useKayfa();
  const location = useLocation();
  const { path, hash } = location;
  const sections = useMemo(() => sectionsOf(parse(ui.guide.markdown), (p) => settingText(p, settings) ?? DASH), [ui.guide.markdown, settings]);
  const first = sections[0]?.id ?? '';
  const [current, setCurrent] = useState(() => (sections.some((s) => s.id === hash) ? hash : first));
  const [open, setOpen] = useState(false);
  const els = useRef(new Map<string, HTMLElement>());
  const button = useRef<HTMLButtonElement>(null);
  const list = useId();

  const fill: Fill = {
    settings,
    path,
    marker: (name: string): ReactNode => {
      switch (name as MarkerName) {
        case 'letter': return <Letter fill={fill} />;
        case 'reactions': return <ReactionGrid />;
        case 'classes': return <Classes />;
        case 'cards': return <CardList />;
        default: return null;
      }
    },
  };

  /*
   * A fragment is the page's to scroll to (the glass page leaves it), and it is the section on screen from then. The page opens at it
   * at once, and again when the fonts are in, since a section's height above it changes with them and a glide begun before would end
   * in the wrong place; a link followed on the page glides, unless motion is reduced.
   */
  const arrived = useRef(false);
  useEffect(() => {
    const target = hash === '' ? undefined : els.current.get(hash);
    if (!target) return;
    const initial = !arrived.current;
    arrived.current = true;
    const go = (behavior: ScrollBehavior) => target.scrollIntoView?.({ block: 'start', behavior });
    setCurrent(hash);
    go(initial || motionReduced() ? 'auto' : 'smooth');
    if (initial) void document.fonts?.ready.then(() => { if (els.current.get(hash) === target) go('auto'); });
  }, [location]);

  /*
   * The section on screen is the first, in the article's order, of those in a band near the top of the window; with none in it the mark
   * stays where it was, so a long section never leaves the contents unmarked. Without an observer the mark follows the links only.
   */
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Set<string>();
    const order = sections.map((s) => s.id);
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = order.find((i) => els.current.get(i) === e.target);
        if (id === undefined) continue;
        if (e.isIntersecting) seen.add(id); else seen.delete(id);
      }
      const now = order.find((i) => seen.has(i));
      if (now !== undefined) setCurrent(now);
    }, { rootMargin: '-15% 0px -65% 0px' });
    for (const id of order) { const el = els.current.get(id); if (el) observer.observe(el); }
    return () => observer.disconnect();
  }, [sections]);

  /* Choosing a section from the open menu closes it, and the focus goes with the reader to the section's heading, not to the page. */
  const choose = (id: string) => {
    if (open) els.current.get(id)?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    setOpen(false);
  };

  const voice = instance.developer?.name;
  const here = sections.find((s) => s.id === current) ?? sections[0];

  return (
    <div className="kb-guide">
      <PageHead title="Strategy Guide" />
      <div className="kb-guide-cols">
        <aside className="kb-guide-side">
          <p className="kb-guide-lede kb-calm">
            How the game works, from the people who made it.
            {voice !== undefined && <> The voice is {possessive(voice)}; every fact in it is true, and every number is today&apos;s.</>}
          </p>
          <nav
            aria-label="Guide contents" className="kb-guide-contents" data-open={open || undefined}
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || !open) return;
              e.preventDefault();
              setOpen(false);
              button.current?.focus();
            }}
          >
            <button ref={button} type="button" className="kb-guide-menu-button" aria-expanded={open} aria-controls={list} onClick={() => setOpen(!open)}>
              <span>Contents{here ? ` · ${here.title}` : ''}</span>
              <svg aria-hidden="true" width="14" height="10" viewBox="0 0 14 10"><path d="M1 2l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            </button>
            <ul id={list} className="kb-guide-toc kb-calm">
              {sections.map((s) => (
                <li key={s.id}>
                  <Link to={`${path}#${s.id}`} aria-current={s.id === current ? 'location' : undefined} onClick={() => choose(s.id)}>{s.title}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <article className="kb-guide-article">
          {sections.map((s) => (
            <section
              key={s.id} id={s.id} className="kb-guide-section" aria-labelledby={`${s.id}-title`}
              ref={(el) => { if (el) els.current.set(s.id, el); else els.current.delete(s.id); }}
            >
              <h2 id={`${s.id}-title`} tabIndex={-1} className="kb-guide-section-title kb-glass-display">{s.title}</h2>
              <div className="kb-guide-prose"><Blocks blocks={s.blocks} fill={fill} /></div>
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

/** The guide at /guide. */
export function GuideScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  if (signedIn === false) return <div className="kb-guide"><div className="kb-guide-empty kb-calm"><SignInPrompt /></div></div>;
  if (signedIn === null) return <div className="kb-guide" aria-busy="true" />;
  return <Guide />;
}
