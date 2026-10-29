/**
 * My characters: the player's own masks, out of character and plain. Each shows its class marked
 * "only you", its standing and pips, and its Turn: the button, the date it opens, or a pending Turn
 * with Change and Withdraw. A character waiting to debut says so, and offers to drop it now or
 * change how it debuts. Nothing here is public: a waiting character is in no list anyone else
 * reads, and the class is shown to its player alone ("A response never proves a private fact").
 */
import { useEffect, useMemo, useState } from 'react';
import { rankIndex } from '../../rules/ranks.ts';
import { useKayfa } from '../context.tsx';
import type { Character, Id, MyCharacter, Standing } from '../data/api.ts';
import { Mini, SignInPrompt, useSignedIn } from '../mini.tsx';
import { usePlayer } from '../player.tsx';
import { Pips } from '../postbit/Postbit.tsx';
import { monthYear, shortDate } from '../postbit/dates.ts';
import { Link } from '../router.tsx';
import { DebutDialog } from './DebutDialog.tsx';
import { dateAndDistance, dayAndTime, figure } from './format.ts';
import { RevealDialog } from './RevealDialog.tsx';
import { TurnDialog } from './TurnDialog.tsx';
import './characters.css';

type Dialog =
  | { readonly kind: 'turn' | 'reveal' | 'drop' | 'debut'; readonly id: Id };

const LOUD = { silent: 'silently', announced: 'announced', with_class: 'announced, with its class' } as const;

/** Where focus goes when the control that opened a dialog has been replaced by the dialog's own result. */
const returnTo = (id: Id) => () => document.querySelector<HTMLElement>(`[data-kb-character="${id}"] [data-kb-return]`);

export function Characters() {
  const { api, instance, ui, settings } = useKayfa();
  const player = usePlayer();
  const signedIn = useSignedIn(api);
  const [faces, setFaces] = useState<ReadonlyMap<Id, Character>>(new Map());
  const [standings, setStandings] = useState<ReadonlyMap<Id, Standing>>(new Map());
  const [next, setNext] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [flash, setFlash] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Id | null>(null);
  const [problem, setProblem] = useState<{ readonly id: Id; readonly text: string } | null>(null);
  const [focusRow, setFocusRow] = useState<Id | null>(null);

  const mine = player.characters;
  const debutedIds = useMemo(() => mine.filter((c) => c.debutedAt !== null).map((c) => c.id), [mine]);
  const key = debutedIds.join(',');

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void (async () => {
      const [people, stood, at] = await Promise.all([
        debutedIds.length ? api.characters(debutedIds) : [],
        debutedIds.length ? api.standingsOf(debutedIds) : [],
        api.nextSettlementAt(),
      ]);
      if (!live) return;
      setFaces(new Map(people.map((c) => [c.id, c])));
      setStandings(new Map(stood.map((s) => [s.character, s])));
      setNext(at);
    })().catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, signedIn, key]);

  /* After a withdrawal the Withdraw button is gone; focus goes to the row's new main control. */
  useEffect(() => {
    if (focusRow === null) return;
    const el = returnTo(focusRow)();
    if (el) { el.focus(); setFocusRow(null); }
  }, [focusRow, mine]);

  if (signedIn === null || (signedIn && !player.loaded)) return <div className="kb-characters" aria-busy="true" />;
  if (!signedIn) return <div className="kb-characters"><SignInPrompt /></div>;
  if (failed) return <div className="kb-characters"><p className="kb-notice" data-kb-tone="refusal">Your characters could not be loaded. Reload the page to try again.</p></div>;

  const active = mine.filter((c) => c.retiredAt === null);
  const open = Math.max(0, settings.charactersPerPlayer - active.length);
  const className = (k: string) => instance.classes.find((c) => c.key === k)?.name ?? k;
  const target = dialog ? mine.find((c) => c.id === dialog.id) ?? null : null;
  const done = (message: string) => { setFlash(message); setDialog(null); };

  const withdraw = async (c: MyCharacter) => {
    setBusy(c.id);
    setProblem(null);
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

  const turnCell = (c: MyCharacter) => {
    if (c.retiredAt !== null) return <span className="kb-small">Retired. An admin can restore it.</span>;
    if (c.debutedAt === null) return <span className="kb-small kb-muted">It can Turn once it has debuted.</span>;
    if (c.pendingTurn) {
      const p = c.pendingTurn;
      const when = p.takesEffectAt ?? next;
      const named = p.loudness === 'silent' ? 'silent' : `announced${p.showFrom ? ', naming the old class' : ''}${p.showTo ? ', naming the new class' : ''}`;
      return (
        <>
          <span className="kb-turn-pending"><b>Turn waiting</b>: to {className(p.class)}, {named}.</span>
          <span className="kb-small kb-turn-when">Takes effect at the next settlement{when ? `, ${dayAndTime(when)}` : ''}.</span>
          <span className="kb-row-actions">
            <button type="button" className="kb-button" data-kb-return="" aria-label={`Change ${c.name}'s Turn`} onClick={() => setDialog({ kind: 'turn', id: c.id })}>Change</button>
            <button type="button" className="kb-button" aria-label={`Withdraw ${c.name}'s Turn`} disabled={busy === c.id} onClick={() => void withdraw(c)}>Withdraw</button>
          </span>
          {problem?.id === c.id && <span role="alert" className="kb-notice kb-small" data-kb-tone="refusal">{problem.text}</span>}
        </>
      );
    }
    if (c.turnOpensAt) {
      return (
        <>
          <button type="button" className="kb-button" data-kb-return="" disabled aria-label={`Turn ${c.name}`} aria-describedby={`turn-when-${c.id}`}>Turn…</button>
          <span id={`turn-when-${c.id}`} className="kb-small kb-turn-when">Available {dateAndDistance(c.turnOpensAt)}</span>
        </>
      );
    }
    return <button type="button" className="kb-button" data-kb-return="" data-kb-primary="" aria-label={`Turn ${c.name}`} onClick={() => setDialog({ kind: 'turn', id: c.id })}>Turn…</button>;
  };

  const standingCell = (c: MyCharacter) => {
    if (c.debutedAt === null) return <span className="kb-muted kb-small">Not in the season yet.</span>;
    const s = standings.get(c.id);
    if (!s) return <span className="kb-muted kb-small">No standing yet.</span>;
    const index = rankIndex(instance.ranks, s.standing);
    const rank = instance.ranks[index];
    const face = faces.get(c.id);
    return (
      <>
        <span className="kb-num">{figure(s.standing)}</span>
        {rank && <Pips ranks={instance.ranks.length} index={index} name={rank.name} style={ui.pips?.[face?.pipStyle ?? 'default'] ?? ui.pips?.default} />}
        {rank && <span className="kb-small kb-muted"> {rank.name}</span>}
      </>
    );
  };

  return (
    <div className="kb-characters">
      <p className="kb-crumb"><Link to="/">Index</Link> › Your characters</p>
      <h1 className="kb-heading">Your characters ({active.length} of {settings.charactersPerPlayer})</h1>
      <p className="kb-muted kb-small">This page is out of character and only you can see it. Classes are shown here and nowhere else unless you reveal them.</p>
      <div role="status" className="kb-flash">{flash && <p className="kb-notice">{flash}</p>}</div>

      {mine.length === 0 ? (
        <p className="kb-characters-empty">You have no characters yet. <Link to="/characters/new">Make one</Link> to start playing.</p>
      ) : (
        <table className="kb-table kb-character-list">
          <caption className="kb-visually-hidden">Your characters</caption>
          <thead>
            <tr>
              <th scope="col">Character</th>
              <th scope="col">Class <span className="kb-private">only you</span></th>
              <th scope="col">This season</th>
              <th scope="col">Turn</th>
              <th scope="col"><span className="kb-visually-hidden">Profile</span></th>
            </tr>
          </thead>
          <tbody>
            {mine.map((c) => {
              const face = faces.get(c.id);
              const waiting = c.debutedAt === null && c.retiredAt === null;
              const live = c.debutedAt !== null && c.retiredAt === null;
              return (
                <tr key={c.id} className="kb-character-row" data-kb-character={c.id}>
                  <th scope="row" className="kb-character-who">
                    <Mini character={face} name={c.name} />
                    <span className="kb-character-name">{c.name}</span>
                    <span className="kb-small kb-muted kb-character-sub">
                      {[face?.title, face?.joined ? `joined ${monthYear(face.joined)}` : ''].filter(Boolean).join(' · ')}
                    </span>
                    {waiting && (
                      <span className="kb-character-waiting kb-small">
                        <span>Waiting to debut at the next settlement{next ? `, ${dayAndTime(next)}` : ''}.</span>
                        <span> It will debut {LOUD[c.debutLoudness ?? 'announced']}.</span>
                        <span className="kb-row-actions">
                          <button type="button" className="kb-button" data-kb-return="" aria-label={`Drop ${c.name} now`} onClick={() => setDialog({ kind: 'drop', id: c.id })}>Drop now…</button>
                          <button type="button" className="kb-button" aria-label={`Change how ${c.name} debuts`} onClick={() => setDialog({ kind: 'debut', id: c.id })}>Change how it debuts…</button>
                        </span>
                      </span>
                    )}
                  </th>
                  <td data-label="Class">
                    <span className="kb-private">only you</span> {className(c.class)}{' '}
                    <span className="kb-small kb-muted">{c.debutedAt === null ? '(chosen when it was made)' : `since ${shortDate(c.classSince)}`}</span>
                    {live && (
                      <span className="kb-row-actions">
                        <button type="button" className="kb-button" aria-label={`Reveal ${c.name}'s class`} onClick={() => setDialog({ kind: 'reveal', id: c.id })}>Reveal…</button>
                      </span>
                    )}
                  </td>
                  <td data-label="This season">{standingCell(c)}</td>
                  <td data-label="Turn">{turnCell(c)}</td>
                  <td>{live && <Link to={`/characters/${c.id}/edit`} aria-label={`Edit profile`}>Edit profile</Link>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="kb-characters-new">
        {open > 0 ? (
          <>
            <Link to="/characters/new" className="kb-button" data-kb-primary="">New character</Link>{' '}
            <span className="kb-small kb-muted">You have {open} open {open === 1 ? 'slot' : 'slots'}.</span>
          </>
        ) : (
          <span className="kb-small">
            You play {active.length} of {settings.charactersPerPlayer} characters, the most there are. There is no way to free a slot yet; an admin can retire a character on request, and keeps every Act it made.
          </span>
        )}
      </p>

      {dialog && target && dialog.kind === 'turn' && <TurnDialog character={target} nextSettlement={next} onClose={() => setDialog(null)} onDone={done} returnFocusTo={returnTo(target.id)} />}
      {dialog && target && dialog.kind === 'reveal' && <RevealDialog character={target} onClose={() => setDialog(null)} onDone={setFlash} returnFocusTo={returnTo(target.id)} />}
      {dialog && target && dialog.kind === 'drop' && <DebutDialog character={target} timing="now" onClose={() => setDialog(null)} onDone={done} returnFocusTo={returnTo(target.id)} />}
      {dialog && target && dialog.kind === 'debut' && <DebutDialog character={target} timing="tally" onClose={() => setDialog(null)} onDone={done} returnFocusTo={returnTo(target.id)} />}
    </div>
  );
}
