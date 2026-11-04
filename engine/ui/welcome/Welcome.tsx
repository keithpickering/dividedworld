/**
 * The welcome page at /welcome (the onboarding design, sections 2, 10 and 11; the plan's Task 7; boards
 * docs/research/2026-11-02-onboarding/01-welcome.html and 04-phone.html): a glass page in the Updates page's frame. The instance's developer
 * persona's letter (`InstanceUi.onboarding.letter`, Markdown through the guide's renderer, so the letter is written once and the Strategy
 * Guide's first section reads the same words) stands on a post with the persona's picture, name and tagline; under it, Before you start
 * (theme, motion and text size: the rows Settings › Accessibility draws, saved as they change); then Make your first character, and a
 * quieter link to the Strategy Guide. A column beside says what happens next, plainly.
 *
 * It shows once. The page marks the welcome seen when it opens (`seeWelcome`), and `SendToWelcome` sends an account here only while it has
 * not been seen, so leaving by any way (the button, the guide, a menu tab, Back to the board) leaves it behind. The page is a glass page
 * with the menu bar, so the menu's Back to the board and every tab are ways out ("No player is ever stuck").
 *
 * The persona's voice is allowed here and only because the letter is committed to the repository and approved by the owner in review
 * (CLAUDE.md, "The fiction may lie; the log never does"); the side column and the rest are the glass's plain words, out of character and
 * true.
 *
 * Signed out the board is hidden, and so is this page: the sign-in prompt stands in its place.
 */
import { useEffect, useId, useMemo, useRef } from 'react';
import { DEFAULT_DEVELOPER } from '../../rules/instance.ts';
import { ThemeRow, MotionRow, TextSizeRow } from '../account/appearanceRows.tsx';
import { usePreferenceSaves } from '../account/preferences.ts';
import { useKayfa } from '../context.tsx';
import { Blocks, DASH, type Fill } from '../guide/render.tsx';
import { inlineText, parse, settingText } from '../guide/markdown.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { usePlayer } from '../player.tsx';
import { PersonaMark } from '../updates/Persona.tsx';
import './welcome.css';

export const WELCOME_PATH = '/welcome';

/** What happens next, in the glass's own words: out of character, plain and true of the game as it stands. */
const NEXT: readonly { readonly title: string; readonly line: string }[] = [
  { title: 'Your first character', line: 'A name, a class, and when it arrives on the board. Once it has arrived, it can post.' },
  { title: 'A short tour', line: 'On the board, three short notes point out your mask, your orbs and your hand. Skip all tips ends them.' },
  { title: 'Change anything later', line: 'These settings live in Settings › Accessibility, and this letter is the first section of the Strategy Guide.' },
];

export function Welcome() {
  const { api, instance, ui, settings } = useKayfa();
  const { session } = usePlayer();
  const { path } = useLocation();
  const { prefs, refusal, saved, change } = usePreferenceSaves(session.account);
  const setup = useId();
  const persona = instance.developer ?? DEFAULT_DEVELOPER;
  const picture = persona.avatar === undefined ? undefined : ui.avatars?.[persona.avatar];

  /* It shows once whatever the player does next: seen when it opens. A refusal changes nothing; the page is still a way on. */
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current) return;
    marked.current = true;
    void api.seeWelcome().catch(() => { /* the next board page decides again from the account */ });
  }, [api]);

  /* The letter's first heading is the post's headline; the rest is its prose. A marker has no place in a letter. */
  const letter = useMemo(() => {
    const blocks = parse(ui.onboarding.letter).filter((b) => b.t !== 'marker');
    const first = blocks[0];
    const say = (p: string) => settingText(p, settings) ?? DASH;
    return first?.t === 'heading' && first.level === 2
      ? { title: inlineText(first.children, say), rest: blocks.slice(1) }
      : { title: null, rest: blocks };
  }, [ui.onboarding.letter, settings]);
  const fill: Fill = { settings, path, marker: () => null };
  const headline = useId();

  return (
    <div className="kb-welcome">
      <h1 className="kb-welcome-title kb-glass-display">Welcome</h1>
      <div className="kb-welcome-cols">
        <article className="kb-welcome-post" aria-labelledby={letter.title === null ? undefined : headline}>
          <div className="kb-updates-by">
            <PersonaMark name={persona.name} picture={picture} />
            <div>
              <b className="kb-updates-name">{persona.name}</b>
              {persona.tagline !== '' && <span className="kb-updates-tagline">{persona.tagline}</span>}
            </div>
          </div>
          {letter.title !== null && <h2 id={headline} className="kb-welcome-headline kb-glass-display">{letter.title}</h2>}
          <div className="kb-welcome-prose"><Blocks blocks={letter.rest} fill={fill} demote={1} /></div>

          <section className="kb-welcome-setup kb-acct" aria-labelledby={setup}>
            <h3 id={setup} className="kb-welcome-setup-title kb-glass-display">Before you start</h3>
            <p className="kb-welcome-setup-lede">How the board and the glass look and move. None of it changes how the game plays.</p>
            {prefs === null ? (
              <div aria-busy={refusal === null || undefined}>{refusal && <p role="alert" className="kb-acct-refusal">{refusal}</p>}</div>
            ) : (
              <>
                <ThemeRow legend="Theme" level={4} value={prefs.theme} onChange={(v) => change({ theme: v })} />
                <MotionRow level={4} value={prefs.motion} onChange={(v) => change({ motion: v })} />
                <TextSizeRow level={4} value={prefs.textSize} onChange={(v) => change({ textSize: v })} />
                {refusal && <p role="alert" className="kb-acct-refusal">{refusal}</p>}
                <p role="status" className="kb-acct-note">{saved && !refusal ? 'Saved to your account.' : ''}</p>
              </>
            )}
          </section>

          <div className="kb-welcome-go">
            <Link to="/characters/new" className="kb-welcome-button kb-glass-skew"><b className="kb-glass-upright">Make your first character</b></Link>
            <Link to="/guide" className="kb-welcome-link">Read the Strategy Guide first</Link>
          </div>
        </article>
        <aside className="kb-welcome-side" aria-label="What happens next">
          <p className="kb-welcome-lede kb-calm" data-kb-calm="flush">You&apos;re in. One letter, three settings, then your first character.</p>
          <ul className="kb-welcome-next kb-calm">
            {NEXT.map((n) => <li key={n.title}><b>{n.title}</b>{n.line}</li>)}
          </ul>
        </aside>
      </div>
    </div>
  );
}

/** The welcome at /welcome. */
export function WelcomeScreen() {
  const { api } = useKayfa();
  const signedIn = useSignedIn(api);
  if (signedIn === false) return <div className="kb-welcome"><div className="kb-welcome-empty kb-calm"><SignInPrompt /></div></div>;
  if (signedIn === null) return <div className="kb-welcome" aria-busy="true" />;
  return <Welcome />;
}

/**
 * The session listener that sends a new account to the welcome: a signed-in account with no `welcomedAt` and no character at all (a
 * waiting or a retired one counts, so a player who has played is never sent), on a board page (`active`; the sign-in pages and the glass
 * pages are let through, and it waits for the first board page after them). It decides once for each account while it stays mounted, at the
 * first board page after the player's rows are read (and an answer that comes after the player has moved to a glass page sends nobody), so the
 * welcome shows once. A glass page unmounts it, so an account with no character asks again on its next board page; a player with one never asks.
 *
 * It reads nothing for an account that has a character, which is every player after the first. For one that has none it reads the
 * preferences and the roster once, at that first board page: the roster again because a roster that failed to load reads as empty in the
 * player's rows, and a failed read must not send a player who has characters. A read that fails sends nobody.
 */
export function SendToWelcome({ active }: { readonly active: boolean }) {
  const { api } = useKayfa();
  const { session, sessionKnown, loaded, characters } = usePlayer();
  const { path } = useLocation();
  const navigate = useNavigate();
  const account = session.account;
  /* The accounts this session has decided for, the one signed in now (an answer for another is dropped), and whether the player is still on a
   * board page (an answer that arrives after they opened Settings must not pull them away from it). */
  const decided = useRef<Set<string>>(new Set());
  const now = useRef<string | null>(null);
  const onBoard = useRef(active);
  /* A move from a board page to a glass page swaps the shell, so this listener is unmounted and a new one mounted: the old one's answer is dropped. */
  const mounted = useRef(false);
  now.current = account;
  onBoard.current = active;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!account || !sessionKnown) return;
    /* On the welcome itself it is seen (or is being); a Back to the board from it is not decided again. */
    if (path === WELCOME_PATH) { decided.current.add(account); return; }
    if (!active || !loaded || decided.current.has(account)) return;
    decided.current.add(account);
    if (characters.length > 0) return;
    void Promise.all([api.preferences(), api.myCharacters()]).then(([p, mine]) => {
      if (now.current === account && mounted.current && onBoard.current && p.welcomedAt === null && mine.length === 0) navigate(WELCOME_PATH, { replace: true });
    }, () => { /* nobody is sent on a read that failed */ });
  }, [api, account, sessionKnown, active, loaded, characters.length, path, navigate]);
  return null;
}
