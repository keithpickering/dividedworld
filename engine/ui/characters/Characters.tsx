/**
 * My characters: the player's own masks, out of character and plain, on the glass as the Roster
 * board draws it (docs/research/2026-10-29-two-worlds/10-roster.html): a card for each character in
 * the order they joined, then New character and the slots still open, and the selected one's panel
 * beside them. A card shows the character's class in its own color, its rank and its Turn; the
 * panel holds everything a character offers: its class marked "only you" and since when, what it
 * was where a Turn said so in public, its rank and standing and pips, the wallet, its posts and the
 * month it joined, its pip style (the profile's, saved as it is chosen), and its Turn: the button,
 * the date it opens, or a pending Turn with Change and Withdraw. A character waiting to debut says
 * so, and offers to drop it now or change how it debuts.
 *
 * Nothing here is public: a waiting character is in no list anyone else reads, and every class is
 * drawn from the player's own rows to the player alone ("A response never proves a private fact").
 * Which card is selected is the page's own: it opens on the character a navigation carried in
 * history.state (New character's, the profile editor's), else on the HUD's, and no address names it.
 */
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useEffect, useId, useMemo, useState, type ComponentProps } from 'react';
import { rankIndex } from '../../rules/ranks.ts';
import { useKayfa } from '../context.tsx';
import type { Character, Id, MyCharacter, MyCharactersPage } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Carousel, carouselPanelId, carouselTabId } from '../glass/Carousel.tsx';
import { Leaving } from '../glass/Held.tsx';
import { swap, useFeel } from '../glass/motion.ts';
import { PageHead } from '../glass/PageHead.tsx';
import { SignInPrompt } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Pips } from '../postbit/Postbit.tsx';
import { monthYear, shortDate } from '../postbit/dates.ts';
import { useLocation, useRouterInternals } from '../router.tsx';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import { useFaces } from './faces.ts';
import { GlassLink } from '../glass/Link.tsx';
import { ClassChip } from './ClassChip.tsx';
import { DebutDialog } from './DebutDialog.tsx';
import { Portrait } from './Portrait.tsx';
import { dayAndTime, figure, inDays, spanWords } from './format.ts';
import { RevealOverlay } from './RevealOverlay.tsx';
import { TurnDialog } from './TurnDialog.tsx';
import './characters.css';
import { CalmRegion } from '../glass/Calm.tsx';
import { Layers } from '../glass/layer.tsx';

type Dialog =
  | { readonly kind: 'turn' | 'reveal' | 'drop' | 'debut'; readonly id: Id };

const LOUD = { silent: 'silently', announced: 'announced', with_class: 'announced, with its class' } as const;

/** Where focus goes when the control that opened a dialog has been replaced by the dialog's own result. */
const returnTo = (id: Id) => () => document.querySelector<HTMLElement>(`[data-kb-character="${id}"] [data-kb-return]`);

/** The roster's panel. While it is the one leaving (a swap to another character) it gives up its id, so the one arriving is what the tabs control. */
function PanelRegion({ id, ...props }: ComponentProps<'section'>) {
  const present = useIsPresent();
  return <CalmRegion as="section" id={present ? id : undefined} {...props} />;
}
/** The panel as a motion element: it is the tabpanel itself, directly after the roster, so a swap adds no wrapper between them. */
const MotionPanel = motion.create(PanelRegion);

/** The order they joined, a character still waiting to debut after every one that has. */
const joined = (a: MyCharacter, b: MyCharacter) => (a.debutedAt ?? '￿').localeCompare(b.debutedAt ?? '￿') || a.name.localeCompare(b.name);

/** The character a navigation carried in history.state, if it named one. */
const carried = (state: unknown): Id | null => {
  const id = (state as { character?: unknown } | null)?.character;
  return typeof id === 'string' ? id : null;
};

/** The page draws its document: whole on the first frame. Signed out, the marker is the sign-in line. */
export function Characters({ doc }: { readonly doc: ScreenDoc<MyCharactersPage> }) {
  if (isSignedOutDoc(doc)) return <div className="kb-characters"><SignInPrompt /></div>;
  return <Roster page={doc} />;
}

function Roster({ page }: { readonly page: MyCharactersPage }) {
  const { api, instance, ui, settings } = useKayfa();
  const player = usePlayer();
  const location = useLocation();
  const { retry: reload } = useRouterInternals();
  const rosterId = useId();
  const { faces, setFace } = useFaces(page);
  const standings = page.standings;
  const next = page.nextSettlementAt;
  /* What a character was, where its latest announced Turn said so in public. */
  const was = useMemo(() => {
    const latest = new Map<Id, { at: string; was: string | null }>();
    for (const t of page.turns) if (!latest.has(t.character) || latest.get(t.character)!.at < t.at) latest.set(t.character, { at: t.at, was: t.was });
    return new Map([...latest].flatMap(([id, t]) => (t.was ? [[id, t.was] as const] : [])));
  }, [page.turns]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState<Id | null>(null);
  /* A pip style being saved: its character and the style chosen, shown while the save is out. */
  const [savingPip, setSavingPip] = useState<{ readonly id: Id; readonly style: string } | null>(null);
  const [savingHidden, setSavingHidden] = useState<{ readonly id: Id; readonly hidden: boolean } | null>(null);
  const [problem, setProblem] = useState<{ readonly id: Id; readonly text: string; readonly pip?: boolean } | null>(null);
  const [focusRow, setFocusRow] = useState<Id | null>(null);
  const [picked, setPicked] = useState<Id | null>(() => carried(location.state));

  const mine = useMemo(() => [...page.characters].sort(joined), [page.characters]);
  const selected = mine.find((c) => c.id === picked) ?? mine.find((c) => c.id === player.hudCharacter?.id) ?? mine[0] ?? null;

  /* Another character chosen: the panel swaps (motion.ts `swap`), the old one leaving upward when the one chosen is after it in the roster's order, downward when before. */
  const feel = useFeel(ui.glass.motion);
  const at = selected ? mine.findIndex((c) => c.id === selected.id) : -1;
  const [seen, setSeen] = useState(at);
  const [dir, setDir] = useState<1 | -1>(1);
  if (at !== seen) {
    if (at >= 0 && seen >= 0) setDir(at > seen ? 1 : -1);
    setSeen(at);
  }

  /* After a withdrawal the Withdraw button is gone; focus goes to the panel's new main control. */
  useEffect(() => {
    if (focusRow === null) return;
    const el = returnTo(focusRow)();
    if (el) { el.focus(); setFocusRow(null); }
  }, [focusRow, mine]);

  const active = mine.filter((c) => c.retiredAt === null);
  const per = settings.charactersPerPlayer;
  const open = Math.max(0, per - active.length);
  const className = (k: string) => instance.classes.find((c) => c.key === k)?.name ?? k;
  const rankOf = (c: MyCharacter) => {
    const standing = standings[c.id];
    if (c.debutedAt === null || standing === undefined) return null;
    const index = rankIndex(instance.ranks, standing);
    const rank = instance.ranks[index];
    return rank ? { index, rank, standing } : null;
  };
  const target = dialog ? mine.find((c) => c.id === dialog.id) ?? null : null;
  /* The dialogs have saved and refreshed the HUD's rows; the page's own document is read again in place. */
  const done = (message: string) => { setFlash(message); setDialog(null); reload(); };
  /* Words from an earlier action are not left standing under a new one. */
  const show = (next: Dialog) => { setFlash(''); setProblem(null); setDialog(next); };

  const withdraw = async (c: MyCharacter) => {
    setBusy(c.id);
    setProblem(null);
    setFlash('');
    try {
      const answer = await api.withdrawTurn(c.id);
      if (!answer.ok) { setProblem({ id: c.id, text: answer.error }); return; }
      await player.refresh();
      reload();
      setFlash(`${c.name}'s Turn is withdrawn.`);
      setFocusRow(c.id);
    } catch {
      setProblem({ id: c.id, text: 'That could not be sent. Check your connection and try again.' });
    } finally {
      setBusy(null);
    }
  };

  /*
   * The pip style is the profile's: it is saved with the title and signature the profile holds now
   * (the profile editor sets those). While a save is out the select keeps the keyboard (it is
   * aria-disabled, never disabled, which would drop focus to the page) and a further change waits:
   * it is not sent. A refused save puts the select back on the style that is saved.
   */
  const pipStyle = async (face: Character, style: string) => {
    if (savingPip !== null) return;
    setSavingPip({ id: face.id, style });
    setProblem(null);
    setFlash('');
    try {
      const answer = await api.setProfile(face.id, face.title, face.signature, style);
      if (!answer.ok) { setProblem({ id: face.id, text: answer.error, pip: true }); return; }
      setFace(answer.value);
      reload();
    } catch {
      setProblem({ id: face.id, text: 'That could not be sent. Check your connection and try again.', pip: true });
    } finally {
      setSavingPip(null);
    }
  };

  /*
   * Online status: hidden from "Who is online" and "Users browsing" (0041_presence.sql). As the pip
   * style, the select keeps the keyboard while it saves, a further change waits, and a refusal puts
   * it back on what is saved; the HUD's mark follows the player's own characters, read again.
   */
  const presenceHidden = async (c: MyCharacter, hidden: boolean) => {
    if (savingHidden !== null) return;
    setSavingHidden({ id: c.id, hidden });
    setProblem(null);
    setFlash('');
    try {
      const answer = await api.setPresenceHidden(c.id, hidden);
      if (!answer.ok) { setProblem({ id: c.id, text: answer.error, pip: true }); return; }
      /* Saved: the select and the HUD's mark follow the characters read again (a read that fails keeps them, and says so). */
      reload();
      try { await player.refresh(); } catch { setProblem({ id: c.id, text: 'Saved, but this page could not read it back. Reload to see it.', pip: true }); }
    } catch {
      setProblem({ id: c.id, text: 'That could not be sent. Check your connection and try again.', pip: true });
    } finally {
      setSavingHidden(null);
    }
  };

  /* A card's last line: where its Turn stands, in a few words. */
  const cardTurn = (c: MyCharacter) => {
    if (c.retiredAt !== null) return <span className="kb-roster-turn">Retired</span>;
    if (c.debutedAt === null) return <span className="kb-roster-turn" data-kb-state="waiting">Waiting to debut</span>;
    if (c.pendingTurn) return <span className="kb-roster-turn" data-kb-state="ready">Turn waiting</span>;
    if (c.turnOpensAt) return <span className="kb-roster-turn">Next Turn opens {shortDate(c.turnOpensAt)}</span>;
    return <span className="kb-roster-turn" data-kb-state="ready">Turn ready</span>;
  };

  const turnCell = (c: MyCharacter) => {
    if (c.retiredAt !== null) return <p className="kb-roster-line">Retired. An admin can restore it.</p>;
    if (c.debutedAt === null) return <p className="kb-roster-line">It can Turn once it has debuted.</p>;
    if (c.pendingTurn) {
      const p = c.pendingTurn;
      const when = p.takesEffectAt ?? next;
      const named = p.loudness === 'silent' ? 'silent' : `announced${p.showFrom ? ', naming the old class' : ''}${p.showTo ? ', naming the new class' : ''}`;
      return (
        <div className="kb-roster-pending">
          <p className="kb-turn-pending"><b>Turn waiting</b>: to {className(p.class)}, {named}.</p>
          <p className="kb-roster-line kb-turn-when">Takes effect at the next settlement{when ? `, ${dayAndTime(when)}` : ''}.</p>
          <p className="kb-roster-line kb-turn-note">If its settlement is due, a reveal waits until it has run.</p>
          <ButtonRow>
            <GlassButton data-kb-return="" aria-label={`Change ${c.name}'s Turn`} onClick={() => show({ kind: 'turn', id: c.id })}>Change</GlassButton>
            <GlassButton aria-label={`Withdraw ${c.name}'s Turn`} busy={busy === c.id} onClick={() => void withdraw(c)}>Withdraw</GlassButton>
          </ButtonRow>
          {problem?.id === c.id && !problem.pip && <p role="alert" className="kb-notice" data-kb-tone="refusal">{problem.text}</p>}
        </div>
      );
    }
    if (c.turnOpensAt) {
      return (
        <>
          {/* The date it opens is the button's; how far off it is, its description's, with the line's why. */}
          <button type="button" className="kb-roster-turn-button kb-glass-skew" data-kb-return="" disabled aria-label={`Turn ${c.name}`} aria-describedby={`turn-soon-${c.id} turn-when-${c.id}`}>
            <span className="kb-glass-upright">Turn · opens {shortDate(c.turnOpensAt)}</span>
          </button>
          <span id={`turn-soon-${c.id}`} className="kb-visually-hidden">Opens {inDays(c.turnOpensAt)}.</span>
          <p id={`turn-when-${c.id}`} className="kb-roster-line kb-turn-when">
            A character can Turn once every {spanWords(settings.turnCooldown).replace(/^1 /u, '')}. {c.name} last Turned at the {shortDate(c.classSince)} settlement.
          </p>
        </>
      );
    }
    return <button type="button" className="kb-roster-turn-button kb-glass-skew" data-kb-return="" data-kb-primary="" aria-label={`Turn ${c.name}`} onClick={() => show({ kind: 'turn', id: c.id })}><span className="kb-glass-upright">Turn…</span></button>;
  };

  const standingLine = (c: MyCharacter) => {
    if (c.debutedAt === null) return <>Not in the season yet.</>;
    const r = rankOf(c);
    if (!r) return <>No standing yet.</>;
    const face = faces.get(c.id);
    return (
      <>
        {r.rank.name} · <span className="kb-num">{figure(r.standing)}</span> this season{' '}
        <Pips ranks={instance.ranks.length} index={r.index} name={r.rank.name} style={ui.pips?.[face?.pipStyle ?? 'default'] ?? ui.pips?.default} />
      </>
    );
  };

  const panel = (c: MyCharacter) => {
    const face = faces.get(c.id);
    const waiting = c.debutedAt === null && c.retiredAt === null;
    const live = c.debutedAt !== null && c.retiredAt === null;
    const posts = page.counts[c.id]?.posts ?? null;
    const before = was.get(c.id);
    return (
      <Leaving key={c.id} tag={MotionPanel} custom={dir} {...swap(feel)} id={carouselPanelId(rosterId)} role="tabpanel" className="kb-roster-panel kb-glass-cut-panel" aria-labelledby={`${carouselTabId(rosterId, c.id)}-name`} data-kb-character={c.id}>
        <div className="kb-roster-panel-head">
          <p className="kb-roster-selected">Selected</p>
          <h2 className="kb-roster-panel-name kb-glass-display">{c.name}</h2>
          {face?.title && <p className="kb-roster-line kb-character-sub">{face.title}</p>}
        </div>
        {waiting && (
          <div className="kb-character-waiting">
            <p className="kb-roster-line">
              <span>Waiting to debut at the next settlement{next ? `, ${dayAndTime(next)}` : ''}.</span>
              <span> It will debut {LOUD[c.debutLoudness ?? 'announced']}.</span>
            </p>
            <ButtonRow>
              <GlassButton data-kb-return="" onClick={() => show({ kind: 'drop', id: c.id })}>Drop {c.name} now…</GlassButton>
              <GlassButton onClick={() => show({ kind: 'debut', id: c.id })}>Change how {c.name} debuts…</GlassButton>
            </ButtonRow>
          </div>
        )}
        <dl className="kb-roster-facts">
          <dt>Class</dt>
          <dd>
            <ClassChip cls={c.class} name={className(c.class)} />{' '}
            {c.debutedAt === null ? '(chosen when it was made)' : `since ${shortDate(c.classSince)}`}{' '}
            <span className="kb-private">only you</span>
          </dd>
          {before && <><dt>Was</dt><dd>{className(before)}, announced publicly</dd></>}
          <dt>Rank</dt><dd>{standingLine(c)}</dd>
          {player.wallet && <><dt>Wallet</dt><dd><span className="kb-num">{figure(player.wallet.balance)}</span> of {figure(player.wallet.cap)}</dd></>}
          {live && face?.joined && <><dt>Posts</dt><dd>{posts === null ? '' : <><span className="kb-num">{posts}</span> · </>}joined {monthYear(face.joined)}</dd></>}
        </dl>
        {live && face && (
          <label className="kb-roster-pip">
            Pip style
            <select
              className="kb-glass-select"
              value={savingPip?.id === c.id ? savingPip.style : face.pipStyle}
              aria-disabled={savingPip?.id === c.id || undefined}
              onChange={(e) => void pipStyle(face, e.target.value)}
            >
              {instance.pipStyles.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
        )}
        {live && (
          <>
            <label className="kb-roster-pip">
              Online status
              <select
                className="kb-glass-select"
                value={(savingHidden?.id === c.id ? savingHidden.hidden : c.presenceHidden) ? 'hidden' : 'shown'}
                aria-disabled={savingHidden?.id === c.id || undefined}
                aria-describedby={`presence-help-${c.id}`}
                onChange={(e) => void presenceHidden(c, e.target.value === 'hidden')}
              >
                <option value="shown">Shown online</option>
                <option value="hidden">Hidden</option>
              </select>
            </label>
            <p id={`presence-help-${c.id}`} className="kb-roster-line">A hidden character isn't listed in Who is online or Users browsing. While you post as it, only you see it there.</p>
          </>
        )}
        {problem?.id === c.id && problem.pip && <p role="alert" className="kb-notice" data-kb-tone="refusal">{problem.text}</p>}
        <div className="kb-roster-actions">
          {turnCell(c)}
          {live && <GlassButton to="/characters/edit" state={{ character: c.id }} aria-label="Edit profile">Edit profile</GlassButton>}
          {/* Its own tab of My log, chosen by the navigation's state and never the address (engine/ui/log/Log.tsx), as the Roster board draws the link. */}
          <GlassButton to="/log" state={{ character: c.id }}>{c.name}'s log</GlassButton>
          {live && <GlassButton aria-label={`Reveal ${c.name}'s class`} onClick={() => show({ kind: 'reveal', id: c.id })}>Reveal…</GlassButton>}
        </div>
        <p className="kb-roster-line kb-roster-most">{per} characters at most. To free a slot, ask an admin to retire one; every Act it made stays on the board.</p>
      </Leaving>
    );
  };

  return (
    <div className="kb-characters">
      <PageHead size="roster" title="Your characters" count={`(${active.length} of ${per})`} lead="This page is out of character and only you can see it. Classes are shown here and nowhere else unless you reveal them." />
      <div role="status" className="kb-flash">{flash && <CalmRegion as="p" className="kb-notice">{flash}</CalmRegion>}</div>

      {mine.length === 0 && <CalmRegion as="p" className="kb-characters-empty">You have no characters yet. <GlassLink to="/characters/new">Make one</GlassLink> to start playing.</CalmRegion>}

      <div className="kb-roster-layout">
          <Carousel
            role="tablist" id={rosterId} className="kb-roster-carousel"
            label={`Roster, ${active.length} of ${per} slots used`}
            items={mine.map((c) => ({ key: c.id, c }))} value={selected?.id ?? null} onChange={setPicked}
            renderItem={({ c }, { props }) => {
              const r = rankOf(c);
              /* The tab's name is its words, as drawn (a name that left out visible words would fail WCAG 2.5.3); its panel is named by the character's name alone, inside it. */
              return (
                <button key={c.id} type="button" {...props} className="kb-roster-card">
                  <Portrait face={faces.get(c.id)} className="kb-roster-portrait" />
                  <span id={`${carouselTabId(rosterId, c.id)}-name`} className="kb-roster-name kb-glass-display">{c.name}</span>
                  <span className="kb-roster-more">
                    <span className="kb-roster-class">
                      <ClassChip cls={c.class} name={className(c.class)} />
                      {r && <span className="kb-roster-rank" data-testid="kb-roster-rank">{r.rank.name}</span>}
                    </span>
                    {cardTurn(c)}
                  </span>
                </button>
              );
            }}
            after={open > 0 ? (
              <CalmRegion className="kb-roster-new">
                <GlassLink to="/characters/new" className="kb-roster-new-link">
                  <svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44"><path d="M22 6 V38 M6 22 H38" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                  <span className="kb-glass-display">New character</span>
                </GlassLink>
                <span className="kb-roster-slots">You have {open} open {open === 1 ? 'slot' : 'slots'}.</span>
              </CalmRegion>
            ) : undefined}
          />
        <AnimatePresence initial={false} custom={dir}>
          {selected && panel(selected)}
        </AnimatePresence>
          {open === 0 && (
            <CalmRegion as="p" className="kb-characters-new">
              You play {active.length} of {per} characters, the most there are. There is no way to free a slot yet; an admin can retire a character on request, and keeps every Act it made.
            </CalmRegion>
          )}
      </div>

      <Layers>
      {dialog && target && dialog.kind === 'turn' && <TurnDialog key="turn" character={target} face={faces.get(target.id)} standing={standings[target.id]} nextSettlement={next} onClose={() => setDialog(null)} onDone={done} returnFocusTo={returnTo(target.id)} />}
      {dialog && target && dialog.kind === 'reveal' && <RevealOverlay key="reveal" character={target} onClose={() => setDialog(null)} onDone={(message) => { setFlash(message); reload(); }} returnFocusTo={returnTo(target.id)} />}
      {dialog && target && dialog.kind === 'drop' && <DebutDialog key="drop" character={target} timing="now" nextSettlement={next} onClose={() => setDialog(null)} onDone={done} returnFocusTo={returnTo(target.id)} />}
      {dialog && target && dialog.kind === 'debut' && <DebutDialog key="debut" character={target} timing="tally" nextSettlement={next} onClose={() => setDialog(null)} onDone={done} returnFocusTo={returnTo(target.id)} />}
      </Layers>
    </div>
  );
}
