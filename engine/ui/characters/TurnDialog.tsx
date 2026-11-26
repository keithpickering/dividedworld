/**
 * The Turn, a glass overlay (engine/ui/glass/Overlay.tsx) on the Turn's own smoke, as the Turn board
 * draws it (docs/research/2026-10-29-two-worlds/06-turn.html): the character on the left (its
 * portrait, rank, season standing and the class it holds, seen by its player alone), then the class
 * to Turn to among the four class cards, how loud, and the preview of what everyone will see. A
 * Turn takes effect at the next settlement. A silent one is posted nowhere and, until then, can be
 * changed (this dialog again, its choices filled in), withdrawn or announced later (`announce`: the
 * class stays, and the dialog asks only what to name and where). An announced one is posted at once,
 * in a thread chosen with the picker Reveal shares (which starts on the open thread, `at`), and then stands: it
 * can be neither changed nor withdrawn. Out of character and plain: the class is the player's own,
 * and the preview names a class only where the player chose to name it.
 *
 * Opened from My characters it leaves the menu bar in view, dimmed and inert, and Close and Esc
 * return to My characters with focus where it was (the web plan's 2026-10-30 amendment to Task 9).
 */
import { useState } from 'react';
import { words } from '../../rules/pronouns.ts';
import { rankIndex } from '../../rules/ranks.ts';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER, type Character, type Id, type MyCharacter } from '../data/api.ts';
import { readBack, STALE_PAGE } from './readBack.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { usePlayer } from '../player.tsx';
import { Pips } from '../postbit/Postbit.tsx';
import { shortDate } from '../postbit/dates.ts';
import { ClassCards, MAP } from './ClassCards.tsx';
import { ClassChip } from './ClassChip.tsx';
import { Portrait } from './Portrait.tsx';
import { dayAndTime, figure, spanWords, withArticle } from './format.ts';
import { PreviewBox } from './PreviewBox.tsx';
import { turnPreview } from './previews.ts';
import { ThreadPicker, type ChosenThread } from './ThreadPicker.tsx';
import './characters.css';

export interface TurnDialogProps {
  readonly character: MyCharacter;
  /** Its public face (portrait, pip style), where the screen has read it. */
  readonly face?: Character;
  /** Its season standing in hundredths, where the screen has read it. */
  readonly standing?: number;
  /** The settlement's time, where it is known. */
  readonly nextSettlement: string | null;
  readonly onClose: () => void;
  readonly onDone: (message: string) => void;
  readonly returnFocusTo?: () => HTMLElement | null;
  /** The thread the opener is on: the picker starts on it (as Reveal's does), so an announced Turn is ready at once and can still be posted elsewhere. */
  readonly at?: { readonly id: Id; readonly title: string; readonly board: Id } | null;
  /** Announce the silent Turn that is waiting, keeping its class: asks only what to name and where. */
  readonly announce?: boolean;
  /** The overlay's kicker, which each opener words (the HUD, My characters). */
  readonly kicker?: string;
}

/** What an announced Turn's foot says, and what the dialog's button promises. */
export const COMMITS = "Once announced, this Turn can't be changed or withdrawn. It takes effect at the next settlement.";

export function TurnDialog({ character, face, standing, nextSettlement, onClose, onDone, returnFocusTo, at = null, announce = false, kicker = 'My characters › Turn' }: TurnDialogProps) {
  const { api, instance, ui, settings } = useKayfa();
  const { refresh } = usePlayer();
  const pending = character.pendingTurn;
  const [to, setTo] = useState<string | null>(pending?.class ?? null);
  /* Announcing a waiting Turn is an announced Turn by definition; a new one starts announced, and a silent one waiting starts silent. */
  const [loudness, setLoudness] = useState<'silent' | 'announced'>(announce ? 'announced' : (pending?.loudness ?? 'announced'));
  const [chosen, setChosen] = useState<ChosenThread | null>(at ? { id: at.id, title: at.title, board: at.board } : null);
  const [named, setNamed] = useState({ was: pending?.showFrom ?? false, to: pending?.showTo ?? false });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const nameOf = (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
  const now = nameOf(character.class);
  const pw = words(character.pronouns);
  /* A silent Turn names nothing: the boxes are off and clear while it is chosen. */
  const showFrom = loudness === 'announced' && named.was;
  const showTo = loudness === 'announced' && named.to;
  const when = pending?.takesEffectAt ?? nextSettlement;
  const index = standing === undefined ? null : rankIndex(instance.ranks, standing);
  const rank = index === null ? undefined : instance.ranks[index];
  /* The line the post will carry with the given names on: the preview's own function, so an option quotes what is posted. */
  const postedWith = (was: boolean, toName: boolean) =>
    turnPreview({ name: character.name, was: now, to: to ? nameOf(to) : '', loudness: 'announced', showFrom: was, showTo: toName && to !== null }).lines[0]?.text ?? '';
  /* An announced Turn is posted at once, so it names where: the open thread, or the one chosen. */
  const needsThread = loudness === 'announced' && chosen === null;
  const label = (q: (typeof MAP)[number]) => ui.quadrantLabels[q];

  const submit = async () => {
    if (!to || busy || needsThread) return;
    setBusy(true);
    setRefusal(null);
    let answer;
    try {
      answer = announce
        ? await api.announceTurn(character.id, chosen!.id, showFrom, showTo)
        : await api.turn(character.id, to, loudness, showFrom, showTo, loudness === 'announced' ? chosen!.id : undefined);
    } catch {
      /* The adapter does not throw; if the call did, nothing says it did not go through. */
      setRefusal(LOST_ANSWER);
      setBusy(false);
      return;
    }
    if (!answer.ok) { setRefusal(answer.error); setBusy(false); return; }
    /* Written: the dialog ends, so the button stays busy and a second press cannot send a second Turn. */
    const fresh = await readBack(refresh);
    const where = loudness === 'announced' ? `announced in ${chosen!.title}. It takes effect at the next settlement` : 'waiting for the next settlement';
    onDone(`${character.name}'s Turn is ${where}.${fresh ? '' : STALE_PAGE}`);
  };

  return (
    <Overlay
      title={announce ? `Announce ${character.name}'s Turn` : pending ? `Change ${character.name}'s Turn` : `Turn ${character.name}`}
      kicker={kicker}
      surface="turn"
      className="kb-turn-dialog"
      onClose={busy ? () => {} : onClose}
      returnFocusTo={returnFocusTo}
    >
      <form className="kb-turn" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}>
        <aside className="kb-turn-who">
          <span className="kb-turn-portrait">
            <Portrait face={face} className="kb-turn-portrait-art" />
            <span className="kb-turn-portrait-name kb-glass-display"><span>{character.name}</span></span>
          </span>
          {rank && index !== null && (
            <span className="kb-turn-rank">
              <span>{rank.name}</span>
              <Pips ranks={instance.ranks.length} index={index} name={rank.name} style={ui.pips?.[face?.pipStyle ?? 'default'] ?? ui.pips?.default} />
            </span>
          )}
          <dl className="kb-turn-facts">
            {standing !== undefined && <><dt>Season standing</dt><dd><span className="kb-num">{figure(standing)}</span></dd></>}
            <dt>Class now</dt><dd><ClassChip cls={character.class} name={now} /></dd>
            <dt>Who can see it</dt><dd>Only you</dd>
          </dl>
          <p className="kb-turn-line">
            {character.name} is {withArticle(now)} (since {shortDate(character.classSince)}). After a Turn {pw.they} can Turn again in {spanWords(settings.turnCooldown)}.
          </p>
        </aside>
        <div className="kb-turn-choice">
          {announce ? (
            <p className="kb-turn-line">{character.name} Turns to {nameOf(to!)}, which stays hidden unless you name it below.</p>
          ) : (
            <div>
              <ClassCards legend="Turn to" value={to} onChange={setTo} current={character.class} large />
              <p className="kb-turn-map">
                The map: <span className="kb-turn-map-cells">{label('excitedNegative')} · {label('excitedPositive')}</span> on top,{' '}
                <span className="kb-turn-map-cells">{label('boredNegative')} · {label('calmPositive')}</span> below, the same grid as the React picker.
              </p>
            </div>
          )}
          <fieldset className="kb-choice kb-turn-loud">
            <legend>How loud</legend>
            {!announce && (
              <>
                <label className="kb-choice-option" data-kb-chosen={loudness === 'silent' || undefined}>
                  <input type="radio" name="turn-loudness" checked={loudness === 'silent'} onChange={() => setLoudness('silent')} />
                  <span><b>Silent.</b> Nobody is told, and nothing is posted. Until you reveal it, no other player knows.</span>
                </label>
                <label className="kb-choice-option" data-kb-chosen={loudness === 'announced' || undefined}>
                  <input type="radio" name="turn-loudness" checked={loudness === 'announced'} onChange={() => setLoudness('announced')} />
                  <span><b>Announced.</b> {character.name} says {pw.they} {pw.has} Turned, at once, in a thread you choose.</span>
                </label>
              </>
            )}
            {/*
              The board's third tile, lit where the post names a class: the two names an announced
              Turn can carry (the class reveal design), one group that a silent Turn turns off.
            */}
            <fieldset className="kb-turn-name" disabled={loudness === 'silent'} data-kb-chosen={showFrom || showTo || undefined}>
              <legend className="kb-visually-hidden">Name in the post</legend>
              <label className="kb-turn-toggle" data-kb-chosen={showFrom || undefined}>
                <input type="checkbox" checked={showFrom} onChange={(e) => setNamed({ ...named, was: e.target.checked })} />
                <span><b>Name the old class.</b> Adds “{postedWith(true, showTo)}” to the post.</span>
              </label>
              <label className="kb-turn-toggle" data-kb-chosen={showTo || undefined}>
                <input type="checkbox" checked={showTo} onChange={(e) => setNamed({ ...named, to: e.target.checked })} />
                <span><b>Name the new class.</b> {to ? `Adds “${postedWith(showFrom, true)}” to the post, and reveals it.` : 'Adds the class you choose to the post, and reveals it.'}</span>
              </label>
            </fieldset>
          </fieldset>
          {loudness === 'announced' && <ThreadPicker value={chosen} onChange={setChosen} />}
          {to ? (
            <PreviewBox preview={turnPreview({ name: character.name, was: now, to: nameOf(to), loudness, showFrom, showTo, threadTitle: chosen?.title ?? null })} />
          ) : (
            <p className="kb-turn-line">Choose a class to see what everyone will see.</p>
          )}
        </div>
        <div className="kb-turn-foot">
          {loudness === 'announced' ? (
            <p className="kb-turn-line kb-turn-effect">{COMMITS}{when ? ` Next settlement: ${dayAndTime(when)}.` : ''}</p>
          ) : (
            <p className="kb-turn-line kb-turn-effect">
              Takes effect at the next settlement{when ? `, ${dayAndTime(when)}` : ''}. Until then {character.name} is still {withArticle(now)}, and you can change this Turn, withdraw it or announce it.
            </p>
          )}
          {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
          <ButtonRow>
            <GlassButton disabled={busy} onClick={onClose}>Cancel</GlassButton>
            <GlassButton type="submit" kind="primary" busy={busy} disabled={!to || needsThread}>{announce ? 'Announce the Turn' : pending ? 'Change the Turn' : 'Confirm Turn'}</GlassButton>
          </ButtonRow>
        </div>
      </form>
    </Overlay>
  );
}
