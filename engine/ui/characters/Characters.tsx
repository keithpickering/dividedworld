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
import { useEffect, useId, useMemo, useState } from 'react';
import { rankIndex } from '../../rules/ranks.ts';
import { useKayfa } from '../context.tsx';
import type { Character, CharacterCounts, Id, MyCharacter } from '../data/api.ts';
import { SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Pips } from '../postbit/Postbit.tsx';
import { monthYear, shortDate } from '../postbit/dates.ts';
import { Link, useLocation } from '../router.tsx';
import { ClassChip } from './ClassChip.tsx';
import { DebutDialog } from './DebutDialog.tsx';
import { Portrait } from './Portrait.tsx';
import { dayAndTime, figure, inDays, spanWords } from './format.ts';
import { RevealDialog } from './RevealDialog.tsx';
import { TurnDialog } from './TurnDialog.tsx';
import './characters.css';

type Dialog =
  | { readonly kind: 'turn' | 'reveal' | 'drop' | 'debut'; readonly id: Id };

const LOUD = { silent: 'silently', announced: 'announced', with_class: 'announced, with its class' } as const;

/** Where focus goes when the control that opened a dialog has been replaced by the dialog's own result. */
const returnTo = (id: Id) => () => document.querySelector<HTMLElement>(`[data-kb-character="${id}"] [data-kb-return]`);

/** The order they joined, a character still waiting to debut after every one that has. */
const joined = (a: MyCharacter, b: MyCharacter) => (a.debutedAt ?? '￿').localeCompare(b.debutedAt ?? '￿') || a.name.localeCompare(b.name);

/** The character a navigation carried in history.state, if it named one. */
const carried = (state: unknown): Id | null => {
  const id = (state as { character?: unknown } | null)?.character;
  return typeof id === 'string' ? id : null;
};

export function Characters() {
  const { api, instance, ui, settings } = useKayfa();
  const player = usePlayer();
  const location = useLocation();
  const signedIn = useSignedIn(api);
  const panelHead = useId();
  const [faces, setFaces] = useState<ReadonlyMap<Id, Character>>(new Map());
  const [standings, setStandings] = useState<Readonly<Record<Id, number>>>({});
  const [was, setWas] = useState<ReadonlyMap<Id, string>>(new Map());
  const [counts, setCounts] = useState<{ readonly id: Id; readonly counts: CharacterCounts } | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [flash, setFlash] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Id | null>(null);
  /* A pip style being saved: its character and the style chosen, shown while the save is out. */
  const [savingPip, setSavingPip] = useState<{ readonly id: Id; readonly style: string } | null>(null);
  const [problem, setProblem] = useState<{ readonly id: Id; readonly text: string; readonly pip?: boolean } | null>(null);
  const [focusRow, setFocusRow] = useState<Id | null>(null);
  const [picked, setPicked] = useState<Id | null>(() => carried(location.state));

  const mine = useMemo(() => [...player.characters].sort(joined), [player.characters]);
  const debutedIds = useMemo(() => mine.filter((c) => c.debutedAt !== null).map((c) => c.id), [mine]);
  const key = debutedIds.join(',');
  const selected = mine.find((c) => c.id === picked) ?? mine.find((c) => c.id === player.hudCharacter?.id) ?? mine[0] ?? null;

  useEffect(() => {
    /* Asked once the account's characters are read, so a load asks with them and not again when they arrive. */
    if (!signedIn || !player.loaded) return;
    let live = true;
    setFailed(false);
    void (async () => {
      const [people, stood, turns, at] = await Promise.all([
        debutedIds.length ? api.characters(debutedIds) : [],
        debutedIds.length ? api.standingAmounts(debutedIds) : {},
        debutedIds.length ? api.turnsAnnounced(debutedIds) : [],
        api.nextSettlementAt(),
      ]);
      if (!live) return;
      setFaces(new Map(people.map((c) => [c.id, c])));
      setStandings(stood);
      /* What a character was, where its latest announced Turn said so in public. */
      const latest = new Map<Id, { at: string; was: string | null }>();
      for (const t of turns) if (!latest.has(t.character) || latest.get(t.character)!.at < t.at) latest.set(t.character, { at: t.at, was: t.was });
      setWas(new Map([...latest].flatMap(([id, t]) => (t.was ? [[id, t.was] as const] : []))));
      setNext(at);
    })().catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, signedIn, player.loaded, key]);

  /* The selected character's posts, read for it alone when it is chosen. */
  const countsFor = selected && selected.debutedAt !== null ? selected.id : null;
  useEffect(() => {
    if (countsFor === null) return;
    let live = true;
    api.characterCounts(countsFor).then((c) => { if (live) setCounts({ id: countsFor, counts: c }); }).catch(() => { /* the posts line waits for the next read */ });
    return () => { live = false; };
  }, [api, countsFor]);

  /* After a withdrawal the Withdraw button is gone; focus goes to the panel's new main control. */
  useEffect(() => {
    if (focusRow === null) return;
    const el = returnTo(focusRow)();
    if (el) { el.focus(); setFocusRow(null); }
  }, [focusRow, mine]);

  if (signedIn === null || (signedIn && !player.loaded)) return <div className="kb-characters" aria-busy="true" />;
  if (!signedIn) return <div className="kb-characters"><SignInPrompt /></div>;
  if (failed) return <div className="kb-characters"><p className="kb-notice kb-calm" data-kb-tone="refusal">Your characters could not be loaded. Reload the page to try again.</p></div>;

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
  const done = (message: string) => { setFlash(message); setDialog(null); };
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
      setFaces((before) => new Map(before).set(face.id, answer.value));
    } catch {
      setProblem({ id: face.id, text: 'That could not be sent. Check your connection and try again.', pip: true });
    } finally {
      setSavingPip(null);
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
          <span className="kb-row-actions">
            <button type="button" className="kb-glass-action kb-glass-skew" data-kb-return="" aria-label={`Change ${c.name}'s Turn`} onClick={() => show({ kind: 'turn', id: c.id })}><span className="kb-glass-upright">Change</span></button>
            <button type="button" className="kb-glass-action kb-glass-skew" aria-label={`Withdraw ${c.name}'s Turn`} disabled={busy === c.id} onClick={() => void withdraw(c)}><span className="kb-glass-upright">Withdraw</span></button>
          </span>
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
    const posts = counts?.id === c.id ? counts.counts.posts : null;
    const before = was.get(c.id);
    return (
      <section className="kb-roster-panel kb-glass-cut-panel kb-calm" aria-labelledby={panelHead} data-kb-character={c.id}>
        <div className="kb-roster-panel-head">
          <p className="kb-roster-selected">Selected</p>
          <h2 id={panelHead} className="kb-roster-panel-name kb-glass-display">{c.name}</h2>
          {face?.title && <p className="kb-roster-line kb-character-sub">{face.title}</p>}
        </div>
        {waiting && (
          <div className="kb-character-waiting">
            <p className="kb-roster-line">
              <span>Waiting to debut at the next settlement{next ? `, ${dayAndTime(next)}` : ''}.</span>
              <span> It will debut {LOUD[c.debutLoudness ?? 'announced']}.</span>
            </p>
            <span className="kb-row-actions">
              <button type="button" className="kb-glass-action kb-glass-skew" data-kb-return="" aria-label={`Drop ${c.name} now`} onClick={() => show({ kind: 'drop', id: c.id })}><span className="kb-glass-upright">Drop now…</span></button>
              <button type="button" className="kb-glass-action kb-glass-skew" aria-label={`Change how ${c.name} debuts`} onClick={() => show({ kind: 'debut', id: c.id })}><span className="kb-glass-upright">Change how it debuts…</span></button>
            </span>
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
        {problem?.id === c.id && problem.pip && <p role="alert" className="kb-notice" data-kb-tone="refusal">{problem.text}</p>}
        <div className="kb-roster-actions">
          {turnCell(c)}
          {live && <Link to="/characters/edit" state={{ character: c.id }} className="kb-glass-action kb-glass-skew" aria-label="Edit profile"><span className="kb-glass-upright">Edit profile</span></Link>}
          {live && <button type="button" className="kb-glass-action kb-glass-skew" aria-label={`Reveal ${c.name}'s class`} onClick={() => show({ kind: 'reveal', id: c.id })}><span className="kb-glass-upright">Reveal…</span></button>}
        </div>
        <p className="kb-roster-line kb-roster-most">{per} characters at most. To free a slot, ask an admin to retire one; every Act it made stays on the board.</p>
      </section>
    );
  };

  return (
    <div className="kb-characters">
      <div className="kb-characters-head">
        <h1 className="kb-characters-title kb-glass-display kb-calm">Your characters <span className="kb-characters-count">({active.length} of {per})</span></h1>
        <p className="kb-characters-lead kb-calm">This page is out of character and only you can see it. Classes are shown here and nowhere else unless you reveal them.</p>
      </div>
      <div role="status" className="kb-flash">{flash && <p className="kb-notice kb-calm">{flash}</p>}</div>

      {mine.length === 0 && <p className="kb-characters-empty kb-calm">You have no characters yet. <Link to="/characters/new">Make one</Link> to start playing.</p>}

      <div className="kb-roster-layout">
        <div className="kb-roster-side">
          <ul className="kb-roster kb-calm" aria-label={`Roster, ${active.length} of ${per} slots used`}>
            {mine.map((c) => {
              const r = rankOf(c);
              return (
                <li key={c.id}>
                  <button type="button" className="kb-roster-card" aria-current={c.id === selected?.id ? 'true' : undefined} onClick={() => setPicked(c.id)}>
                    <Portrait face={faces.get(c.id)} className="kb-roster-portrait" />
                    <span className="kb-roster-name kb-glass-display">{c.name}</span>
                    <span className="kb-roster-class">
                      <ClassChip cls={c.class} name={className(c.class)} />
                      {r && <span className="kb-roster-rank" data-testid="kb-roster-rank">{r.rank.name}</span>}
                    </span>
                    {cardTurn(c)}
                  </button>
                </li>
              );
            })}
            {open > 0 && (
              <li className="kb-roster-new">
                <Link to="/characters/new" className="kb-roster-new-link">
                  <svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44"><path d="M22 6 V38 M6 22 H38" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
                  <span className="kb-glass-display">New character</span>
                </Link>
                <span className="kb-roster-slots">You have {open} open {open === 1 ? 'slot' : 'slots'}.</span>
              </li>
            )}
            {Array.from({ length: Math.max(0, open - 1) }, (_, i) => <li key={`empty-${i}`} className="kb-roster-empty" aria-hidden="true" />)}
          </ul>
          {open === 0 && (
            <p className="kb-characters-new kb-calm">
              You play {active.length} of {per} characters, the most there are. There is no way to free a slot yet; an admin can retire a character on request, and keeps every Act it made.
            </p>
          )}
        </div>
        {selected && panel(selected)}
      </div>

      {dialog && target && dialog.kind === 'turn' && <TurnDialog character={target} face={faces.get(target.id)} standing={standings[target.id]} nextSettlement={next} onClose={() => setDialog(null)} onDone={done} returnFocusTo={returnTo(target.id)} />}
      {dialog && target && dialog.kind === 'reveal' && <RevealDialog character={target} onClose={() => setDialog(null)} onDone={setFlash} returnFocusTo={returnTo(target.id)} />}
      {dialog && target && dialog.kind === 'drop' && <DebutDialog character={target} timing="now" onClose={() => setDialog(null)} onDone={done} returnFocusTo={returnTo(target.id)} />}
      {dialog && target && dialog.kind === 'debut' && <DebutDialog character={target} timing="tally" onClose={() => setDialog(null)} onDone={done} returnFocusTo={returnTo(target.id)} />}
    </div>
  );
}
