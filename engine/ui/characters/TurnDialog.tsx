/**
 * The Turn, a glass overlay (engine/ui/glass/Overlay.tsx) on the Turn's own smoke, as the Turn board
 * draws it (docs/research/2026-10-29-two-worlds/06-turn.html): the character on the left (its
 * portrait, rank, season standing and the class it holds, seen by its player alone), then the class
 * to Turn to among the four class cards, how loud, and the preview of what everyone will see. A
 * Turn takes effect at the next settlement; until then it can be changed (this dialog again, its
 * choices filled in) or withdrawn. Asking again before then is the same Turn, changed. Out of
 * character and plain: the class is the player's own, and the preview names a class only where the
 * player chose to name it.
 *
 * Opened from My characters it leaves the menu bar in view, dimmed and inert, and Close and Esc
 * return to My characters with focus where it was (the web plan's 2026-10-30 amendment to Task 9).
 */
import { useState } from 'react';
import { rankIndex } from '../../rules/ranks.ts';
import { useKayfa } from '../context.tsx';
import type { Character, MyCharacter } from '../data/api.ts';
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
}

export function TurnDialog({ character, face, standing, nextSettlement, onClose, onDone, returnFocusTo }: TurnDialogProps) {
  const { api, instance, ui, settings } = useKayfa();
  const { refresh } = usePlayer();
  const pending = character.pendingTurn;
  const [to, setTo] = useState<string | null>(pending?.class ?? null);
  const [loudness, setLoudness] = useState<'silent' | 'announced'>(pending?.loudness ?? 'announced');
  const [named, setNamed] = useState({ was: pending?.showFrom ?? false, to: pending?.showTo ?? false });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const nameOf = (key: string) => instance.classes.find((c) => c.key === key)?.name ?? key;
  const now = nameOf(character.class);
  /* A silent Turn names nothing: the boxes are off and clear while it is chosen. */
  const showFrom = loudness === 'announced' && named.was;
  const showTo = loudness === 'announced' && named.to;
  const when = pending?.takesEffectAt ?? nextSettlement;
  const index = standing === undefined ? null : rankIndex(instance.ranks, standing);
  const rank = index === null ? undefined : instance.ranks[index];
  const label = (q: (typeof MAP)[number]) => ui.quadrantLabels[q];

  const submit = async () => {
    if (!to || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.turn(character.id, to, loudness, showFrom, showTo);
      if (!answer.ok) { setRefusal(answer.error); return; }
      await refresh();
      onDone(`${character.name}'s Turn is waiting for the next settlement.`);
    } catch {
      setRefusal('The Turn could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay
      title={pending ? `Change ${character.name}'s Turn` : `Turn ${character.name}`}
      kicker="My characters › Turn"
      surface="turn"
      className="kb-turn-dialog"
      onClose={onClose}
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
            {character.name} is {withArticle(now)} (since {shortDate(character.classSince)}). After a Turn it can Turn again in {spanWords(settings.turnCooldown)}.
          </p>
        </aside>
        <div className="kb-turn-choice">
          <div>
            <ClassCards legend="Turn to" value={to} onChange={setTo} current={character.class} large />
            <p className="kb-turn-map">
              The map: <span className="kb-turn-map-cells">{label('excitedNegative')} · {label('excitedPositive')}</span> on top,{' '}
              <span className="kb-turn-map-cells">{label('boredNegative')} · {label('calmPositive')}</span> below, the same grid as the React picker.
            </p>
          </div>
          <fieldset className="kb-choice kb-turn-loud">
            <legend>How loud</legend>
            <label className="kb-choice-option" data-kb-chosen={loudness === 'silent' || undefined}>
              <input type="radio" name="turn-loudness" checked={loudness === 'silent'} onChange={() => setLoudness('silent')} />
              <span><b>Silent.</b> Nobody is told. Until you reveal it, only you know.</span>
            </label>
            <label className="kb-choice-option" data-kb-chosen={loudness === 'announced' || undefined}>
              <input type="radio" name="turn-loudness" checked={loudness === 'announced'} onChange={() => setLoudness('announced')} />
              <span><b>Announced.</b> The System posts that {character.name} has Turned.</span>
            </label>
            <label className="kb-choice-option kb-choice-sub" data-kb-chosen={showFrom || undefined}>
              <input type="checkbox" checked={showFrom} disabled={loudness === 'silent'} onChange={(e) => setNamed({ ...named, was: e.target.checked })} />
              <span>Name the old class. The post says what {character.name} was.</span>
            </label>
            <label className="kb-choice-option kb-choice-sub" data-kb-chosen={showTo || undefined}>
              <input type="checkbox" checked={showTo} disabled={loudness === 'silent'} onChange={(e) => setNamed({ ...named, to: e.target.checked })} />
              <span>Name the new class. The post says what {character.name} is now, and {character.name} reveals it.</span>
            </label>
          </fieldset>
          {to ? (
            <PreviewBox preview={turnPreview({ name: character.name, was: now, to: nameOf(to), loudness, showFrom, showTo })} />
          ) : (
            <p className="kb-turn-line">Choose a class to see what everyone will see.</p>
          )}
        </div>
        <div className="kb-turn-foot">
          <p className="kb-turn-line kb-turn-effect">
            Takes effect at the next settlement{when ? `, ${dayAndTime(when)}` : ''}. Until then {character.name} is still {withArticle(now)}, and you can change this Turn or withdraw it.
          </p>
          {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
          <div className="kb-turn-actions">
            <button type="button" className="kb-glass-action kb-glass-skew" onClick={onClose}><span className="kb-glass-upright">Cancel</span></button>
            <button type="submit" className="kb-glass-confirm kb-glass-skew" disabled={!to || busy}><span className="kb-glass-upright">{pending ? 'Change the Turn' : `Turn ${character.name}`}</span></button>
          </div>
        </div>
      </form>
    </Overlay>
  );
}
